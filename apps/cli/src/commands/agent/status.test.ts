import { describe, expect, it } from "vitest";

import { contentFlagCallout, diagnose } from "./status";

/**
 * The callouts `agent status` prints under the lane table.
 *
 * Only the ordering is interesting, and it is the whole point: the checks run
 * in pipeline order so the *first* failure is the one shown, because the rest
 * are usually consequences of it.
 */

const LIVE = 60_000;
const STALE = 48 * 60 * 60 * 1000;

const healthy = {
  hookAge: LIVE,
  metricsAge: LIVE,
  sessions: 10,
  expectsSpend: true,
};

describe("diagnose", () => {
  it("says nothing when both lanes are live and everything is attributed", () => {
    expect(diagnose({ ...healthy, unattributedSessions: 0 })).toEqual([]);
  });

  it("names the repository mapping when sessions land with no project", () => {
    const [callout] = diagnose({ ...healthy, unattributedSessions: 3 });

    expect(callout).toContain("3 of 10");
    // The actionable object; "project" alone reads as if it could mean a
    // task.
    expect(callout).toContain("repository");
    expect(callout).toContain("agent doctor");
  });

  it("reports a silent hook instead, while one is silent", () => {
    // Every session is unattributed when the hook never runs — no telemetry
    // stream carries path data — so the unattributed count is a symptom here
    // and the hook is the thing to fix. Showing both would send someone to
    // the dashboard to fix a mapping that is already correct.
    const callouts = diagnose({
      hookAge: STALE,
      metricsAge: LIVE,
      sessions: 10,
      expectsSpend: true,
      unattributedSessions: 10,
    });

    expect(callouts).toHaveLength(1);
    expect(callouts[0]).toContain("hook is not running");
  });

  it("reports a silent exporter before anything else", () => {
    const callouts = diagnose({
      hookAge: LIVE,
      metricsAge: STALE,
      sessions: 10,
      expectsSpend: true,
      unattributedSessions: 4,
    });

    expect(callouts).toHaveLength(1);
    expect(callouts[0]).toContain("no spend is");
  });

  it("expects no spend when only agents that export none are configured", () => {
    expect(
      diagnose({
        hookAge: LIVE,
        metricsAge: null,
        sessions: 10,
        unattributedSessions: 0,
        expectsSpend: false,
      }),
    ).toEqual([]);
  });

  it("sends someone to doctor when nothing has ever arrived", () => {
    const callouts = diagnose({
      hookAge: null,
      metricsAge: null,
      sessions: 0,
      expectsSpend: true,
      unattributedSessions: 0,
    });

    expect(callouts[0]).toContain("Nothing has ever arrived");
  });
});

describe("contentFlagCallout", () => {
  it("says nothing when every content flag is off", () => {
    expect(contentFlagCallout({ found: [], unreadable: [] })).toBeNull();
  });

  it("names each flag that is on and where it is set", () => {
    const callout = contentFlagCallout({
      found: [
        {
          key: "OTEL_LOG_USER_PROMPTS",
          value: "1",
          source: "the environment",
          managed: false,
        },
      ],
      unreadable: [],
    });

    expect(callout).toContain("OTEL_LOG_USER_PROMPTS=1 in the environment");
    expect(callout).toContain("clocktopus agent setup");
  });

  it("names a managed settings file that turns a flag on", () => {
    const callout = contentFlagCallout({
      found: [
        {
          key: "OTEL_LOG_TOOL_CONTENT",
          value: "true",
          source: "/etc/claude-code/managed-settings.json",
          managed: true,
        },
      ],
      unreadable: [],
    });

    expect(callout).toContain(
      "OTEL_LOG_TOOL_CONTENT=true in /etc/claude-code/managed-settings.json",
    );
    expect(callout).toContain("managed settings file");
  });

  it("says when a managed settings file could not be read", () => {
    const callout = contentFlagCallout({
      found: [],
      unreadable: ["/etc/claude-code/managed-settings.json"],
    });

    expect(callout).toContain(
      "Couldn't read Claude Code's managed settings: /etc/claude-code/managed-settings.json",
    );
  });
});
