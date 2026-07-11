import { lazy, Suspense } from "react";
import type { AgentState } from "@/components/voice/orb";

/**
 * Lazy wrapper around the Orb so three.js / @react-three/fiber are code-split
 * into their own chunk — they load only when a voice Orb is actually rendered
 * (the Voice page, or the floating badge when the assistant is enabled), not in
 * the dashboard's initial bundle.
 */
const Orb = lazy(() =>
  import("@/components/voice/orb").then((m) => ({ default: m.Orb })),
);

export interface LazyOrbProps {
  className?: string;
  colors?: [string, string];
  agentState?: AgentState;
}

export function LazyOrb(props: LazyOrbProps) {
  return (
    <Suspense
      fallback={
        <div className="h-full w-full rounded-full bg-muted/30" aria-hidden />
      }
    >
      <Orb {...props} />
    </Suspense>
  );
}
