import { describe, expect, it } from "vitest";

import { herdrLabelArgs, labelHerdrTerminal } from "./herdr-terminal.js";

describe("herdrLabelArgs", () => {
  const input = {
    terminal: "t7",
    sessionId: "session-1",
  };

  it("labels the terminal with the session when it starts", () => {
    expect(herdrLabelArgs({ ...input, eventName: "SessionStart" })).toEqual([
      "label",
      "t7",
      "clocktopus.session=session-1",
    ]);
  });

  it("clears the labels when it ends, and leaves other events alone", () => {
    expect(herdrLabelArgs({ ...input, eventName: "SessionEnd" })).toEqual([
      "label",
      "t7",
      "clocktopus.session=",
      "clocktopus.task=",
    ]);
    expect(herdrLabelArgs({ ...input, eventName: "Stop" })).toBeNull();
  });
});

describe("labelHerdrTerminal", () => {
  it("does nothing outside a Herdr terminal, and never throws without hc", async () => {
    const event = {
      eventName: "SessionStart",
      sessionId: "session-1",
    };
    await expect(labelHerdrTerminal(event, {})).resolves.toBeUndefined();
    await expect(
      labelHerdrTerminal(event, { HC_TERMINAL_ID: "t7", PATH: "/nonexistent" }),
    ).resolves.toBeUndefined();
  });
});
