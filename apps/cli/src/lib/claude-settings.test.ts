import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyTelemetrySettings,
  buildTelemetryEnv,
  CONTENT_FLAG_KEYS,
  contentFlagsOn,
  CONTEXT_HOOK_TIMEOUT_SECONDS,
  findContentFlagsOn,
  isContentFlagOn,
  managedSettingsDir,
  managedSettingsFiles,
  readInstalledTelemetry,
  readSettings,
  removeTelemetrySettings,
  SettingsParseError,
  writeSettings,
} from "./claude-settings";

/**
 * These tests exist because this module edits a file we do not own.
 * `~/.claude/settings.json` holds the user's model choice, their own hooks,
 * their permissions and their MCP servers, and a merge bug here destroys
 * work that has nothing to do with us.
 */

const INSTALL = {
  token: "ctop_agt_testtoken",
  endpoint: "https://otel.example.com",
  hookCommand: "clocktopus agent hook",
};

/** A settings file with the user's own configuration already in it. */
function userSettings() {
  return {
    model: "opus",
    env: { MY_OWN_VAR: "keep-me" },
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "echo user-session-start" }] },
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "echo bash-guard" }],
        },
      ],
    },
  };
}

describe("applyTelemetrySettings", () => {
  it("leaves everything it did not put there alone", () => {
    const next = applyTelemetrySettings(userSettings(), INSTALL);

    expect(next.model).toBe("opus");
    expect((next.env as Record<string, string>).MY_OWN_VAR).toBe("keep-me");
    expect((next.hooks as Record<string, unknown>).PreToolUse).toEqual(
      userSettings().hooks.PreToolUse,
    );
  });

  it("keeps the user's own SessionStart hook alongside ours", () => {
    const next = applyTelemetrySettings(userSettings(), INSTALL);

    const commands = (
      (
        next.hooks as Record<
          string,
          Array<{ hooks: Array<{ command: string }> }>
        >
      ).SessionStart ?? []
    ).flatMap((matcher) => matcher.hooks.map((entry) => entry.command));

    expect(commands).toContain("echo user-session-start");
    expect(commands).toContain("clocktopus agent hook");
  });

  it("installs both events — one without the other loses attribution", () => {
    // SessionStart is the only source of `cwd` and the *before* SHA;
    // SessionEnd is the only source of the exact commit list.
    const next = applyTelemetrySettings({}, INSTALL);
    const hooks = next.hooks as Record<string, unknown>;

    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();
  });

  it("is idempotent — re-running setup does not fire the hook twice", () => {
    const once = applyTelemetrySettings(userSettings(), INSTALL);
    const twice = applyTelemetrySettings(once, INSTALL);

    const ours = (
      (
        twice.hooks as Record<
          string,
          Array<{ hooks: Array<{ command: string }> }>
        >
      ).SessionStart ?? []
    )
      .flatMap((matcher) => matcher.hooks)
      .filter((entry) => entry.command === "clocktopus agent hook");

    expect(ours).toHaveLength(1);
  });

  it("runs the hook out of band, so telemetry never delays session start", () => {
    const next = applyTelemetrySettings({}, INSTALL);
    const entry = (
      next.hooks as Record<
        string,
        Array<{ hooks: Array<Record<string, unknown>> }>
      >
    ).SessionStart![0]!.hooks[0]!;

    expect(entry.async).toBe(true);
    // Above the hook's own 4s request timeout, so a slow network leaves the
    // hook's recorded failure behind instead of being killed without trace.
    expect(entry.timeout).toBe(10);
  });

  it("replaces a hand-installed script hook instead of firing both", () => {
    // A hand-installed hook points at a script inside a checkout of this
    // repo. Leaving it installed alongside the CLI hook would POST every
    // SessionStart twice.
    const legacy = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "node /home/me/Projects/clocktopus/scripts/agent-telemetry/claude-hook.mjs",
                timeout: 10,
                async: true,
              },
            ],
          },
        ],
      },
    };

    const next = applyTelemetrySettings(legacy, INSTALL);
    const commands = (
      next.hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
    ).SessionStart!.flatMap((matcher) =>
      matcher.hooks.map((entry) => entry.command),
    );

    expect(commands).toEqual([
      "clocktopus agent hook",
      "clocktopus agent context",
    ]);
  });

  it("adds a synchronous context hook to SessionStart only, once however often setup runs", () => {
    const next = applyTelemetrySettings(
      applyTelemetrySettings({}, INSTALL),
      INSTALL,
    );
    const hooks = next.hooks as Record<
      string,
      Array<{ hooks: Array<Record<string, unknown>> }>
    >;

    const context = hooks
      .SessionStart!.flatMap((matcher) => matcher.hooks)
      .filter((entry) => entry.command === "clocktopus agent context");
    expect(context).toEqual([
      {
        type: "command",
        command: "clocktopus agent context",
        timeout: CONTEXT_HOOK_TIMEOUT_SECONDS,
      },
    ]);
    expect(
      hooks.SessionEnd!.flatMap((matcher) =>
        matcher.hooks.map((entry) => entry.command),
      ),
    ).toEqual(["clocktopus agent hook"]);
  });

  it("replaces our hook when the command changes, rather than adding one", () => {
    const first = applyTelemetrySettings({}, INSTALL);
    const moved = applyTelemetrySettings(first, {
      ...INSTALL,
      hookCommand: "/usr/local/bin/node /opt/clocktopus/cli.js agent hook",
    });

    const commands = (
      (
        moved.hooks as Record<
          string,
          Array<{ hooks: Array<{ command: string }> }>
        >
      ).SessionEnd ?? []
    ).flatMap((matcher) => matcher.hooks.map((entry) => entry.command));

    expect(commands).toEqual([
      "/usr/local/bin/node /opt/clocktopus/cli.js agent hook",
    ]);
  });
});

