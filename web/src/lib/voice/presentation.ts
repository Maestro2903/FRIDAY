/** Presentation helpers mapping the voice state to Orb inputs + labels. */
import type { AgentState } from "@/components/voice/orb";
import type { VoiceState } from "@/lib/voice/types";

export function orbAgentState(state: VoiceState): AgentState {
  switch (state) {
    case "listening":
      return "listening";
    case "transcribing":
    case "thinking":
      return "thinking";
    case "speaking":
      return "talking";
    default:
      return null;
  }
}

/** Orb gradient colors per state — Hermes teal at rest, warmer while active. */
export function orbColors(state: VoiceState): [string, string] {
  switch (state) {
    case "listening":
      return ["#7DE2D1", "#2BB6A3"];
    case "transcribing":
    case "thinking":
      return ["#FFE6CB", "#F2A15E"];
    case "speaking":
      return ["#CADCFC", "#7AA5E0"];
    default:
      return ["#5FBFB3", "#2A7A72"];
  }
}

export function stateLabel(state: VoiceState): string {
  switch (state) {
    case "off":
      return "Off";
    case "idle":
      return "Listening…";
    case "listening":
      return "Hearing you";
    case "transcribing":
      return "Transcribing…";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking";
    default:
      return "";
  }
}
