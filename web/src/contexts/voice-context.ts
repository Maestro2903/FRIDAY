import { createContext } from "react";
import type { VoiceAssistant } from "@/lib/voice/useVoiceAssistant";

/**
 * Global voice-assistant context. Provided once (inside the Router) by
 * VoiceProvider so the hands-free loop, the Orb, and voice-driven navigation
 * work from any dashboard page — not just the /voice section.
 */
export const VoiceContext = createContext<VoiceAssistant | null>(null);
