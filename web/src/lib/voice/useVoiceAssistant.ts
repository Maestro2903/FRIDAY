/**
 * useVoiceAssistant — the orchestrator hook behind the Hermes "Jarvis" voice
 * assistant. It owns the full hands-free loop:
 *
 *   mic (VAD) → STT → command router → { local dashboard action | Hermes agent }
 *             → spoken reply (TTS) → back to listening
 *
 * Local dashboard commands (navigate / management actions / settings) run
 * instantly via the client-tool executors. Everything else is delegated to the
 * Hermes agent over the JSON-RPC gateway and streamed back — Hermes is the
 * brain for questions and agentic work.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { GatewayClient } from "@/lib/gatewayClient";
import type { GatewayEvent } from "@/lib/gatewayClient";
import { MicEngine, speak, transcribe, type SpeechHandle } from "@/lib/voice/audio";
import { classifyCommand, stripWakeWord } from "@/lib/voice/commands";
import { executeCommand, type CommandDeps } from "@/lib/voice/clientTools";
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  saveVoiceSettings,
  type TranscriptEntry,
  type VoiceSettings,
  type VoiceState,
} from "@/lib/voice/types";

let entrySeq = 0;
function makeEntry(
  role: TranscriptEntry["role"],
  text: string,
  kind?: TranscriptEntry["kind"],
): TranscriptEntry {
  return { id: `v${++entrySeq}`, role, text, at: Date.now(), kind };
}

/** Strip common markdown so TTS doesn't read out symbols. */
function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface PendingTurn {
  sessionId: string;
  buffer: string;
  resolve: (finalText: string) => void;
}

export interface VoiceAssistant {
  state: VoiceState;
  settings: VoiceSettings;
  transcript: TranscriptEntry[];
  partialReply: string;
  error: string | null;
  gatewayConnected: boolean;
  inputVolumeRef: React.RefObject<number>;
  enable: () => void;
  disable: () => void;
  toggle: () => void;
  updateSettings: (patch: Partial<VoiceSettings>) => void;
  /** Submit a typed command/question through the same pipeline as speech. */
  sendText: (text: string) => void;
  clearTranscript: () => void;
}

