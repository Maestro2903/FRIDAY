import type { GatewayEvent } from '@hermes/shared'
import { useCallback, useEffect, useRef, useState } from 'react'

import { transcribeAudio } from '@/hermes'
import { useI18n } from '@/i18n'
import { playSpeechText, stopVoicePlayback, VOICE_PLAYBACK_RATE } from '@/lib/voice-playback'
import { createStreamingSpeaker, type StreamingSpeaker } from '@/lib/voice-stream-speaker'
import { activeGateway, ensureActiveGatewayOpen } from '@/store/gateway'
import { notifyError } from '@/store/notifications'
import { broadcastSessionsChanged } from '@/store/session-sync'

import { useMicRecorder } from '../chat/composer/hooks/use-mic-recorder'

import { jarvisQuip } from './jarvis-quips'
import type { VoiceOrbStatus } from './presentation'
import { voiceCommandIntent } from './voice-commands'
import { classifyVoiceIntent } from './voice-intent'

export interface VoiceTranscriptEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
}

// VAD tuning. Shorter trailing-silence than the composer default so a turn
// submits promptly once you stop talking (less dead air before Jarvis replies)
// while still leaving room for a brief mid-sentence pause.
const SILENCE_LEVEL = 0.075
const SILENCE_MS = 800
const IDLE_SILENCE_MS = 15_000
const TURN_TIMEOUT_MS = 60_000

let entrySeq = 0

