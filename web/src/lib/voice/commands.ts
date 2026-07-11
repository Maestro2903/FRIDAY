/**
 * Client-side command router for the Hermes voice assistant.
 *
 * This is a deterministic, offline NLU-lite layer: it maps a spoken transcript
 * to a dashboard action (navigate / management action / voice setting / stop),
 * and falls through to `delegate` for anything it doesn't recognize — those go
 * to the Hermes agent, which is the real brain for questions and agentic work.
 *
 * Keeping control commands local means navigation and high-value actions work
 * instantly and reliably without a round-trip, while Hermes still handles the
 * open-ended requests.
 */

/** A dashboard section reachable by voice → its route path. */
export interface SectionTarget {
  path: string;
  label: string;
  /** Spoken aliases (lower-case) that resolve to this section. */
  aliases: string[];
}

/** Mirrors the dashboard's sidebar (see App.tsx BUILTIN_NAV_REST). */
export const SECTIONS: SectionTarget[] = [
  { path: "/voice", label: "Voice", aliases: ["voice", "jarvis", "assistant"] },
  { path: "/chat", label: "Chat", aliases: ["chat", "terminal"] },
  {
    path: "/sessions",
    label: "Sessions",
    aliases: ["sessions", "session", "history", "conversations"],
  },
  { path: "/files", label: "Files", aliases: ["files", "file", "filesystem"] },
  {
    path: "/analytics",
    label: "Analytics",
    aliases: ["analytics", "stats", "statistics", "usage"],
  },
  { path: "/models", label: "Models", aliases: ["models", "model", "llm"] },
  { path: "/logs", label: "Logs", aliases: ["logs", "log"] },
  {
    path: "/cron",
    label: "Cron",
    aliases: ["cron", "crons", "schedule", "schedules", "automations", "jobs"],
  },
  { path: "/skills", label: "Skills", aliases: ["skills", "skill"] },
  { path: "/plugins", label: "Plugins", aliases: ["plugins", "plugin"] },
  { path: "/mcp", label: "MCP", aliases: ["mcp", "mcp servers"] },
  {
    path: "/channels",
    label: "Channels",
    aliases: ["channels", "channel", "messaging", "platforms"],
  },
  { path: "/webhooks", label: "Webhooks", aliases: ["webhooks", "webhook"] },
  {
    path: "/pairing",
    label: "Pairing",
    aliases: ["pairing", "pair", "devices"],
  },
  {
    path: "/profiles",
    label: "Profiles",
    aliases: ["profiles", "profile", "personas"],
  },
  {
    path: "/config",
    label: "Config",
    aliases: ["config", "configuration", "settings"],
  },
  {
    path: "/env",
    label: "Keys",
    aliases: ["keys", "key", "environment", "env", "secrets", "api keys"],
  },
  { path: "/system", label: "System", aliases: ["system"] },
  {
    path: "/docs",
    label: "Documentation",
    aliases: ["docs", "documentation", "help"],
  },
];

export type VoiceCommand =
  | { kind: "navigate"; path: string; label: string; say: string }
  | { kind: "action"; action: DashboardActionName; args: string; say: string }
  | { kind: "setting"; setting: SettingCommand; value?: string; say: string }
  | { kind: "stop"; say: string }
  | { kind: "delegate"; text: string };

export type DashboardActionName =
  | "restart-gateway"
  | "update-hermes"
  | "start-gateway"
  | "stop-gateway"
  | "enable-skill"
  | "disable-skill"
  | "trigger-cron"
  | "search-sessions";

export type SettingCommand =
  | "mute"
  | "unmute"
  | "stop-listening"
  | "wake-word-off"
  | "wake-word-on";

const NAV_VERBS =
  /^(?:go\s+to|open|show|show\s+me|navigate\s+to|take\s+me\s+to|switch\s+to|display|bring\s+up)\s+/;

/** Strip filler + punctuation and lower-case for matching. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove the wake word from the start of the transcript. Returns the remaining
 * command and whether the wake word was present.
 */
