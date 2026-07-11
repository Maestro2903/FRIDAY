import { useContext } from "react";
import { VoiceContext } from "@/contexts/voice-context";
import type { VoiceAssistant } from "@/lib/voice/useVoiceAssistant";

/** Access the global voice assistant. Throws if used outside VoiceProvider. */
export function useVoice(): VoiceAssistant {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error("useVoice must be used within a VoiceProvider");
  }
  return ctx;
}
