import { describe, expect, it } from "vitest";

import { AgentStatusSchema } from "./agent";
import { DateOnlySchema, TimestampSchema } from "./timestamp";

describe("TimestampSchema", () => {
  it.each([
    "2026-10-07T10:00:00.000Z",
    "2026-10-07T10:00:00Z",
    "2026-10-07T10:00:00.123456Z",
    "2026-10-07T20:00:00+10:00",
  ])("accepts the ISO date-time %s", (value) => {
    expect(TimestampSchema.parse(value)).toBe(value);
  });

  it("writes a Date as its ISO string", () => {
    expect(TimestampSchema.parse(new Date("2026-10-07T10:00:00Z"))).toBe(
      "2026-10-07T10:00:00.000Z",
    );
  });

  it.each([
    "2026-10-07 10:00:00.123+00",
    "2026-10-07T10:00:00",
    "2026-10-07",
    "Wed Oct 07 2026",
    "",
  ])("rejects %s", (value) => {
    expect(TimestampSchema.safeParse(value).success).toBe(false);
  });

  it("rejects an invalid Date", () => {
    expect(TimestampSchema.safeParse(new Date(Number.NaN)).success).toBe(false);
  });

  it("names the response field a malformed timestamp arrived in", () => {
    const result = AgentStatusSchema.safeParse({
      endpoint: "https://otel.example.test",
      window: {
        since: "2026-10-07T10:00:00.000Z",
        sessions: 0,
        unattributedSessions: 0,
        costMicroUsd: 0,
      },
      hookLane: {
        lastSessionStartedAt: "2026-10-07 10:00:00.123+00",
        repositoryUrl: null,
        gitBranch: null,
        cwd: null,
        attributed: null,
      },
      metricsLane: { lastExportReceivedAt: null, lastModel: null },
      tokens: [],
    });

    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ["hookLane", "lastSessionStartedAt"],
    ]);
  });
});

describe("DateOnlySchema", () => {
  it.each(["2026-10-07", "2028-02-29"])("accepts the day %s", (value) => {
    expect(DateOnlySchema.parse(value)).toBe(value);
  });

  it.each([
    "2026-10-07T10:00:00.000Z",
    "2026-02-29",
    "2026-13-01",
    "2026-1-7",
    "07/10/2026",
  ])("rejects %s", (value) => {
    expect(DateOnlySchema.safeParse(value).success).toBe(false);
  });
});
