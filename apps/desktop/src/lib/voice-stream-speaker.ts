import { speakText } from '@/hermes'

import { sanitizeTextForSpeech } from './speech-text'

/**
 * A gapless streaming speaker for the voice assistant.
 *
 * As reply text streams in, the caller `push()`es sentence/clause chunks. Each
 * chunk's TTS is synthesized IMMEDIATELY (prefetch) — so while sentence N is
 * playing, sentence N+1 is already being synthesized — and clips are played
 * back-to-back with no gap. This gives a low time-to-first-audio (speak the
 * first sentence the moment it's ready) AND a continuous, flowing delivery.
 *
 * Failure isolation: a chunk whose TTS fails is skipped, never wedging the
 * queue. `cancel()` stops playback instantly (barge-in).
 */
export interface StreamingSpeaker {
  /** Queue a text chunk — its audio starts synthesizing right away. */
  push: (text: string) => void
  /** No more chunks are coming; `run` resolves once the queue drains. */
  close: () => void
  /** Barge-in: stop the current clip, drop the queue, ignore further pushes. */
  cancel: () => void
  /** Play queued clips in order until closed+drained (or cancelled). */
  run: (onFirstAudio?: () => void) => Promise<void>
}

// A clip that never fires `ended`/`error` (rare free-TTS hiccup) must not wedge
// the queue — advance after this long.
const CLIP_STALL_MS = 15_000

export function createStreamingSpeaker(playbackRate: number): StreamingSpeaker {
  const queue: Array<Promise<string | null>> = []
  let closed = false
  let cancelled = false
  let current: HTMLAudioElement | null = null

  const fetchAudio = async (text: string): Promise<string | null> => {
    const clean = sanitizeTextForSpeech(text)

    if (!clean) {
      return null
    }

    // Retry once on a transient TTS failure so a sentence isn't silently
    // dropped (the backend also falls Edge→Deepgram, this covers network blips).
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (cancelled) {
        return null
      }

      try {
        const res = await speakText(clean)

        if (res.data_url) {
          return res.data_url
        }
      } catch {
        /* fall through to retry */
      }

      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 250))
      }
    }

    return null
  }

  const push = (text: string) => {
    if (cancelled || closed) {
      return
    }

    // Fire the synth now (don't await) — this is the prefetch that hides latency.
    queue.push(fetchAudio(text))
  }

  const close = () => {
    closed = true
  }

  const cancel = () => {
    cancelled = true
    closed = true

    if (current) {
      try {
        current.pause()
        current.src = ''
      } catch {
        /* ignore */
      }

      current = null
    }
  }

  const playClip = (dataUrl: string): Promise<void> =>
    new Promise(resolve => {
      if (cancelled) {
        resolve()

        return
      }

      const audio = new Audio(dataUrl)
      // Keep the timbre natural when sped up (no chipmunk).
      audio.preservesPitch = true
      audio.playbackRate = playbackRate
      current = audio

      let done = false
      let stall: number | null = null

      const finish = () => {
        if (done) {
          return
        }

        done = true

        if (stall !== null) {
          window.clearTimeout(stall)
        }

        audio.onended = null
        audio.onerror = null

        if (current === audio) {
          current = null
        }

        resolve()
      }

      audio.onended = finish
      audio.onerror = finish
      stall = window.setTimeout(finish, CLIP_STALL_MS)
      audio.play().catch(finish)
    })

  const run = async (onFirstAudio?: () => void): Promise<void> => {
    let played = 0
    let firstAudio = false

    while (!cancelled) {
      if (played < queue.length) {
        const dataUrl = await queue[played]
        played += 1

        if (cancelled) {
          break
        }

        if (dataUrl) {
          if (!firstAudio) {
            firstAudio = true
            onFirstAudio?.()
          }

          await playClip(dataUrl)
        }
      } else if (closed) {
        break
      } else {
        // Waiting for the next streamed chunk.
        await new Promise(r => setTimeout(r, 30))
      }
    }
  }

  return { push, close, cancel, run }
}