export function useVoiceAssistant(): VoiceAssistant {
  const navigate = useNavigate();

  const [settings, setSettings] = useState<VoiceSettings>(() =>
    typeof window === "undefined" ? { ...DEFAULT_VOICE_SETTINGS } : loadVoiceSettings(),
  );
  const [state, setState] = useState<VoiceState>("off");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [partialReply, setPartialReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);

  const inputVolumeRef = useRef<number>(0);
  const micRef = useRef<MicEngine | null>(null);
  const gwRef = useRef<GatewayClient | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const speechRef = useRef<SpeechHandle | null>(null);
  const pendingTurnRef = useRef<PendingTurn | null>(null);
  const busyRef = useRef(false);

  // Keep the latest settings/state readable from stable callbacks.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const pushEntry = useCallback((entry: TranscriptEntry) => {
    setTranscript((prev) => [...prev, entry]);
  }, []);

  const stopSpeaking = useCallback(() => {
    speechRef.current?.stop();
    speechRef.current = null;
  }, []);

  const say = useCallback(async (text: string) => {
    const clean = stripForSpeech(text);
    if (!clean || !settingsRef.current.speakReplies) return;
    setState("speaking");
    micRef.current?.setCapturePaused(true);
    try {
      const handle = await speak(clean);
      speechRef.current = handle;
      await handle.done;
    } catch {
      /* TTS unavailable — stay silent */
    } finally {
      speechRef.current = null;
      micRef.current?.setCapturePaused(false);
      // Only fall back to idle if nothing else took over meanwhile.
      setState((s) => (s === "speaking" ? "idle" : s));
    }
  }, []);

  // ── Gateway (Hermes agent) plumbing ──────────────────────────────────
  const ensureGateway = useCallback(async (): Promise<GatewayClient> => {
    if (gwRef.current && sessionIdRef.current) return gwRef.current;

    const gw = gwRef.current ?? new GatewayClient();
    gwRef.current = gw;

    if (!sessionIdRef.current) {
      gw.on("message.delta", (ev: GatewayEvent<{ text?: string }>) => {
        const turn = pendingTurnRef.current;
        if (!turn || ev.session_id !== turn.sessionId) return;
        turn.buffer += ev.payload?.text ?? "";
        setPartialReply(turn.buffer);
      });
      gw.on("message.complete", (ev: GatewayEvent<{ text?: string }>) => {
        const turn = pendingTurnRef.current;
        if (!turn || ev.session_id !== turn.sessionId) return;
        const final = (ev.payload?.text ?? "").trim() || turn.buffer.trim();
        pendingTurnRef.current = null;
        turn.resolve(final);
      });
      gw.onState((s) => setGatewayConnected(s === "open"));

      await gw.connect();
      const { session_id } = await gw.request<{ session_id: string }>(
        "session.create",
        { close_on_disconnect: true, source: "tool" },
      );
      sessionIdRef.current = session_id;
    }
    return gw;
  }, []);

  const askHermes = useCallback(
    async (text: string): Promise<string> => {
      const gw = await ensureGateway();
      const sessionId = sessionIdRef.current;
      if (!sessionId) throw new Error("no session");
      setPartialReply("");
      const reply = await new Promise<string>((resolve, reject) => {
        pendingTurnRef.current = { sessionId, buffer: "", resolve };
        gw.request("prompt.submit", { session_id: sessionId, text }).catch(
          (e: Error) => {
            pendingTurnRef.current = null;
            reject(e);
          },
        );
      });
      setPartialReply("");
      return reply;
    },
    [ensureGateway],
  );

  // ── Setting commands issued by voice ─────────────────────────────────
  const applySetting = useCallback<CommandDeps["applySetting"]>((setting) => {
    switch (setting) {
      case "mute":
        setSettings((s) => ({ ...s, speakReplies: false }));
        break;
      case "unmute":
        setSettings((s) => ({ ...s, speakReplies: true }));
        break;
      case "stop-listening":
        // handled below in disable(); do it inline to avoid a dep cycle.
        setSettings((s) => ({ ...s, enabled: false }));
        break;
      case "wake-word-off":
        setSettings((s) => ({ ...s, wakeWordEnabled: false }));
        break;
      case "wake-word-on":
        setSettings((s) => ({ ...s, wakeWordEnabled: true }));
        break;
    }
  }, []);

  const commandDeps = useMemo<CommandDeps>(
    () => ({
      navigate: (path: string) => navigate(path),
      applySetting,
      stopSpeaking,
    }),
    [navigate, applySetting, stopSpeaking],
  );

  // ── Core: handle a recognized utterance / typed command ──────────────
  const handleTranscript = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      pushEntry(makeEntry("user", text));

      const cur = settingsRef.current;
      const { command, matched } = stripWakeWord(text, cur.wakeWord);

      // Wake word gates action only when enabled and not already mid-turn.
      if (cur.wakeWordEnabled && !matched) {
        return;
      }

      const cmd = classifyCommand(command);

      if (cmd.kind === "delegate") {
        setState("thinking");
        try {
          const reply = await askHermes(cmd.text);
          if (reply) {
            pushEntry(makeEntry("assistant", reply, "agent"));
            await say(reply);
          } else {
            setState("idle");
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Hermes is unavailable.";
          setError(msg);
          pushEntry(makeEntry("system", `Error: ${msg}`));
          setState("idle");
        }
        return;
      }

      // Local dashboard command.
      try {
        const result = await executeCommand(cmd, commandDeps);
        if (result.say) {
          pushEntry(makeEntry("assistant", result.say, "action"));
          await say(result.say);
        } else {
          setState("idle");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "That action failed.";
        setError(msg);
        pushEntry(makeEntry("system", `Error: ${msg}`));
        setState("idle");
      }
    },
    [askHermes, say, pushEntry, commandDeps],
  );

  // Serialize turns: ignore new input while one is being processed.
  const processUtterance = useCallback(
    async (fn: () => Promise<void>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        await fn();
      } finally {
        busyRef.current = false;
        setState((s) => (s === "speaking" ? s : "idle"));
      }
    },
    [],
  );

  const onUtterance = useCallback(
    (blob: Blob, mime: string) => {
      void processUtterance(async () => {
        setState("transcribing");
        micRef.current?.setCapturePaused(true);
        let text = "";
        try {
          text = await transcribe(blob, mime);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Transcription failed.");
        } finally {
          micRef.current?.setCapturePaused(false);
        }
        if (text) await handleTranscript(text);
      });
    },
    [processUtterance, handleTranscript],
  );

  // ── Mic lifecycle ────────────────────────────────────────────────────
  const startMic = useCallback(() => {
    if (micRef.current) return;
    const engine = new MicEngine(
      {
        onUtterance,
        onVolume: (v) => {
          inputVolumeRef.current = v;
        },
        onSpeechStart: () => {
          // Barge-in: stop TTS the moment the user starts talking.
          if (speechRef.current) {
            stopSpeaking();
          }
          if (!busyRef.current) setState("listening");
        },
        onError: (e) => {
          setError(e.message);
          setSettings((s) => ({ ...s, enabled: false }));
        },
      },
      { threshold: settingsRef.current.vadThreshold },
    );
    micRef.current = engine;
    setError(null);
    setState("idle");
    void engine.start();
  }, [onUtterance, stopSpeaking]);

  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    stopSpeaking();
    inputVolumeRef.current = 0;
    setState("off");
  }, [stopSpeaking]);

  const enable = useCallback(() => {
    setSettings((s) => ({ ...s, enabled: true }));
  }, []);
  const disable = useCallback(() => {
    setSettings((s) => ({ ...s, enabled: false }));
  }, []);
  const toggle = useCallback(() => {
    setSettings((s) => ({ ...s, enabled: !s.enabled }));
  }, []);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const sendText = useCallback(
    (text: string) => {
      void processUtterance(async () => {
        await handleTranscript(text);
      });
    },
    [processUtterance, handleTranscript],
  );

  const clearTranscript = useCallback(() => {
    setTranscript([]);
    setPartialReply("");
    setError(null);
  }, []);

  // React to enabled + threshold changes; persist settings. This effect
  // synchronizes an external system (the microphone) with `settings.enabled`;
  // start/stopMic legitimately update UI state as part of that sync, so the
  // set-state-in-effect rule is intentionally disabled here.
  useEffect(() => {
    saveVoiceSettings(settings);
    if (settings.enabled) {
      startMic();
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stopMic();
    }
    micRef.current?.setThreshold(settings.vadThreshold);
  }, [settings, startMic, stopMic]);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      micRef.current?.stop();
      micRef.current = null;
      speechRef.current?.stop();
      gwRef.current?.close();
      gwRef.current = null;
      sessionIdRef.current = null;
    };
  }, []);

  return {
    state,
    settings,
    transcript,
    partialReply,
    error,
    gatewayConnected,
    inputVolumeRef,
    enable,
    disable,
    toggle,
    updateSettings,
    sendText,
    clearTranscript,
  };
}
