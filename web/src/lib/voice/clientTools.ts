/**
 * Executors for the client-side voice commands classified in `commands.ts`.
 *
 * These are the "client tools" the voice assistant can invoke to control the
 * dashboard: navigation, management actions (via the shared `api` client and
 * the SystemActions context), and voice-setting toggles. Each returns a short
 * spoken confirmation.
 */
import { api } from "@/lib/api";
import type {
  DashboardActionName,
  SettingCommand,
  VoiceCommand,
} from "@/lib/voice/commands";

export interface CommandDeps {
  /** react-router navigate. */
  navigate: (path: string) => void;
  /** Apply a voice/session setting change (mute, sleep, wake word, …). */
  applySetting: (setting: SettingCommand) => void;
  /** Interrupt current TTS playback. */
  stopSpeaking: () => void;
}

/** Result of executing a command: what to speak back (may be empty). */
export interface CommandResult {
  say: string;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fuzzy-match a spoken name against a list of candidate names. */
function findByName<T>(
  items: T[],
  spoken: string,
  nameOf: (item: T) => string,
): T | null {
  const target = normalizeName(spoken);
  if (!target) return null;
  // Exact, then startsWith, then substring (both directions).
  const named = items.map((item) => ({ item, name: normalizeName(nameOf(item)) }));
  return (
    named.find((n) => n.name === target)?.item ??
    named.find((n) => n.name.startsWith(target))?.item ??
    named.find((n) => n.name.includes(target) || target.includes(n.name))?.item ??
    null
  );
}

/**
 * Execute a non-delegate voice command. `delegate` commands are handled by the
 * orchestrator (they go to the Hermes agent), so this throws if handed one.
 */
export async function executeCommand(
  command: VoiceCommand,
  deps: CommandDeps,
): Promise<CommandResult> {
  switch (command.kind) {
    case "navigate":
      deps.navigate(command.path);
      return { say: command.say };

    case "stop":
      deps.stopSpeaking();
      return { say: command.say };

    case "setting":
      deps.applySetting(command.setting);
      return { say: command.say };

    case "action":
      return runAction(command.action, command.args, command.say, deps);

    case "delegate":
      throw new Error("delegate commands are handled by the orchestrator");
  }
}

async function runAction(
  action: DashboardActionName,
  args: string,
  say: string,
  deps: CommandDeps,
): Promise<CommandResult> {
  switch (action) {
    case "restart-gateway":
      await api.restartGateway();
      return { say };
    case "update-hermes":
      await api.updateHermes();
      return { say };
    case "start-gateway":
      await api.startGateway();
      return { say: "Gateway started." };
    case "stop-gateway":
      await api.stopGateway();
      return { say: "Gateway stopped." };

    case "enable-skill":
    case "disable-skill": {
      const enable = action === "enable-skill";
      const skills = await api.getSkills();
      const skill = findByName(skills, args, (s) => s.name);
      if (!skill) {
        return { say: `I couldn't find a skill called ${args}.` };
      }
      if (skill.enabled === enable) {
        return {
          say: `The ${skill.name} skill is already ${enable ? "enabled" : "disabled"}.`,
        };
      }
      await api.toggleSkill(skill.name, enable);
      return {
        say: `${enable ? "Enabled" : "Disabled"} the ${skill.name} skill.`,
      };
    }

    case "trigger-cron": {
      const jobs = await api.getCronJobs();
      const job = findByName(jobs, args, (j) => j.name || j.id);
      if (!job) {
        return { say: `I couldn't find a job called ${args}.` };
      }
      await api.triggerCronJob(job.id, job.profile || "default");
      return { say: `Triggered the ${job.name || job.id} job.` };
    }

    case "search-sessions": {
      const res = await api.searchSessions(args);
      const n = res.results.length;
      deps.navigate("/sessions");
      return {
        say:
          n === 0
            ? `No sessions matched ${args}.`
            : `Found ${n} session${n === 1 ? "" : "s"} matching ${args}.`,
      };
    }

    default:
      return { say };
  }
}
