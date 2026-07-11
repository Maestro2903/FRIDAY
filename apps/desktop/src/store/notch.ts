// Bridge between the main renderer (which owns the voice loop) and the notch HUD
// window (a transparent NSPanel that only renders state). The main renderer
// pushes voice/orb state; the notch renders it and sends control messages back.
//
// The notch is a DISPLAY, not a second voice engine — an overlay window can't
// reach the gateway (that's set up in the full app shell), so the /voice view
// owns the gateway + mic + TTS and mirrors its state here.

import type { VoiceOrbStatus } from '../app/voice/presentation'

export type NotchPersona = 'jarvis' | 'friday'

export interface NotchState {
  /** Orb/agent state — drives the orb colour + the face expression. */
  status: VoiceOrbStatus
  /** Latest user utterance (transcript). */
  userText: string
  /** Latest / streaming assistant reply. */
  replyText: string
  muted: boolean
  persona: NotchPersona
}

export type NotchControl =
  | { type: 'close' }
  | { type: 'open-app' }
  | { type: 'toggle-mute' }
  | { type: 'submit'; text: string }

/** Main renderer → notch window: push the latest state to render. No-op if the
 *  notch window isn't open (pushes just go nowhere). */
export function pushNotchState(state: NotchState): void {
  window.hermesDesktop?.notch?.pushState(state)
}

export function openNotchWindow(): void {
  void window.hermesDesktop?.notch?.open()
}

export function closeNotchWindow(): void {
  void window.hermesDesktop?.notch?.close()
}
