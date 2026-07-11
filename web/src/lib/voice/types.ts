/** Shared types for the Hermes voice assistant ("Jarvis"). */

/** High-level state of the assistant, also drives the Orb's `agentState`. */
export type VoiceState =
  | "off" // mic disabled
  | "idle" // listening for the wake word / speech
  | "listening" // capturing an utterance
  | "transcribing" // running STT on the captured audio
  | "thinking" // Hermes agent is producing a reply
  | "speaking"; // TTS playback in progress

/** One line in the conversation transcript. */
export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  /** Unix ms; stamped by the caller (kept out of pure logic for testability). */
  at: number;
  /** For assistant entries produced by a local dashboard action, not the agent. */
  kind?: "action" | "agent";
}

/** User-tunable voice settings, persisted to localStorage. */
export interface VoiceSettings {
  /** Master enable — mic capture + hands-free loop. */
  enabled: boolean;
  /** Require the wake word to prefix a command before acting. */
  wakeWordEnabled: boolean;
  /** The wake word/phrase (lower-cased match against the transcript start). */
  wakeWord: string;
  /** Speak assistant replies aloud via TTS. */
  speakReplies: boolean;
  /** Preferred ElevenLabs voice id ("" = server default / configured provider). */
  voiceId: string;
  /** RMS energy (0..1) above which we treat the mic as hearing speech. */
  vadThreshold: number;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  wakeWordEnabled: true,
  wakeWord: "hermes",
  speakReplies: true,
  voiceId: "",
  vadThreshold: 0.045,
};

export const VOICE_SETTINGS_STORAGE_KEY = "hermes.voice.settings";

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return { ...DEFAULT_VOICE_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  try {
    localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota — best effort */
  }
}