describe("buildTelemetryEnv", () => {
  it("configures the exporter the only way the receiver accepts", () => {
    const env = buildTelemetryEnv(INSTALL);

    // Protobuf gets an explicit 415 from the receiver.
    expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/json");
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
      "Authorization=Bearer ctop_agt_testtoken",
    );
    // Without the session id the metric stream cannot be joined to the hook
    // stream, and every session loses its repository and branch.
    expect(env.OTEL_METRICS_INCLUDE_SESSION_ID).toBe("true");
  });

  it("enables the log exporter, the only carrier of sub-agent runtime", () => {
    // `claude_code.active_time.total` on the metric stream measures the
    // main thread, so without this a session that delegates its work to `Task`
    // agents reports the coordinator's time and none of theirs.
    expect(buildTelemetryEnv(INSTALL).OTEL_LOGS_EXPORTER).toBe("otlp");
  });

  it("normalises a trailing slash so paths do not double up", () => {
    const env = buildTelemetryEnv({
      ...INSTALL,
      endpoint: "https://otel.example.com/",
    });

    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe("https://otel.example.com");
    expect(env.CLOCKTOPUS_OTEL_ENDPOINT).toBe("https://otel.example.com");
  });
});

describe("removeTelemetrySettings", () => {
  it("removes the log exporter again on teardown", () => {
    // Every key setup writes has to be one `agent disable` takes back, or a
    // disabled agent keeps exporting to an endpoint that does not want it.
    const installed = applyTelemetrySettings(userSettings(), INSTALL);
    const { settings } = removeTelemetrySettings(installed);

    expect(
      (settings.env as Record<string, string>).OTEL_LOGS_EXPORTER,
    ).toBeUndefined();
  });

  it("removes only what setup added", () => {
    const installed = applyTelemetrySettings(userSettings(), INSTALL);
    const { settings, removedEnvKeys, removedHooks } =
      removeTelemetrySettings(installed);

    expect(removedHooks).toBe(true);
    expect(removedEnvKeys).toContain("CLOCKTOPUS_INGEST_TOKEN");

    expect(settings.model).toBe("opus");
    expect((settings.env as Record<string, string>).MY_OWN_VAR).toBe("keep-me");
    expect(
      (settings.env as Record<string, string>).CLOCKTOPUS_INGEST_TOKEN,
    ).toBeUndefined();

    const sessionStart = (
      settings.hooks as Record<
        string,
        Array<{ hooks: Array<{ command: string }> }>
      >
    ).SessionStart;
    expect(sessionStart?.flatMap((m) => m.hooks.map((h) => h.command))).toEqual(
      ["echo user-session-start"],
    );
    expect(
      (settings.hooks as Record<string, unknown>).PreToolUse,
    ).toBeDefined();
  });

  it("drops the env and hooks keys entirely when nothing else used them", () => {
    const installed = applyTelemetrySettings({ model: "opus" }, INSTALL);
    const { settings } = removeTelemetrySettings(installed);

    expect(settings.env).toBeUndefined();
    expect(settings.hooks).toBeUndefined();
    expect(settings.model).toBe("opus");
  });

  it("reports nothing removed when telemetry was never installed", () => {
    const { removedEnvKeys, removedHooks } =
      removeTelemetrySettings(userSettings());

    expect(removedEnvKeys).toEqual([]);
    expect(removedHooks).toBe(false);
  });
});

