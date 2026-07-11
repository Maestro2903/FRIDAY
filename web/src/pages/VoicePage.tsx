import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles } from "lucide-react";
import { Button } from "@nous-research/ui/ui/components/button";
import { Badge } from "@nous-research/ui/ui/components/badge";
import { Switch } from "@nous-research/ui/ui/components/switch";
import { Label } from "@nous-research/ui/ui/components/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@nous-research/ui/ui/components/card";

import { useVoice } from "@/contexts/useVoice";
import { LazyOrb as Orb } from "@/components/voice/LazyOrb";
import { ShimmeringText } from "@/components/voice/shimmering-text";
import { orbAgentState, orbColors, stateLabel } from "@/lib/voice/presentation";
import { cn } from "@/lib/utils";

const EXAMPLES: { group: string; items: string[] }[] = [
  {
    group: "Navigate",
    items: ["Hermes, open Skills", "go to Cron", "show me Analytics"],
  },
  {
    group: "Control",
    items: [
      "restart the gateway",
      "enable the web search skill",
      "trigger the daily digest job",
      "search sessions for invoices",
    ],
  },
  {
    group: "Ask Hermes",
    items: [
      "what's on my schedule today?",
      "summarize my last session",
      "search the web for the weather in Tokyo",
    ],
  },
];

export default function VoicePage() {
  const voice = useVoice();
  const {
    state,
    settings,
    transcript,
    partialReply,
    error,
    gatewayConnected,
    toggle,
    updateSettings,
    sendText,
    clearTranscript,
  } = voice;

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const colors = useMemo(() => orbColors(state), [state]);
  const isOn = settings.enabled;
  const thinking = state === "thinking" || state === "transcribing";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, partialReply]);

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    sendText(text);
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      {/* ── Orb + primary control ─────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <div className="relative h-48 w-48 sm:h-56 sm:w-56">
            <Orb
              className="absolute inset-0 h-full w-full"
              colors={colors}
              agentState={orbAgentState(state)}
            />
          </div>

          <div className="flex h-7 items-center">
            {thinking ? (
              <ShimmeringText
                text={stateLabel(state)}
                className="text-lg"
                spread={1}
              />
            ) : (
              <span
                className={cn(
                  "text-lg font-medium",
                  state === "listening"
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {isOn ? stateLabel(state) : "Voice is off"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              ghost={isOn}
              onClick={toggle}
              className="gap-2"
            >
              {isOn ? (
                <>
                  <MicOff className="h-4 w-4" /> Stop listening
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" /> Start listening
                </>
              )}
            </Button>
            <Badge tone={gatewayConnected ? "secondary" : "outline"}>
              Hermes {gatewayConnected ? "connected" : "idle"}
            </Badge>
          </div>

          {error && (
            <p className="max-w-md text-center text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Conversation ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Conversation
          </CardTitle>
          {transcript.length > 0 && (
            <Button type="button" ghost size="sm" onClick={clearTranscript}>
              Clear
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div
            ref={scrollRef}
            className="flex max-h-[42vh] min-h-[8rem] flex-col gap-3 overflow-y-auto pr-1"
          >
            {transcript.length === 0 && !partialReply ? (
              <EmptyState />
            ) : (
              <>
                {transcript.map((entry) => (
                  <MessageRow
                    key={entry.id}
                    role={entry.role}
                    text={entry.text}
                  />
                ))}
                {partialReply && (
                  <MessageRow role="assistant" text={partialReply} streaming />
                )}
              </>
            )}
          </div>

          {/* Text command fallback */}
          <div className="mt-4 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitDraft();
              }}
              placeholder="Type a command or question…"
              className={cn(
                "min-w-0 flex-1 rounded-md border border-border bg-background",
                "px-3 py-2 text-sm outline-none focus:border-ring",
              )}
            />
            <Button
              type="button"
              size="sm"
              onClick={submitDraft}
              disabled={!draft.trim()}
              className="gap-2"
            >
              <Send className="h-4 w-4" /> Send
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Settings + examples ───────────────────────────────────────── */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Voice settings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <SettingRow
              label="Speak replies"
              hint="Read Hermes's answers aloud."
            >
              <Switch
                checked={settings.speakReplies}
                onCheckedChange={(v: boolean) =>
                  updateSettings({ speakReplies: v })
                }
              />
            </SettingRow>

            <SettingRow
              label="Require wake word"
              hint="Only act on commands that start with the wake word."
            >
              <Switch
                checked={settings.wakeWordEnabled}
                onCheckedChange={(v: boolean) =>
                  updateSettings({ wakeWordEnabled: v })
                }
              />
            </SettingRow>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wake-word">Wake word</Label>
              <input
                id="wake-word"
                value={settings.wakeWord}
                onChange={(e) =>
                  updateSettings({ wakeWord: e.target.value.toLowerCase() })
                }
                className={cn(
                  "rounded-md border border-border bg-background px-3 py-2 text-sm",
                  "outline-none focus:border-ring",
                )}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="vad">
                Mic sensitivity ({Math.round(settings.vadThreshold * 1000)})
              </Label>
              <input
                id="vad"
                type="range"
                min={0.01}
                max={0.12}
                step={0.005}
                value={settings.vadThreshold}
                onChange={(e) =>
                  updateSettings({ vadThreshold: Number(e.target.value) })
                }
              />
              <p className="text-xs text-muted-foreground">
                Lower = more sensitive (picks up quieter speech). Raise it if it
                triggers on background noise.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              TTS voice &amp; provider are configured under{" "}
              <span className="font-medium">Config → Voice</span>.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Try saying</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {EXAMPLES.map((ex) => (
              <div key={ex.group} className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase text-muted-foreground">
                  {ex.group}
                </span>
                <ul className="flex flex-col gap-1">
                  {ex.items.map((item) => (
                    <li key={item}>
                      <button
                        type="button"
                        onClick={() => sendText(item)}
                        className="text-left text-sm text-foreground/90 hover:text-foreground hover:underline"
                      >
                        “{item}”
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function MessageRow({
  role,
  text,
  streaming,
}: {
  role: "user" | "assistant" | "system";
  text: string;
  streaming?: boolean;
}) {
  if (role === "system") {
    return (
      <div className="text-center text-xs text-destructive">{text}</div>
    );
  }
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
          isUser
            ? "bg-primary/15 text-foreground"
            : "bg-muted text-foreground",
          streaming && "opacity-90",
        )}
      >
        {text}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
      <p className="text-sm font-medium text-foreground">
        Say “Hermes…” to get started
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        Ask a question, or tell Hermes to navigate the dashboard and run
        actions. Your conversation appears here.
      </p>
    </div>
  );
}
