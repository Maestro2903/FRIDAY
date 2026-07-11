import type { AgentState } from '@/components/voice/orb'

/** High-level state of the Voice view, also drives the Orb + status label. */
export type VoiceOrbStatus = 'off' | 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

export function orbAgentState(status: VoiceOrbStatus): AgentState {
  switch (status) {
    case 'listening':
      return 'listening'

    case 'transcribing':

    case 'thinking':
      return 'thinking'

    case 'speaking':
      return 'talking'

    default:
      return null
  }
}

/**
 * Orb gradient colours — the official ElevenLabs blue (matches the palette used
 * on ui.elevenlabs.io). Kept constant across states; motion/animation comes from
 * the Orb's `agentState`, so it always reads as the recognizable blue orb.
 */
const ELEVENLABS_BLUE: [string, string] = ['#CADCFC', '#A0B9D1']

export function orbColors(_status: VoiceOrbStatus): [string, string] {
  return ELEVENLABS_BLUE
}

export function statusLabel(status: VoiceOrbStatus): string {
  switch (status) {
    case 'off':
      return 'Paused'

    case 'idle':
      return 'Listening…'

    case 'listening':
      return 'Hearing you'

    case 'transcribing':
      return 'Transcribing…'

    case 'thinking':
      return 'Thinking…'

    case 'speaking':
      return 'Speaking'

    default:
      return ''
  }
}