describe("reading and writing the file", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clocktopus-settings-"));
    path = join(dir, "settings.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to read malformed JSON rather than overwrite it", () => {
    // A broken settings file is far more likely to be a half-finished edit
    // than something to clobber.
    writeFileSync(path, '{ "model": "opus",,, }', "utf8");

    expect(() => readSettings(path)).toThrow(SettingsParseError);
  });

  it("treats a missing file as empty settings", () => {
    const result = readSettings(path);

    expect(result.exists).toBe(false);
    expect(result.settings).toEqual({});
  });

  it("backs up the previous file before replacing it", () => {
    writeFileSync(path, JSON.stringify(userSettings()), "utf8");

    const { backupPath } = writeSettings(
      applyTelemetrySettings(readSettings(path).settings, INSTALL),
      path,
    );

    expect(backupPath).toBe(`${path}.clocktopus-backup`);
    expect(JSON.parse(readFileSync(backupPath!, "utf8"))).toEqual(
      userSettings(),
    );
  });

  it("round-trips what setup installed", () => {
    writeSettings(applyTelemetrySettings(userSettings(), INSTALL), path);

    const installed = readInstalledTelemetry(path);

    expect(installed.env.CLOCKTOPUS_INGEST_TOKEN).toBe("ctop_agt_testtoken");
    expect(installed.hookCommands.SessionStart).toBe("clocktopus agent hook");
    expect(installed.hookCommands.SessionEnd).toBe("clocktopus agent hook");
  });

  it("reads back the log exporter, so an install without it can be spotted", () => {
    // What `agent doctor` branches on. A settings file without the log exporter has
    // a token, an endpoint and both hooks — every other check passes — while sub-agent
    // runtime never leaves the machine. This is the only signal that it is stale.
    const noLogsLane = applyTelemetrySettings(userSettings(), INSTALL);
    delete (noLogsLane.env as Record<string, string>).OTEL_LOGS_EXPORTER;
    writeSettings(noLogsLane, path);

    expect(readInstalledTelemetry(path).env.OTEL_LOGS_EXPORTER).toBeUndefined();

    writeSettings(applyTelemetrySettings(noLogsLane, INSTALL), path);

    // Re-running setup merges it in rather than needing a teardown first.
    expect(readInstalledTelemetry(path).env.OTEL_LOGS_EXPORTER).toBe("otlp");
  });

  it("reports no telemetry for a settings file that only has the user's own hooks", () => {
    writeFileSync(path, JSON.stringify(userSettings()), "utf8");

    const installed = readInstalledTelemetry(path);

    expect(installed.env).toEqual({});
    expect(installed.hookCommands.SessionStart).toBeUndefined();
  });
});

describe("removeTelemetrySettings and the context hook", () => {
  it("removes the context hook with the telemetry hooks, keeping the user's own", () => {
    const installed = applyTelemetrySettings(
      {
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "echo mine" }] },
          ],
        },
      },
      INSTALL,
    );

    const { settings } = removeTelemetrySettings(installed);

    expect(settings.hooks).toEqual({
      SessionStart: [{ hooks: [{ type: "command", command: "echo mine" }] }],
    });
  });
});