export function stripWakeWord(
  transcript: string,
  wakeWord: string,
): { command: string; matched: boolean } {
  const norm = normalize(transcript);
  const wake = normalize(wakeWord);
  if (!wake) return { command: norm, matched: true };
  // Match "hermes", "hey hermes", "ok hermes", "hermes," etc. at the start.
  const re = new RegExp(`^(?:hey\\s+|ok(?:ay)?\\s+)?${escapeRe(wake)}[,:\\s]+`);
  if (re.test(norm)) {
    return { command: norm.replace(re, "").trim(), matched: true };
  }
  return { command: norm, matched: false };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchSection(text: string): SectionTarget | null {
  // Exact alias, then substring containment (prefer longer aliases first).
  const all = SECTIONS.flatMap((s) =>
    s.aliases.map((a) => ({ alias: a, section: s })),
  ).sort((a, b) => b.alias.length - a.alias.length);
  for (const { alias, section } of all) {
    if (text === alias) return section;
  }
  for (const { alias, section } of all) {
    if (new RegExp(`(?:^|\\s)${escapeRe(alias)}(?:\\s|$)`).test(text)) {
      return section;
    }
  }
  return null;
}

/**
 * Classify a (wake-word-stripped) command string into a VoiceCommand.
 * Anything unrecognized becomes a `delegate` to the Hermes agent.
 */
export function classifyCommand(command: string): VoiceCommand {
  const text = normalize(command);
  if (!text) return { kind: "delegate", text: command };

  // ── Stop / cancel (barge-in via voice) ────────────────────────────────
  if (
    /^(?:stop|cancel|quiet|be\s+quiet|shush|silence|never\s*mind|nevermind|shut\s+up)$/.test(
      text,
    )
  ) {
    return { kind: "stop", say: "" };
  }

  // ── Voice/session settings ────────────────────────────────────────────
  if (/^(?:mute|mute\s+yourself|stop\s+talking|stop\s+speaking)$/.test(text)) {
    return { kind: "setting", setting: "mute", say: "Muted." };
  }
  if (/^(?:unmute|speak\s+again|start\s+talking)$/.test(text)) {
    return { kind: "setting", setting: "unmute", say: "Voice on." };
  }
  if (
    /^(?:stop\s+listening|go\s+to\s+sleep|sleep|turn\s+off\s+(?:the\s+)?mic(?:rophone)?|disable\s+(?:the\s+)?mic(?:rophone)?)$/.test(
      text,
    )
  ) {
    return {
      kind: "setting",
      setting: "stop-listening",
      say: "Going to sleep.",
    };
  }
  if (/(?:disable|turn\s+off)\s+(?:the\s+)?wake\s*word/.test(text)) {
    return { kind: "setting", setting: "wake-word-off", say: "Wake word off." };
  }
  if (/(?:enable|turn\s+on)\s+(?:the\s+)?wake\s*word/.test(text)) {
    return { kind: "setting", setting: "wake-word-on", say: "Wake word on." };
  }

  // ── System actions ────────────────────────────────────────────────────
  if (/^(?:restart|reboot)\s+(?:the\s+)?gateway$/.test(text)) {
    return {
      kind: "action",
      action: "restart-gateway",
      args: "",
      say: "Restarting the gateway.",
    };
  }
  if (/^(?:stop|shut\s+down)\s+(?:the\s+)?gateway$/.test(text)) {
    return {
      kind: "action",
      action: "stop-gateway",
      args: "",
      say: "Stopping the gateway.",
    };
  }
  if (/^(?:start|boot)\s+(?:the\s+)?gateway$/.test(text)) {
    return {
      kind: "action",
      action: "start-gateway",
      args: "",
      say: "Starting the gateway.",
    };
  }
  if (/^update\s+hermes$/.test(text)) {
    return {
      kind: "action",
      action: "update-hermes",
      args: "",
      say: "Updating Hermes.",
    };
  }

  // ── Skills ────────────────────────────────────────────────────────────
  let m =
    /^(?:enable|turn\s+on|activate)\s+(?:the\s+)?(.+?)\s+skill$/.exec(text) ||
    /^(?:enable|turn\s+on|activate)\s+skill\s+(.+)$/.exec(text);
  if (m) {
    return {
      kind: "action",
      action: "enable-skill",
      args: m[1].trim(),
      say: `Enabling the ${m[1].trim()} skill.`,
    };
  }
  m =
    /^(?:disable|turn\s+off|deactivate)\s+(?:the\s+)?(.+?)\s+skill$/.exec(text) ||
    /^(?:disable|turn\s+off|deactivate)\s+skill\s+(.+)$/.exec(text);
  if (m) {
    return {
      kind: "action",
      action: "disable-skill",
      args: m[1].trim(),
      say: `Disabling the ${m[1].trim()} skill.`,
    };
  }

  // ── Cron ──────────────────────────────────────────────────────────────
  m =
    /^(?:trigger|run|fire)\s+(?:the\s+)?(.+?)\s+(?:cron|job|schedule)$/.exec(
      text,
    ) || /^(?:trigger|run|fire)\s+(?:cron|job)\s+(.+)$/.exec(text);
  if (m) {
    return {
      kind: "action",
      action: "trigger-cron",
      args: m[1].trim(),
      say: `Triggering the ${m[1].trim()} job.`,
    };
  }

  // ── Session search ────────────────────────────────────────────────────
  m =
    /^search\s+(?:my\s+)?sessions\s+for\s+(.+)$/.exec(text) ||
    /^find\s+sessions\s+(?:about|for|with)\s+(.+)$/.exec(text);
  if (m) {
    return {
      kind: "action",
      action: "search-sessions",
      args: m[1].trim(),
      say: `Searching sessions for ${m[1].trim()}.`,
    };
  }

  // ── Navigation ────────────────────────────────────────────────────────
  if (NAV_VERBS.test(text)) {
    const rest = text.replace(NAV_VERBS, "").replace(/\bpage\b/g, "").trim();
    const section = matchSection(rest) || matchSection(text);
    if (section) {
      return {
        kind: "navigate",
        path: section.path,
        label: section.label,
        say: `Opening ${section.label}.`,
      };
    }
  }

  // ── Fallthrough: let Hermes handle it ─────────────────────────────────
  return { kind: "delegate", text: command };
}
