/**
 * Instant J.A.R.V.I.S. responses for common voice openers (wake calls,
 * greetings, status checks, thanks). These short, in-character lines are spoken
 * immediately — bypassing the LLM — so those interactions feel snappy and
 * exactly like JARVIS. Anything not matched still goes to the Hermes agent.
 */

interface Quip {
  test: RegExp
  /** One line is chosen deterministically per match. */
  replies: string[]
}

const QUIPS: Quip[] = [
  {
    // "Jarvis, wake up" / "you awake"
    test: /\b(wake up|you awake|are you awake|boot up|you up)\b/,
    replies: ["For you, Sir, always — I never truly sleep.", "At your service, Sir."],
  },
  {
    // greetings — "hey jarvis", "hi", "hello", "morning jarvis", or just "jarvis"
    test: /^(hey|hi|hello|yo|good morning|morning|good evening|good afternoon)?[,\s]*(jarvis|there)?[!?.\s]*$/,
    replies: ["At your service, Sir. Systems are online.", "Good to see you, Sir. How may I help?"],
  },
  {
    test: /\b(good morning)\b/,
    replies: ["Good morning, Sir. All systems are online."],
  },
  {
    test: /\b(good night|goodnight)\b/,
    replies: ["Good night, Sir. I'll keep watch."],
  },
  {
    // "you there?" / "still there?"
    test: /\b(you there|are you there|still there|can you hear me)\b/,
    replies: ["Always, Sir. How may I help?"],
  },
  {
    // status checks
    test: /\b(status|status report|report|how are we looking|systems check|you good|all good)\b/,
    replies: ["All systems nominal, Sir. What do you require?", "Everything's in order, Sir."],
  },
  {
    // gratitude / praise
    test: /\b(thank you|thanks|thank ya|good job|nice work|well done|good work|appreciate it)\b/,
    replies: ["A pleasure, Sir.", "Of course, Sir."],
  },
  {
    // identity
    test: /\b(who are you|what are you|what's your name|what is your name)\b/,
    replies: ["J.A.R.V.I.S., Sir — at your service."],
  },
  {
    // capability
    test: /\b(what can you do|what do you do|help me|your capabilities)\b/,
    replies: ["I manage your terminal, browser, files, and this app, Sir. Point me at a task."],
  },
]

/**
 * Return an instant JARVIS line for a recognized opener, or null to defer to
 * the agent. `seed` (e.g. transcript length) keeps selection deterministic.
 */
export function jarvisQuip(transcript: string, seed = transcript.length): string | null {
  const text = transcript.trim().toLowerCase().replace(/[.,!?;:]+$/g, '')

  if (!text || text.split(/\s+/).length > 7) {
    // Longer utterances are real requests — send them to the brain.
    return null
  }

  for (const quip of QUIPS) {
    if (quip.test.test(text)) {
      return quip.replies[seed % quip.replies.length]
    }
  }

  return null
}
