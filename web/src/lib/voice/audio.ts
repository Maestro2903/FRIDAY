/**
 * Browser audio engine for the Hermes voice assistant.
 *
 * Responsibilities:
 *   - Own the microphone stream + an AudioContext/AnalyserNode for VAD.
 *   - Run a hands-free voice-activity loop: detect speech onset, record the
 *     utterance with MediaRecorder, and fire a callback with the audio blob
 *     once the speaker goes quiet.
 *   - Expose a live input-volume signal (for the Orb) and TTS playback with
 *     barge-in support.
 *
 * STT/TTS hit the existing Hermes endpoints (`/api/audio/transcribe`,
 * `/api/audio/speak`) via fetchJSON so the session token + base path are
 * handled centrally.
 */
import { fetchJSON } from "@/lib/api";

export interface MicEngineCallbacks {
  /** Fired when a complete spoken utterance has been captured. */
  onUtterance: (blob: Blob, mimeType: string) => void;
  /** Fired on RAF with the current normalized input volume (0..1). */
  onVolume?: (volume: number) => void;
  /** Fired when speech starts — used for barge-in (stop TTS). */
  onSpeechStart?: () => void;
  /** Fired on a fatal mic error (permission denied, no device, …). */
  onError?: (error: Error) => void;
}

export interface MicEngineOptions {
  /** RMS threshold (0..1) for speech detection. */
  threshold: number;
  /** Silence duration (ms) that ends an utterance. */
  silenceMs?: number;
  /** Minimum utterance duration (ms) to avoid firing on clicks/noise. */
  minSpeechMs?: number;
}

function pickRecorderMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* ignore */
    }
  }
  return "audio/webm";
}

/**
 * Continuous, hands-free microphone engine. Call `start()` to open the mic and
 * begin the VAD loop; `stop()` to tear everything down. `setThreshold` allows
 * live tuning from the settings UI.
 */
export class MicEngine {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private rafId = 0;
  // Inferred as Uint8Array<ArrayBuffer> — required by AnalyserNode's typed API.
  private data = new Uint8Array(0);

  private speaking = false;
  private speechStartedAt = 0;
  private lastLoudAt = 0;
  private running = false;
  private recorderMime = "audio/webm";
  /** Paused while STT/agent/TTS runs so we don't capture our own playback. */
  private capturePaused = false;

  private readonly callbacks: MicEngineCallbacks;
  private threshold: number;
  private readonly silenceMs: number;
  private readonly minSpeechMs: number;

  constructor(callbacks: MicEngineCallbacks, options: MicEngineOptions) {
    this.callbacks = callbacks;
    this.threshold = options.threshold;
    this.silenceMs = options.silenceMs ?? 850;
    this.minSpeechMs = options.minSpeechMs ?? 250;
  }

  get isRunning(): boolean {
    return this.running;
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  /** Pause/resume utterance capture without releasing the mic (e.g. during TTS). */
  setCapturePaused(paused: boolean): void {
    this.capturePaused = paused;
    if (paused && this.speaking) {
      // Abandon any in-flight capture — we don't want to transcribe playback.
      this.discardRecording();
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error("Microphone access failed"),
      );
      return;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.audioContext = new AudioCtx();
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.data = new Uint8Array(this.analyser.fftSize);
    this.source.connect(this.analyser);

    this.recorderMime = pickRecorderMimeType();
    this.running = true;
    this.lastLoudAt = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.discardRecording();
    try {
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.audioContext?.close().catch(() => {});
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.speaking = false;
  }

  private discardRecording(): void {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.onstop = null;
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.recorder = null;
    this.chunks = [];
    this.speaking = false;
  }

  private computeRms(): number {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this.data.length);
  }

  private loop = (): void => {
    if (!this.running) return;
    const rms = this.computeRms();
    // Normalize to a friendly 0..1 for the Orb (RMS rarely exceeds ~0.5).
    this.callbacks.onVolume?.(Math.min(1, rms * 2.2));

    const now = performance.now();
    const loud = rms >= this.threshold;

    if (!this.capturePaused) {
      if (loud) {
        this.lastLoudAt = now;
        if (!this.speaking) this.beginRecording(now);
      } else if (this.speaking && now - this.lastLoudAt >= this.silenceMs) {
        this.endRecording(now);
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private beginRecording(now: number): void {
    if (!this.stream) return;
    this.speaking = true;
    this.speechStartedAt = now;
    this.chunks = [];
    try {
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: this.recorderMime,
      });
    } catch {
      // Fall back to the browser default if our preferred mime is rejected.
      this.recorder = new MediaRecorder(this.stream);
    }
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.callbacks.onSpeechStart?.();
  }

  private endRecording(now: number): void {
    const recorder = this.recorder;
    const duration = now - this.speechStartedAt;
    this.speaking = false;
    if (!recorder) return;
    this.recorder = null;

    recorder.onstop = () => {
      const chunks = this.chunks;
      this.chunks = [];
      if (duration < this.minSpeechMs || chunks.length === 0) return;
      const mime = recorder.mimeType || this.recorderMime;
      const blob = new Blob(chunks, { type: mime });
      if (blob.size > 0) this.callbacks.onUtterance(blob, mime);
    };
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }
}

/** Read a Blob as a base64 `data:` URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

interface TranscribeResponse {
  ok: boolean;
  transcript: string;
  provider?: string;
}

/** Send captured audio to Hermes STT and return the recognized text. */
export async function transcribe(blob: Blob, mimeType: string): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  const res = await fetchJSON<TranscribeResponse>("/api/audio/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data_url: dataUrl, mime_type: mimeType }),
  });
  return (res.transcript || "").trim();
}

interface SpeakResponse {
  ok: boolean;
  data_url: string;
  mime_type: string;
  provider?: string;
}

/**
 * Speak text via Hermes TTS. Returns a controllable handle so the caller can
 * interrupt playback (barge-in). Resolves when playback finishes or is stopped.
 */
export interface SpeechHandle {
  stop: () => void;
  done: Promise<void>;
}

export async function speak(text: string): Promise<SpeechHandle> {
  const res = await fetchJSON<SpeakResponse>("/api/audio/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const audio = new Audio(res.data_url);
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  const cleanup = () => {
    audio.onended = null;
    audio.onerror = null;
    resolveDone();
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  try {
    await audio.play();
  } catch {
    cleanup();
  }
  return {
    stop: () => {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
      cleanup();
    },
    done,
  };
}
