// Fast/slow router for the voice loop.
//
// The full agent turn (`prompt.submit`) runs DeepSeek's reasoning phase and loads
// the whole tool schema on every utterance — that's the "keeps thinking and
// thinking" delay. Ordinary conversation doesn't need any of that: the gateway's
// `voice.reply` path is a single tools-less streamed completion with capped
// reasoning, so it answers almost instantly.
//
// This classifier decides which path a spoken turn takes. It is deliberately
// biased toward `chat` (fast): only a clear action, device-control, or live-lookup
// signal routes to the `agent` path, because those genuinely need tools (and the
// clarify behaviour). Everything else — greetings, opinions, general knowledge,
// follow-ups, banter — goes to the fast path.

export type VoiceIntent = 'agent' | 'chat'

// Patterns that require the full tool-calling agent: real actions, device/system
// control, or facts that must be looked up live (and would be hallucinated by a
// tools-less reply). Kept broad but anchored on verbs/nouns so plain chat about
// these topics ("I love this song") doesn't trip them.
const AGENT_PATTERNS: RegExp[] = [
  // App / window / system control
  /\b(open|launch|quit|close|reopen|re-open|switch to|bring up|fire up|boot up)\b/,
  // Media / playback control
  /\b(play|pause|resume|un-?pause|skip|next (track|song|one)|previous (track|song)|rewind|shuffle|repeat|volume|turn it (up|down)|louder|quieter|mute|unmute|drop the needle|put on some|put on the)\b/,
  // Web / search / lookup
  /\b(search|google|look (it |that )?up|look up|browse|pull up|show me)\b/,
  // Messaging / comms
  /\b(send|text|message|e-?mail|reply to|call|dial|ring|whatsapp|slack|dm)\b/,
  // Create / edit / file & code ops
  /\b(write|create|make me|build|generate|draft|compose|code|program|refactor|edit|append|save|delete|remove|move|rename|copy|paste)\b/,
  // Scheduling / reminders / notes
  /\b(remind me|reminder|set (a|an) (timer|alarm)|start a timer|timer for|alarm for|schedule|add .* (to|on) (my )?(calendar|list|reminders?|agenda)|take a note|note that|jot (this |that )?down)\b/,
  // Run / dev / capture
  /\b(run|execute|install|update|upgrade|download|deploy|screenshot|screen shot|capture (the )?screen|record (the )?screen)\b/,
  // Device / OS settings
  /\b(turn (on|off)|toggle|brightness|wi-?fi|bluetooth|airplane mode|do not disturb|dark mode|light mode|night shift)\b/,
  // Live facts that must be fetched (would be guessed by the tools-less path)
  /\b(weather|forecast|temperature (outside|today)|how (hot|cold|warm) is it)\b/,
  /\b(news|headlines|stock price|exchange rate)\b/,
  /\bmy (calendar|schedule|agenda|inbox|e-?mails?|unread|messages|reminders?|tasks|to-?dos?|notes|files)\b/,
  /\bwhat('?s| is) the (time|date)\b/,
  /\bwhat time is it\b/,
  /\btoday'?s (date|schedule|agenda)\b/,
  /\bhow many .* (do i have|in my)\b/,
  // Hand-control trigger (Phase E) — routed to the agent path for now.
  /\b(control panel|app controls?|hand controls?)\b/,
]

/**
 * Route a spoken utterance to the fast tools-less reply (`chat`) or the full
 * tool-calling agent (`agent`). Biased toward `chat`; returns `agent` only on a
 * clear action / device-control / live-lookup signal.
 */
export function classifyVoiceIntent(text: string): VoiceIntent {
  const t = text.trim().toLowerCase()

  if (!t) {
    return 'chat'
  }

  for (const re of AGENT_PATTERNS) {
    if (re.test(t)) {
      return 'agent'
    }
  }

  return 'chat'
}
