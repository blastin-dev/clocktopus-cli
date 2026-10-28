import { describe, expect, it } from "vitest";

import { checkClaudePanel, checkContentFlags } from "./doctor";

describe("checkContentFlags", () => {
  it("passes when every content flag is off", () => {
    expect(checkContentFlags({ found: [], unreadable: [] }).ok).toBe(true);
  });

  it("warns with each flag that is on and where it is set", () => {
    const check = checkContentFlags({
      found: [
        {
          key: "OTEL_LOG_RAW_API_BODIES",
          value: "file:/tmp/bodies",
          source: "/home/dev/.claude/settings.json",
          managed: false,
        },
      ],
      unreadable: [],
    });

    expect(check.ok).toBe("warn");
    expect(check.detail).toContain(
      "OTEL_LOG_RAW_API_BODIES=file:/tmp/bodies in /home/dev/.claude/settings.json",
    );
  });

  it("points a flag a managed settings file turns on at its administrator", () => {
    const check = checkContentFlags({
      found: [
        {
          key: "OTEL_LOG_USER_PROMPTS",
          value: "1",
          source: "/etc/claude-code/managed-settings.json",
          managed: true,
        },
      ],
      unreadable: [],
    });

    expect(check.ok).toBe("warn");
    expect(check.detail).toContain(
      "OTEL_LOG_USER_PROMPTS=1 in /etc/claude-code/managed-settings.json",
    );
    expect(check.fix).toContain("managed settings file");
  });

  it("warns without failing when a managed settings file does not parse", () => {
    const check = checkContentFlags({
      found: [],
      unreadable: ["/etc/claude-code/managed-settings.d/10-telemetry.json"],
    });

    expect(check.ok).toBe("warn");
    expect(check.detail).toContain(
      "couldn't read /etc/claude-code/managed-settings.d/10-telemetry.json",
    );
  });
});

describe("checkClaudePanel", () => {
  it("passes when the panel is installed on a Claude Code that supports it", () => {
    expect(checkClaudePanel({ panel: true }, "2.1.310").ok).toBe(true);
  });

  it("warns that a panel left out can be added by re-running setup", () => {
    expect(checkClaudePanel({ panel: false }, "2.1.310")).toMatchObject({
      ok: "warn",
      detail: "not installed",
      fix: "clocktopus agent setup --agent claude",
    });
  });

  it("names an older Claude Code as why the panel is missing", () => {
    expect(checkClaudePanel({ panel: false }, "2.1.200")).toMatchObject({
      ok: "warn",
      detail: "not installed — Claude Code 2.1.200 is older than 2.1.310",
    });
  });

  it("warns when an installed panel runs on an older Claude Code", () => {
    expect(checkClaudePanel({ panel: true }, "2.0.1")).toMatchObject({
      ok: "warn",
      detail: "installed, but Claude Code 2.0.1 is older than 2.1.310",
    });
  });
});
