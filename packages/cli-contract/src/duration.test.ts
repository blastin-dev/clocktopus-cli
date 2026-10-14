import { describe, expect, it } from "vitest";

import { parseDurationToMinutes } from "./duration";

describe("parseDurationToMinutes", () => {
  it.each([
    ["15m", 15],
    ["90m", 90],
    ["1h", 60],
    ["2h", 120],
    ["1h30m", 90],
    ["2h15m", 135],
    ["  1h30m  ", 90],
    ["1H30M", 90],
  ])("parses %s → %d minutes", (input, expected) => {
    expect(parseDurationToMinutes(input)).toBe(expected);
  });

  it.each(["", "0m", "0h", "0h0m", "-5m", "abc", "15", "m15", "1h2h", "1.5h"])(
    "rejects invalid input %s",
    (input) => {
      expect(() => parseDurationToMinutes(input)).toThrow();
    },
  );
});
