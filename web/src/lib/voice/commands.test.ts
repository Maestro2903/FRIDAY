import { describe, it, expect } from "vitest";
import { classifyCommand, stripWakeWord } from "./commands";

describe("stripWakeWord", () => {
  it("strips the wake word and common lead-ins", () => {
    expect(stripWakeWord("Hermes, open skills", "hermes")).toEqual({
      command: "open skills",
      matched: true,
    });
    expect(stripWakeWord("hey hermes go to cron", "hermes")).toEqual({
      command: "go to cron",
      matched: true,
    });
    expect(stripWakeWord("okay hermes: restart the gateway", "hermes")).toEqual({
      command: "restart the gateway",
      matched: true,
    });
  });

  it("reports when the wake word is absent", () => {
    const r = stripWakeWord("open skills", "hermes");
    expect(r.matched).toBe(false);
    expect(r.command).toBe("open skills");
  });

  it("treats an empty wake word as always matched", () => {
    expect(stripWakeWord("open skills", "").matched).toBe(true);
  });
});

describe("classifyCommand — navigation", () => {
  it.each([
    ["open skills", "/skills"],
    ["go to cron", "/cron"],
    ["show me analytics", "/analytics"],
    ["navigate to sessions", "/sessions"],
    ["take me to the models page", "/models"],
    ["show keys", "/env"],
  ])("routes %j to %j", (input, path) => {
    const cmd = classifyCommand(input);
    expect(cmd.kind).toBe("navigate");
    if (cmd.kind === "navigate") expect(cmd.path).toBe(path);
  });
});

describe("classifyCommand — actions", () => {
  it("recognizes gateway restart", () => {
    const cmd = classifyCommand("restart the gateway");
    expect(cmd).toMatchObject({ kind: "action", action: "restart-gateway" });
  });

  it("extracts the skill name for enable/disable", () => {
    expect(classifyCommand("enable the web search skill")).toMatchObject({
      kind: "action",
      action: "enable-skill",
      args: "web search",
    });
    expect(classifyCommand("disable skill memory")).toMatchObject({
      kind: "action",
      action: "disable-skill",
      args: "memory",
    });
  });

  it("extracts the cron job name", () => {
    expect(classifyCommand("trigger the daily digest job")).toMatchObject({
      kind: "action",
      action: "trigger-cron",
      args: "daily digest",
    });
  });

  it("extracts a session search query", () => {
    expect(classifyCommand("search sessions for invoices")).toMatchObject({
      kind: "action",
      action: "search-sessions",
      args: "invoices",
    });
  });
});

describe("classifyCommand — settings + stop", () => {
  it("handles mute / wake word / sleep", () => {
    expect(classifyCommand("mute")).toMatchObject({
      kind: "setting",
      setting: "mute",
    });
    expect(classifyCommand("disable the wake word")).toMatchObject({
      kind: "setting",
      setting: "wake-word-off",
    });
    expect(classifyCommand("stop listening")).toMatchObject({
      kind: "setting",
      setting: "stop-listening",
    });
  });

  it("handles stop/cancel", () => {
    expect(classifyCommand("stop").kind).toBe("stop");
    expect(classifyCommand("never mind").kind).toBe("stop");
  });
});

describe("classifyCommand — delegation", () => {
  it("delegates open-ended questions to Hermes", () => {
    const cmd = classifyCommand("what's the weather in tokyo");
    expect(cmd.kind).toBe("delegate");
    if (cmd.kind === "delegate") expect(cmd.text).toContain("weather");
  });

  it("delegates when a navigation target is unknown", () => {
    expect(classifyCommand("open the pod bay doors").kind).toBe("delegate");
  });
});
