// Spoken command intents that trigger a local desktop action instead of an agent
// turn — mirrors jarvis-quips.ts, but each match performs a side effect and can
// return a short spoken confirmation. Checked BEFORE jarvisQuip and the agent, so
// "control panel" opens the hand-control overlay rather than going to the LLM.

export interface VoiceCommand {
  test: RegExp
  /** Perform the action; return a short line to speak (or nothing). */
  run: () => string | void
}

const COMMANDS: VoiceCommand[] = [
  {
    // "control panel" / "app controls" / "hand controls" → open the app wheel.
    test: /\b(control panel|app controls?|hand controls?|open the wheel)\b/i,
    run: () => {
      void window.hermesDesktop?.handtrack?.open()
      return 'Opening the control panel.'
    }
  },
  {
    // "close the control panel" / "close controls".
    test: /\b(close|hide|dismiss) (the )?(control panel|controls?|wheel)\b/i,
    run: () => {
      void window.hermesDesktop?.handtrack?.close()
      return 'Closing the control panel.'
    }
  }
]

/**
 * If the utterance is a known local command, run it and return a confirmation
 * line (possibly empty string) to speak. Returns null when nothing matched — the
 * caller then falls through to jarvisQuip / the agent.
 */
export function voiceCommandIntent(transcript: string): string | null {
  const text = transcript.trim()

  if (!text || text.split(/\s+/).length > 8) {
    return null
  }

  for (const command of COMMANDS) {
    if (command.test.test(text)) {
      const spoken = command.run()

      return typeof spoken === 'string' ? spoken : ''
    }
  }

  return null
}
