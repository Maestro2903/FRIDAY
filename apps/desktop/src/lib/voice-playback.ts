import { speakText } from '@/hermes'
import {
  $voicePlayback,
  setVoicePlaybackState,
  type VoicePlaybackSource,
  type VoicePlaybackState
} from '@/store/voice-playback'

import { sanitizeTextForSpeech } from './speech-text'

// Free Edge TTS occasionally hands back audio that never fires `playing`/`ended`
// nor `error` — leaving voice mode stuck "speaking" forever. Reject if playback
// fails to start or stalls mid-stream for this long (rearmed on each progress
// tick, so legitimately long speech is never cut off).
const PLAYBACK_STALL_MS = 15_000

// Spoken-reply speed. Speed is handled natively by the TTS voice (`tts.<engine>.
// speed` in config) for clean prosody; the client rate stays at 1.0 so delivery
// reads natural and human rather than rushed (a client speed-up is the main
// "robotic/hurried" culprit). Exported so the streaming speaker uses the same
// rate. Nudge up slightly only if you want a snappier cadence.
export const VOICE_PLAYBACK_RATE = 1.0

let currentAudio: HTMLAudioElement | null = null
let currentStop: (() => void) | null = null
let sequence = 0

function currentState(
  status: VoicePlaybackState['status'],
  options?: VoicePlaybackOptions,
  audioElement: HTMLAudioElement | null = null
): VoicePlaybackState {
  return {
    audioElement,
    messageId: options?.messageId ?? null,
    sequence,
    source: options?.source ?? null,
    status
  }
}

export interface VoicePlaybackOptions {
  messageId?: string | null
  source: VoicePlaybackSource
}

export function stopVoicePlayback() {
  sequence += 1
  currentStop?.()
  currentStop = null

  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio.load()
    currentAudio = null
  }

  setVoicePlaybackState({
    audioElement: null,
    messageId: null,
    sequence,
    source: null,
    status: 'idle'
  })
}

export async function playSpeechText(text: string, options: VoicePlaybackOptions): Promise<boolean> {
  stopVoicePlayback()

  const speakableText = sanitizeTextForSpeech(text)

  if (!speakableText) {
    return false
  }

  const ownSequence = sequence
  const isCurrent = () => ownSequence === sequence

  setVoicePlaybackState(currentState('preparing', options))

  try {
    const response = await speakText(speakableText)

    if (!isCurrent()) {
      return false
    }

    const audio = new Audio(response.data_url)
    // Brisk, FRIDAY-style delivery — a touch faster than 1x without chipmunking
    // (preservesPitch keeps the tone natural). Tune VOICE_PLAYBACK_RATE to taste.
    audio.playbackRate = VOICE_PLAYBACK_RATE
    currentAudio = audio
    setVoicePlaybackState(currentState('speaking', options, audio))

    await new Promise<void>((resolve, reject) => {
      let stall: number | null = null

      const cleanup = () => {
        if (stall !== null) {
          window.clearTimeout(stall)
          stall = null
        }

        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
        audio.removeEventListener('timeupdate', armStall)
        currentStop = null
      }

      const armStall = () => {
        if (stall !== null) {
          window.clearTimeout(stall)
        }

        stall = window.setTimeout(() => {
          cleanup()
          reject(new Error('Playback stalled'))
        }, PLAYBACK_STALL_MS)
      }

      const onEnded = () => {
        cleanup()
        resolve()
      }

      const onError = () => {
        cleanup()
        reject(new Error('Playback failed'))
      }

      currentStop = () => {
        cleanup()
        resolve()
      }

      audio.addEventListener('ended', onEnded, { once: true })
      audio.addEventListener('error', onError, { once: true })
      audio.addEventListener('timeupdate', armStall)
      armStall()
      void audio.play().catch(onError)
    })

    if (!isCurrent()) {
      return false
    }

    currentAudio = null
    setVoicePlaybackState(currentState('idle'))

    return true
  } catch (error) {
    if (isCurrent()) {
      currentStop = null
      currentAudio = null
      setVoicePlaybackState(currentState('idle'))
    }

    throw error
  }
}

export function isVoicePlaybackActive() {
  return $voicePlayback.get().status !== 'idle'
}