function makeEntry(role: VoiceTranscriptEntry['role'], text: string): VoiceTranscriptEntry {
  entrySeq += 1

  return { id: `vo${entrySeq}`, role, text }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Strip markdown so TTS doesn't read out symbols. */
function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

// Minimum chars before the FIRST chunk may cut on a clause boundary — gets
// audio out sooner without splitting mid-thought.
const FIRST_MIN_CHARS = 16

/**
 * Index (exclusive) at which to cut the next COMPLETE speakable chunk from
 * `text` starting at `from`, or -1 if none is ready yet. A sentence-ender
 * counts only when a whitespace char follows it in the buffer (so "3.8s" /
 * "en-GB" / a trailing "..." mid-stream don't split). When `allowClause`, the
 * first chunk may also cut at a clause boundary once long enough.
 */
function nextSentenceCut(text: string, from: number, allowClause: boolean): number {
  for (let i = from; i < text.length - 1; i++) {
    const ch = text[i]
    const nextIsSpace = /\s/.test(text[i + 1])

    if ((ch === '.' || ch === '!' || ch === '?' || ch === '…') && nextIsSpace) {
      return i + 1
    }

    if (
      allowClause &&
      (ch === ',' || ch === ';' || ch === ':' || ch === '—') &&
      i - from >= FIRST_MIN_CHARS &&
      nextIsSpace
    ) {
      return i + 1
    }
  }

  return -1
}

// localStorage key remembering the voice conversation's stored session id, so
// reopening the Voice view (or restarting the app) continues the SAME session —
// the agent keeps its memory and the row stays in the Sessions list.
const VOICE_SESSION_KEY = 'hermes.voice.sessionId'

interface PendingTurn {
  sessionId: string
  buffer: string
  done: boolean
  final: string
  error: string | null
  /** Fired on each streamed delta (drives live text + the TTS pump). */
  onDelta?: () => void
}

export interface VoiceOrb {
  status: VoiceOrbStatus
  level: number
  muted: boolean
  transcript: VoiceTranscriptEntry[]
  partialReply: string
  error: string | null
  toggleMute: () => void
  stopTurn: () => void
  clearTranscript: () => void
}

/**
 * Hands-free voice loop for the desktop Voice view. Runs while `active`:
 *   mic (VAD) → STT → Hermes agent (dedicated session on the shared gateway)
 *             → spoken reply (TTS) → back to listening.
 *
 * Reuses the desktop's mic recorder, transcription, gateway, and playback so it
 * inherits the app's Electron mic-permission flow and backend auth.
 */
export function useVoiceOrb(active: boolean): VoiceOrb {
  const { t } = useI18n()
  const voiceCopy = t.notifications.voice
  const { handle, level } = useMicRecorder(voiceCopy)

  const [status, setStatus] = useState<VoiceOrbStatus>('off')
  const [muted, setMuted] = useState(false)
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([])
  const [partialReply, setPartialReply] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeRef = useRef(active)
  const mutedRef = useRef(muted)
  const busyRef = useRef(false)
  const turnClosingRef = useRef(false)
  const turnTimeoutRef = useRef<number | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  // The persistent DB session id (for resume + close). Memory + the Sessions
  // list are owned by the Hermes session now, not a client-side buffer.
  const storedSessionIdRef = useRef<string | null>(null)
  const offFnsRef = useRef<Array<() => void>>([])
  const pendingTurnRef = useRef<PendingTurn | null>(null)
  const interruptRef = useRef(false)
  const speakerRef = useRef<StreamingSpeaker | null>(null)

  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  // Mirror the transcript into a ref so the fast-path (`voice.reply`) can send
  // recent conversation history without re-creating askAndSpeak on every turn.
  const transcriptRef = useRef<VoiceTranscriptEntry[]>([])
  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  const pushEntry = useCallback((entry: VoiceTranscriptEntry) => {
    setTranscript(prev => [...prev, entry])
  }, [])

  const clearTurnTimeout = () => {
    if (turnTimeoutRef.current) {
      window.clearTimeout(turnTimeoutRef.current)
      turnTimeoutRef.current = null
    }
  }

  // ── Gateway session (Hermes brain) ─────────────────────────────────────
  const ensureSession = useCallback(async (): Promise<{
    gateway: NonNullable<ReturnType<typeof activeGateway>>
    sessionId: string
  }> => {
    const gateway = (await ensureActiveGatewayOpen()) ?? activeGateway()

    if (!gateway) {
      throw new Error('Hermes gateway is not connected')
    }

    if (!sessionIdRef.current) {
      // One-time listeners for our session's streamed reply.
      offFnsRef.current.push(
        gateway.on('message.delta', (event: GatewayEvent<{ text?: string }>) => {
          const turn = pendingTurnRef.current

          if (!turn || event.session_id !== turn.sessionId) {
            return
          }

          turn.buffer += event.payload?.text ?? ''

          if (turn.onDelta) {
            turn.onDelta()
          } else {
            setPartialReply(turn.buffer)
          }
        })
      )
      offFnsRef.current.push(
        gateway.on('message.complete', (event: GatewayEvent<{ text?: string }>) => {
          const turn = pendingTurnRef.current

          if (!turn || event.session_id !== turn.sessionId) {
            return
          }

          // End-of-turn: mark done + capture the authoritative full text. The
          // streaming speak-loop drains any remaining buffer, then exits.
          turn.final = (event.payload?.text ?? '').trim() || turn.buffer.trim()
          turn.done = true
        })
      )

      // Continue the previous voice session if we have one, so the agent keeps
      // its memory across reopens/restarts; otherwise start a fresh persistent
      // one. `source: 'desktop'` + not close_on_disconnect makes it a first-class
      // session that shows in the Sessions list (unlike the old hidden 'tool').
      const remembered = (() => {
        try {
          return window.localStorage.getItem(VOICE_SESSION_KEY)
        } catch {
          return null
        }
      })()

      if (remembered) {
        try {
          const resumed = await gateway.request<{ session_id: string }>('session.resume', {
            session_id: remembered
          })

          sessionIdRef.current = resumed.session_id
          storedSessionIdRef.current = remembered
        } catch {
          // Stale/deleted — fall through to a fresh session.
        }
      }

      if (!sessionIdRef.current) {
        const created = await gateway.request<{ session_id: string; stored_session_id?: string | null }>(
          'session.create',
          { cols: 96, source: 'desktop', close_on_disconnect: false, title: 'Voice' }
        )

        sessionIdRef.current = created.session_id
        storedSessionIdRef.current = created.stored_session_id ?? null

        if (storedSessionIdRef.current) {
          try {
            window.localStorage.setItem(VOICE_SESSION_KEY, storedSessionIdRef.current)
          } catch {
            /* ignore */
          }
        }
      }
    }

    return { gateway, sessionId: sessionIdRef.current }
  }, [])

  const speakChunk = useCallback(
    async (chunk: string) => {
      const clean = stripForSpeech(chunk)

      if (!clean || mutedRef.current) {
        return
      }

      try {
        await playSpeechText(clean, { source: 'voice-conversation' })
      } catch (e) {
        notifyError(e, t.notifications.voice.playbackFailed)
      }
    },
    [t]
  )

  /**
   * Submit the request and speak the reply AS IT STREAMS. Reply text is shown
   * live; each finished sentence is synthesized immediately (prefetch) and
   * played back-to-back with no gaps — so first audio comes within a sentence
   * of the first token, and the delivery flows.
   *
   * Fast/slow routed:
   *  - Conversational turns (chit-chat, opinions, general knowledge, follow-ups)
   *    go to the tools-less streaming `voice.reply` — near-instant, no reasoning
   *    blow-up, no tool schema. Recent transcript is sent as history for context.
   *  - Action / device-control / live-lookup turns go to the full agent
   *    (`prompt.submit`) so tools + the clarify behaviour are available; those
   *    are persisted and show in the Sessions list.
   */
  const askAndSpeak = useCallback(
    async (text: string): Promise<string> => {
      const { gateway, sessionId } = await ensureSession()
      setPartialReply('')
      interruptRef.current = false

      const speaker = createStreamingSpeaker(VOICE_PLAYBACK_RATE)
      speakerRef.current = speaker

      const turn: PendingTurn = { sessionId, buffer: '', done: false, final: '', error: null }

      // Slice complete sentences off the growing buffer and hand them to the
      // speaker (which synthesizes + plays them gaplessly).
      let spoken = 0
      let firstChunk = true

      const pump = (flush: boolean) => {
        if (mutedRef.current || interruptRef.current) {
          return
        }

        for (;;) {
          const cut = nextSentenceCut(turn.buffer, spoken, firstChunk)

          if (cut < 0) {
            break
          }

          const chunk = turn.buffer.slice(spoken, cut).trim()
          spoken = cut

          if (chunk) {
            speaker.push(chunk)
            firstChunk = false
          }
        }

        if (flush) {
          const tail = turn.buffer.slice(spoken).trim()

          if (tail) {
            speaker.push(tail)
          }

          spoken = turn.buffer.length
        }
      }

      turn.onDelta = () => {
        setPartialReply(turn.buffer)
        pump(false)
      }

      pendingTurnRef.current = turn

      // Fast/slow router. Both paths stream the SAME message.delta/message.complete
      // frames, so the pump + speaker machinery below is identical either way.
      const intent = classifyVoiceIntent(text)

      if (intent === 'chat') {
        // Send recent user/assistant turns as context. The current user turn was
        // already pushed to the transcript before this call — drop a trailing
        // duplicate so it isn't sent twice (the server takes `text` separately).
        const history = transcriptRef.current
          .filter(e => e.role === 'user' || e.role === 'assistant')
          .map(e => ({ role: e.role, content: e.text }))

        const last = history[history.length - 1]

        if (last && last.role === 'user' && last.content === text) {
          history.pop()
        }

        void gateway
          .request('voice.reply', { session_id: sessionId, text, history: history.slice(-8) })
          .catch((e: Error) => {
            turn.error = e.message
            turn.done = true
          })
      } else {
        void gateway.request('prompt.submit', { session_id: sessionId, text }).catch((e: Error) => {
          turn.error = e.message
          turn.done = true
        })
      }

      setStatus('thinking')

      const runPromise = speaker.run(() => {
        if (!interruptRef.current) {
          setStatus('speaking')
        }
      })

      const startedAt = Date.now()

      while (!turn.done) {
        if (interruptRef.current) {
          break
        }

        if (turn.error && !turn.buffer) {
          speaker.cancel()
          throw new Error(turn.error)
        }

        if (Date.now() - startedAt > 180_000) {
          break
        }

        await delay(60)
      }

      pump(true) // flush the final sentence
      speaker.close() // no more chunks — run() resolves once the queue drains
      await runPromise

      const finalText = (turn.final || turn.buffer).trim()
      pendingTurnRef.current = null

      if (speakerRef.current === speaker) {
        speakerRef.current = null
      }

      setPartialReply('')

      return finalText
    },
    [ensureSession]
  )

  // ── Turn processing ────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (!activeRef.current || mutedRef.current || busyRef.current) {
      return
    }

    try {
      await handle.start({
        silenceLevel: SILENCE_LEVEL,
        silenceMs: SILENCE_MS,
        idleSilenceMs: IDLE_SILENCE_MS,
        onError: e => {
          notifyError(e, voiceCopy.microphoneFailed)
          setError(e.message)
          activeRef.current = false
          setStatus('off')
        },
        onSilence: () => void handleTurnRef.current()
      })
      setStatus('idle')
      clearTurnTimeout()
      turnTimeoutRef.current = window.setTimeout(() => void handleTurnRef.current(), TURN_TIMEOUT_MS)
    } catch (e) {
      notifyError(e, voiceCopy.couldNotStartSession)
      setStatus('off')
    }
  }, [handle, voiceCopy.couldNotStartSession, voiceCopy.microphoneFailed])

  const handleTurn = useCallback(async () => {
    if (turnClosingRef.current) {
      return
    }

    turnClosingRef.current = true
    clearTurnTimeout()

    try {
      const recording = await handle.stop()

      if (!recording || !recording.heardSpeech) {
        // Nothing said — loop back to listening.
        if (activeRef.current && !mutedRef.current) {
          void startListening()
        } else {
          setStatus('idle')
        }

        return
      }

      busyRef.current = true
      setStatus('transcribing')

      let userText = ''

      try {
        const dataUrl = await blobToDataUrl(recording.audio)
        // Retry a transient STT failure once before dropping the turn — a
        // network blip shouldn't make JARVIS ignore what you said. An empty
        // transcript (silence) is a valid response, not an error, so it breaks
        // the loop rather than re-transcribing.
        let sttError: unknown = null

        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            userText = (await transcribeAudio(dataUrl, recording.audio.type)).transcript.trim()
            sttError = null

            break
          } catch (e) {
            sttError = e

            if (attempt === 0) {
              await delay(300)
            }
          }
        }

        if (sttError) {
          throw sttError
        }
      } catch (e) {
        notifyError(e, voiceCopy.transcriptionFailed)
      }

      if (!userText) {
        busyRef.current = false

        if (activeRef.current && !mutedRef.current) {
          void startListening()
        } else {
          setStatus('idle')
        }

        return
      }

      pushEntry(makeEntry('user', userText))

      // Local command intents (e.g. "control panel") — perform the desktop
      // action + speak a short confirmation, bypassing the agent entirely.
      const command = voiceCommandIntent(userText)

      if (command !== null) {
        if (command) {
          pushEntry(makeEntry('assistant', command))
          setStatus('speaking')
          await speakChunk(command)
        }

        busyRef.current = false

        if (activeRef.current && !mutedRef.current) {
          void startListening()
        } else {
          setStatus('idle')
        }

        return
      }

      // Instant JARVIS reply for greetings / wake calls / status — spoken
      // immediately without waiting on the reasoning model.
      const quip = jarvisQuip(userText)

      if (quip) {
        pushEntry(makeEntry('assistant', quip))
        setStatus('speaking')
        await speakChunk(quip)
        busyRef.current = false

        if (activeRef.current && !mutedRef.current) {
          void startListening()
        } else {
          setStatus('idle')
        }

        return
      }

      setStatus('thinking')

      try {
        // The agent streams + speaks the reply and persists the turn to the
        // session (memory + Sessions list are server-owned now).
        const reply = await askAndSpeak(userText)

        if (reply) {
          pushEntry(makeEntry('assistant', reply))
          // The session row appears/updates once the turn persists — nudge the
          // Sessions sidebar to pick it up.
          broadcastSessionsChanged()
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Hermes is unavailable.'
        setError(message)
        pushEntry(makeEntry('system', `Error: ${message}`))
      } finally {
        busyRef.current = false
      }

      // Loop back to listening for the next turn.
      if (activeRef.current && !mutedRef.current) {
        void startListening()
      } else {
        setStatus('idle')
      }
    } finally {
      turnClosingRef.current = false
    }
  }, [handle, askAndSpeak, speakChunk, startListening, pushEntry, voiceCopy.transcriptionFailed])

  // Stable ref so the mic's onSilence callback always calls the latest handler.
  const handleTurnRef = useRef(handleTurn)
  useEffect(() => {
    handleTurnRef.current = handleTurn
  }, [handleTurn])

  // ── Controls ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev

      if (next) {
        clearTurnTimeout()
        interruptRef.current = true
        speakerRef.current?.cancel()
        stopVoicePlayback()
        handle.cancel()
        setStatus('off')
      } else if (activeRef.current && !busyRef.current) {
        void startListening()
      }

      return next
    })
  }, [handle, startListening])

  const stopTurn = useCallback(() => {
    // End the current listening turn early (like the composer's Space-to-send).
    if (!busyRef.current) {
      void handleTurnRef.current()
    } else {
      // Mid-reply: barge in — stop the streaming speaker + any quip playback.
      interruptRef.current = true
      speakerRef.current?.cancel()
      stopVoicePlayback()
    }
  }, [])

  const clearTranscript = useCallback(() => {
    setTranscript([])
    setPartialReply('')
    setError(null)
  }, [])

  // ── Lifecycle: run the loop while the view is active ────────────────────
  useEffect(() => {
    activeRef.current = active

    if (active) {
      setError(null)
      setMuted(false)
      void startListening()
    } else {
      clearTurnTimeout()
      interruptRef.current = true
      speakerRef.current?.cancel()
      stopVoicePlayback()
      handle.cancel()
      setStatus('off')
    }
    // Intentionally excludes startListening/handle: we react to `active` only;
    // those callbacks are stable enough and re-running on their identity would
    // restart the mic mid-turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Teardown on unmount: close listeners + session.
  useEffect(() => {
    return () => {
      clearTurnTimeout()
      interruptRef.current = true
      speakerRef.current?.cancel()
      stopVoicePlayback()
      handle.cancel()
      offFnsRef.current.forEach(off => off())
      offFnsRef.current = []
      const gateway = activeGateway()
      const sessionId = sessionIdRef.current

      // Close (detach the live agent) but KEEP the session — its transcript
      // stays in the Sessions list and we resume it next time for memory.
      // (session.delete would destroy the row + history.)
      if (gateway && sessionId) {
        void gateway.request('session.close', { session_id: sessionId }).catch(() => {})
      }

      sessionIdRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    status,
    level,
    muted,
    transcript,
    partialReply,
    error,
    toggleMute,
    stopTurn,
    clearTranscript
  }
}
