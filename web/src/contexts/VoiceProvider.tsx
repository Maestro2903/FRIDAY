import { type ReactNode, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { VoiceContext } from "@/contexts/voice-context";
import { useVoiceAssistant, type VoiceAssistant } from "@/lib/voice/useVoiceAssistant";
import { orbAgentState, orbColors, stateLabel } from "@/lib/voice/presentation";
import { LazyOrb as Orb } from "@/components/voice/LazyOrb";
import { cn } from "@/lib/utils";

/**
 * Provides the global voice assistant and renders a small, always-available
 * floating Orb so the hands-free assistant (and voice-driven navigation) works
 * from any page. The full control center lives on the /voice route.
 *
 * Must be mounted INSIDE the Router — the assistant uses `useNavigate` to act
 * on "open <section>" commands.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const voice = useVoiceAssistant();
  return (
    <VoiceContext.Provider value={voice}>
      {children}
      <FloatingOrb voice={voice} />
    </VoiceContext.Provider>
  );
}

function FloatingOrb({ voice }: { voice: VoiceAssistant }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Hide on the dedicated Voice page (it shows the primary Orb) and when off.
  const hidden =
    location.pathname.startsWith("/voice") || voice.state === "off";

  const colors = useMemo(() => orbColors(voice.state), [voice.state]);

  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/voice")}
      title={`Hermes voice — ${stateLabel(voice.state)} (open Voice)`}
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full",
        "border border-border/60 bg-background/80 py-1.5 pl-1.5 pr-3 shadow-lg",
        "backdrop-blur transition hover:bg-background",
      )}
    >
      <span className="relative block h-9 w-9">
        <Orb
          className="absolute inset-0 h-full w-full"
          colors={colors}
          agentState={orbAgentState(voice.state)}
        />
      </span>
      <span className="text-xs font-medium text-muted-foreground">
        {stateLabel(voice.state)}
      </span>
    </button>
  );
}