describe("content flags", () => {
  it("writes every content flag as a value Claude Code reads as off", () => {
    const env = buildTelemetryEnv(INSTALL);

    for (const key of CONTENT_FLAG_KEYS) {
      expect(env[key]).toBe("0");
      expect(isContentFlagOn(key, env[key])).toBe(false);
    }
  });

  it("turns off a content flag the user had on in settings", () => {
    const settings = applyTelemetrySettings(
      { env: { OTEL_LOG_USER_PROMPTS: "1", MY_OWN_VAR: "keep-me" } },
      INSTALL,
    );

    expect(
      contentFlagsOn([
        { source: "settings", env: settings.env as Record<string, unknown> },
      ]),
    ).toEqual([]);
    expect((settings.env as Record<string, string>).MY_OWN_VAR).toBe("keep-me");
  });

  it("removes the content flags on teardown", () => {
    const { settings, removedEnvKeys } = removeTelemetrySettings(
      applyTelemetrySettings(userSettings(), INSTALL),
    );

    expect(removedEnvKeys).toEqual(
      expect.arrayContaining([...CONTENT_FLAG_KEYS]),
    );
    expect(settings.env).toEqual({ MY_OWN_VAR: "keep-me" });
  });

  it.each(["1", "true", "TRUE", " yes ", "on"])("reads %j as on", (value) => {
    expect(isContentFlagOn("OTEL_LOG_TOOL_DETAILS", value)).toBe(true);
  });

  it.each(["0", "false", "no", "off", "", undefined])(
    "reads %j as off",
    (value) => {
      expect(isContentFlagOn("OTEL_LOG_TOOL_DETAILS", value)).toBe(false);
    },
  );

  it("reads a raw API body directory as on, and an empty one as off", () => {
    expect(isContentFlagOn("OTEL_LOG_RAW_API_BODIES", "file:/tmp/bodies")).toBe(
      true,
    );
    expect(isContentFlagOn("OTEL_LOG_RAW_API_BODIES", "file:")).toBe(false);
    // Only the raw bodies flag takes a directory.
    expect(isContentFlagOn("OTEL_LOG_USER_PROMPTS", "file:/tmp/x")).toBe(false);
  });

  describe("findContentFlagsOn", () => {
    let dir: string;
    let path: string;
    let managedDir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "clocktopus-content-flags-"));
      path = join(dir, "settings.json");
      managedDir = join(dir, "managed");
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function writeManaged(name: string, contents: unknown) {
      const target = join(managedDir, name);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(
        target,
        typeof contents === "string" ? contents : JSON.stringify(contents),
        "utf8",
      );
      return target;
    }

    it("names each flag that is on and where it is set", () => {
      writeFileSync(
        path,
        JSON.stringify({ env: { OTEL_LOG_TOOL_CONTENT: "true" } }),
        "utf8",
      );

      expect(
        findContentFlagsOn(
          path,
          { OTEL_LOG_USER_PROMPTS: "1", OTEL_LOG_TOOL_DETAILS: "0" },
          managedDir,
        ),
      ).toEqual({
        found: [
          {
            key: "OTEL_LOG_USER_PROMPTS",
            value: "1",
            source: "the environment",
            managed: false,
          },
          {
            key: "OTEL_LOG_TOOL_CONTENT",
            value: "true",
            source: path,
            managed: false,
          },
        ],
        unreadable: [],
      });
    });

    it("finds nothing once setup has pinned the flags off", () => {
      writeSettings(applyTelemetrySettings(userSettings(), INSTALL), path);

      expect(findContentFlagsOn(path, {}, managedDir)).toEqual({
        found: [],
        unreadable: [],
      });
    });

    it("still checks the environment when settings.json does not parse", () => {
      writeFileSync(path, "{ not json", "utf8");

      expect(
        findContentFlagsOn(path, { OTEL_LOG_RAW_API_BODIES: "1" }, managedDir)
          .found,
      ).toHaveLength(1);
    });

    it("names the managed settings file that turns a flag on over setup", () => {
      writeSettings(applyTelemetrySettings(userSettings(), INSTALL), path);
      const policy = writeManaged("managed-settings.json", {
        env: { OTEL_LOG_USER_PROMPTS: "1" },
      });

      expect(findContentFlagsOn(path, {}, managedDir).found).toEqual([
        {
          key: "OTEL_LOG_USER_PROMPTS",
          value: "1",
          source: policy,
          managed: true,
        },
      ]);
    });

    it("lets a later drop-in file decide a flag the managed file sets", () => {
      writeManaged("managed-settings.json", {
        env: { OTEL_LOG_USER_PROMPTS: "1", OTEL_LOG_TOOL_DETAILS: "0" },
      });
      writeManaged("managed-settings.d/10-telemetry.json", {
        env: { OTEL_LOG_USER_PROMPTS: "0" },
      });
      const security = writeManaged("managed-settings.d/20-security.json", {
        env: { OTEL_LOG_TOOL_DETAILS: "true" },
      });

      expect(findContentFlagsOn(path, {}, managedDir).found).toEqual([
        {
          key: "OTEL_LOG_TOOL_DETAILS",
          value: "true",
          source: security,
          managed: true,
        },
      ]);
    });

    it("skips hidden and non-JSON drop-in files, as Claude Code does", () => {
      writeManaged("managed-settings.d/.10-draft.json", {
        env: { OTEL_LOG_USER_PROMPTS: "1" },
      });
      writeManaged(
        "managed-settings.d/20-notes.txt",
        "OTEL_LOG_USER_PROMPTS=1",
      );

      expect(managedSettingsFiles(managedDir)).toEqual([
        join(managedDir, "managed-settings.json"),
      ]);
      expect(findContentFlagsOn(path, {}, managedDir).found).toEqual([]);
    });

    it("reports a managed file that does not parse and reads the rest", () => {
      const broken = writeManaged("managed-settings.json", "{ not json");
      const dropIn = writeManaged("managed-settings.d/10-telemetry.json", {
        env: { OTEL_LOG_ASSISTANT_RESPONSES: "yes" },
      });

      expect(findContentFlagsOn(path, {}, managedDir)).toEqual({
        found: [
          {
            key: "OTEL_LOG_ASSISTANT_RESPONSES",
            value: "yes",
            source: dropIn,
            managed: true,
          },
        ],
        unreadable: [broken],
      });
    });

    it("reads the system directory Claude Code reads on each platform", () => {
      expect(managedSettingsDir("darwin")).toBe(
        "/Library/Application Support/ClaudeCode",
      );
      expect(managedSettingsDir("linux")).toBe("/etc/claude-code");
      expect(managedSettingsDir("win32")).toBe("C:\\Program Files\\ClaudeCode");
    });
  });
});
