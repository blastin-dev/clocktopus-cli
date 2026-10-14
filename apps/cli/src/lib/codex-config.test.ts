import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyCodexHooks,
  applyCodexMcp,
  applyCodexOtel,
  buildCodexOtel,
  CodexConfigParseError,
  parseCodexConfigText,
  readCodexConfig,
  readCodexHooks,
  readCodexHookTrust,
  readCodexMcpUrl,
  readCodexTelemetry,
  removeCodexHooks,
  removeCodexMcp,
  removeCodexOtel,
  spliceOtelSection,
  writeCodexConfig,
  writeCodexHooks,
} from "./codex-config";

/**
 * These tests exist because this module edits two files we do not own.
 * `~/.codex/config.toml` holds the user's model, sandbox policy, MCP
 * servers and project trust decisions — hand-written and usually commented
 * — and `hooks.json` may already hold hooks that have nothing to do with
 * us. A merge bug here destroys work unrelated to Clocktopus.
 */

const INSTALL = {
  token: "ctop_agt_testtoken",
  endpoint: "https://otel.example.com",
  hookCommand: "clocktopus agent hook --provider codex_cli",
};

/** A config.toml with the user's own settings, comments and layout. */
const USER_CONFIG = `# my codex setup
model = "gpt-5.6-sol"
approval_policy = "on-request"

[sandbox_workspace_write]
network_access = true    # needed for npm

[mcp_servers.linear]
command = "npx"
args = ["-y", "linear-mcp"]
`;

let dir: string;
let configPath: string;
let hooksPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clocktopus-codex-"));
  configPath = join(dir, "config.toml");
  hooksPath = join(dir, "hooks.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("buildCodexOtel", () => {
  it("puts the receiver path on the endpoint, because Codex does not add one", () => {
    const otel = buildCodexOtel(INSTALL);
    const http = (otel.exporter as Record<string, Record<string, unknown>>)[
      "otlp-http"
    ]!;

    // Codex POSTs to the configured URL verbatim — unlike the OTel SDK, it
    // does not append `/v1/logs`. Omitting the path here would send every
    // export to the receiver's root and 404 silently.
    expect(http.endpoint).toBe("https://otel.example.com/v1/logs");
    expect(http.protocol).toBe("json");
    expect((http.headers as Record<string, string>).Authorization).toBe(
      "Bearer ctop_agt_testtoken",
    );
  });

  it("does not double the path when the endpoint already ends in a slash", () => {
    const otel = buildCodexOtel({
      ...INSTALL,
      endpoint: "https://otel.example.com/",
    });
    const http = (otel.exporter as Record<string, Record<string, unknown>>)[
      "otlp-http"
    ]!;

    expect(http.endpoint).toBe("https://otel.example.com/v1/logs");
  });

  it("turns prompt logging off explicitly rather than trusting the default", () => {
    expect(buildCodexOtel(INSTALL).log_user_prompt).toBe(false);
  });
});

describe("splicing [otel] into a hand-written config.toml", () => {
  it("adds the section without disturbing comments or layout", () => {
    const next = spliceOtelSection(USER_CONFIG, buildCodexOtel(INSTALL));

    // Every line the user wrote survives, byte for byte. A round trip
    // through a TOML serialiser would silently drop all three comments.
    expect(next).toContain("# my codex setup");
    expect(next).toContain("network_access = true    # needed for npm");
    expect(next).toContain('args = ["-y", "linear-mcp"]');

    const parsed = parseToml(next) as Record<string, Record<string, unknown>>;
    expect(parsed.model).toBe("gpt-5.6-sol");
    expect(parsed.mcp_servers).toEqual({
      linear: { command: "npx", args: ["-y", "linear-mcp"] },
    });
    expect(parsed.otel!.log_user_prompt).toBe(false);
  });

  it("replaces an existing [otel] section instead of appending a second", () => {
    const withOtel = spliceOtelSection(USER_CONFIG, buildCodexOtel(INSTALL));
    const twice = spliceOtelSection(
      withOtel,
      buildCodexOtel({ ...INSTALL, token: "ctop_agt_second" }),
    );

    // TOML rejects a duplicated table outright, so an append bug here would
    // stop Codex booting at all.
    expect(twice.match(/^\[otel\]/gm)).toHaveLength(1);
    expect(twice).toContain("ctop_agt_second");
    expect(twice).not.toContain("ctop_agt_testtoken");
    expect(() => parseToml(twice)).not.toThrow();
  });

  it("keeps the user's own [otel] keys when merging ours in", () => {
    const config = `${USER_CONFIG}
[otel]
environment = "staging"
`;
    const parsed = parseToml(config) as Record<string, unknown>;
    const next = applyCodexOtel({ text: config, config: parsed }, INSTALL);

    const result = parseToml(next) as Record<string, Record<string, unknown>>;
    expect(result.otel!.environment).toBe("staging");
    expect(result.otel!.log_user_prompt).toBe(false);
  });

  it("removes only our keys, leaving the rest of [otel] behind", () => {
    const config = `${USER_CONFIG}
[otel]
environment = "staging"
`;
    const withOurs = applyCodexOtel(
      { text: config, config: parseToml(config) as Record<string, unknown> },
      INSTALL,
    );

    const { nextText, removedKeys } = removeCodexOtel({
      text: withOurs,
      config: parseToml(withOurs) as Record<string, unknown>,
    });

    expect(removedKeys.sort()).toEqual(["exporter", "log_user_prompt"]);
    const parsed = parseToml(nextText) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed.otel).toEqual({ environment: "staging" });
    expect(parsed.model).toBe("gpt-5.6-sol");
  });

  it("drops [otel] entirely when nothing of the user's is left in it", () => {
    const withOurs = spliceOtelSection(USER_CONFIG, buildCodexOtel(INSTALL));
    const { nextText } = removeCodexOtel({
      text: withOurs,
      config: parseToml(withOurs) as Record<string, unknown>,
    });

    expect(nextText).not.toContain("[otel]");
    expect(parseToml(nextText)).toEqual(parseToml(USER_CONFIG));
  });

  it("survives an add/remove cycle without accumulating blank lines", () => {
    let text = USER_CONFIG;
    for (let i = 0; i < 3; i++) {
      text = spliceOtelSection(text, buildCodexOtel(INSTALL));
      text = removeCodexOtel({
        text,
        config: parseToml(text) as Record<string, unknown>,
      }).nextText;
    }

    expect(text).toBe(USER_CONFIG);
  });

  it("creates the section from nothing when the file does not exist yet", () => {
    const next = spliceOtelSection("", buildCodexOtel(INSTALL));
    expect(
      (parseToml(next) as Record<string, Record<string, unknown>>).otel,
    ).toBeDefined();
  });
});

describe("[mcp_servers.clocktopus]", () => {
  const API = { apiUrl: "https://clocktopus.example.com/" };

  it("adds the server beside the user's own, leaving comments and layout", () => {
    const current = {
      text: USER_CONFIG,
      config: parseCodexConfigText(USER_CONFIG),
    };
    const next = applyCodexMcp(current, API);

    expect(next.startsWith(USER_CONFIG.trimEnd())).toBe(true);
    expect(next).toContain(
      '[mcp_servers.clocktopus]\nurl = "https://clocktopus.example.com/api/mcp"',
    );
    expect(parseCodexConfigText(next).mcp_servers).toMatchObject({
      linear: { command: "npx" },
    });
    expect(readCodexMcpUrl(parseCodexConfigText(next))).toBe(
      "https://clocktopus.example.com/api/mcp",
    );
  });

  it("updates the URL in place on re-run, keeping keys the user added", () => {
    const text = `${USER_CONFIG}\n[mcp_servers.clocktopus]\nurl = "https://old.example.com/api/mcp"\nstartup_timeout_sec = 20\n\n[profiles.fast]\nmodel = "o4"\n`;
    const next = applyCodexMcp(
      { text, config: parseCodexConfigText(text) },
      API,
    );
    const parsed = parseCodexConfigText(next);

    expect(parsed.mcp_servers).toMatchObject({
      clocktopus: {
        url: "https://clocktopus.example.com/api/mcp",
        startup_timeout_sec: 20,
      },
    });
    expect(parsed.profiles).toEqual({ fast: { model: "o4" } });
    expect(next.match(/\[mcp_servers\.clocktopus\]/g)).toHaveLength(1);
  });

  it("removes only its own server", () => {
    const installed = applyCodexMcp(
      { text: USER_CONFIG, config: parseCodexConfigText(USER_CONFIG) },
      API,
    );
    const { nextText, removed } = removeCodexMcp({
      text: installed,
      config: parseCodexConfigText(installed),
    });

    expect(removed).toBe(true);
    expect(nextText).toBe(USER_CONFIG);
  });

  it("passes the write guard alongside [otel]", () => {
    writeFileSync(configPath, USER_CONFIG);
    const current = readCodexConfig(configPath);
    const withOtel = applyCodexOtel(current, INSTALL);

    writeCodexConfig({
      path: configPath,
      previousText: current.text,
      previousConfig: current.config,
      nextText: applyCodexMcp(
        { text: withOtel, config: parseCodexConfigText(withOtel) },
        API,
      ),
    });

    expect(readCodexMcpUrl(readCodexConfig(configPath).config)).toBe(
      "https://clocktopus.example.com/api/mcp",
    );
  });

  it("still refuses an edit that changes another MCP server", () => {
    writeFileSync(configPath, USER_CONFIG);
    const current = readCodexConfig(configPath);

    expect(() =>
      writeCodexConfig({
        path: configPath,
        previousText: current.text,
        previousConfig: current.config,
        nextText: USER_CONFIG.replace('"npx"', '"bunx"'),
      }),
    ).toThrow(/would have changed \[mcp_servers\]/);
  });
});

describe("writeCodexConfig — the guard on the splice", () => {
  it("writes the edit and backs up what was there", () => {
    writeFileSync(configPath, USER_CONFIG);
    const current = readCodexConfig(configPath);

    const { backupPath } = writeCodexConfig({
      path: configPath,
      previousText: current.text,
      previousConfig: current.config,
      nextText: applyCodexOtel(current, INSTALL),
    });

    expect(backupPath).toBe(`${configPath}.clocktopus-backup`);
    expect(readFileSync(backupPath!, "utf8")).toBe(USER_CONFIG);
    expect(readCodexTelemetry(configPath).token).toBe(INSTALL.token);
  });

  it("refuses to write an edit that would change anything outside [otel]", () => {
    writeFileSync(configPath, USER_CONFIG);
    const current = readCodexConfig(configPath);

    // Stands in for a splice that misread the file's layout. Rather than
    // trusting the region scanner, the write verifies its own result — so a
    // document it cannot handle costs the user nothing.
    expect(() =>
      writeCodexConfig({
        path: configPath,
        previousText: current.text,
        previousConfig: current.config,
        nextText: 'model = "gpt-5.6-sol"\n',
      }),
    ).toThrow(/would have changed/);

    expect(readFileSync(configPath, "utf8")).toBe(USER_CONFIG);
  });

  it("refuses to write anything that is not valid TOML", () => {
    writeFileSync(configPath, USER_CONFIG);
    const current = readCodexConfig(configPath);

    expect(() =>
      writeCodexConfig({
        path: configPath,
        previousText: current.text,
        previousConfig: current.config,
        nextText: "[[[nope",
      }),
    ).toThrow(/did not produce valid TOML/);

    expect(readFileSync(configPath, "utf8")).toBe(USER_CONFIG);
  });

  it("raises rather than overwriting a config.toml it cannot parse", () => {
    // Far more likely a half-finished edit than something to clobber.
    writeFileSync(configPath, "model = = =");
    expect(() => readCodexConfig(configPath)).toThrow(CodexConfigParseError);
  });
});

describe("readCodexTelemetry", () => {
  it("strips the receiver path back off so the hook gets a base URL", () => {
    writeFileSync(
      configPath,
      spliceOtelSection(USER_CONFIG, buildCodexOtel(INSTALL)),
    );

    const telemetry = readCodexTelemetry(configPath);
    // The hook posts to `<endpoint>/v1/agent-session` and doctor to
    // `<endpoint>/v1/verify`; leaving `/v1/logs` on would make both 404.
    expect(telemetry.endpoint).toBe("https://otel.example.com");
    expect(telemetry.token).toBe(INSTALL.token);
    expect(telemetry.protocol).toBe("json");
  });

  it("reports nothing configured rather than throwing on a missing file", () => {
    expect(readCodexTelemetry(configPath)).toMatchObject({
      exists: false,
      token: null,
      endpoint: null,
    });
  });
});

describe("hooks.json", () => {
  type Entry = {
    type: string;
    command: string;
    timeout: number;
    async: boolean;
  };
  /** Reads one event's matcher groups back out with the shape Codex expects. */
  const groups = (file: Record<string, unknown>, event: string) =>
    ((file.hooks as Record<string, unknown>)[event] as Array<{
      hooks: Entry[];
    }>) ?? [];

  const userHooks = () => ({
    description: "my hooks",
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "echo user-session-start" }] },
      ],
      PreToolUse: [
        { matcher: "shell", hooks: [{ type: "command", command: "echo pre" }] },
      ],
    },
  });

  it("appends our hooks without removing the user's", () => {
    const next = applyCodexHooks(userHooks(), INSTALL);
    const start = groups(next, "SessionStart");

    expect(start.map((group) => group.hooks[0]!.command)).toEqual([
      "echo user-session-start",
      INSTALL.hookCommand,
      "clocktopus agent context --provider codex_cli",
    ]);
    expect(groups(next, "PreToolUse")).toEqual(userHooks().hooks.PreToolUse);
  });

  it("gives SessionEnd the 3s budget Codex clamps it to", () => {
    const next = applyCodexHooks({}, INSTALL);

    // Codex hard-clamps SessionEnd and prints a warning on every session
    // start if we ask for more. 10s for SessionStart, which it honours.
    expect(groups(next, "SessionStart")[0]!.hooks[0]!.timeout).toBe(10);
    expect(groups(next, "SessionEnd")[0]!.hooks[0]!.timeout).toBe(3);
  });

  it("never writes an `async` key, on either event", () => {
    // Codex 0.147 drops an async SessionStart entirely, so `cwd` — the only source
    // of repository, branch and starting SHA anywhere in the pipeline —
    // never arrives, while spend keeps flowing in unattributed. 0.148
    // honours it on SessionStart but still forces SessionEnd synchronous
    // and warns once per session.
    //
    // `agent hook` backgrounds itself instead, so this key has no upside on
    // any version.
    const next = applyCodexHooks({}, INSTALL);

    for (const event of ["SessionStart", "SessionEnd"]) {
      const entry = groups(next, event)[0]!.hooks[0]!;
      expect(entry).not.toHaveProperty("async");
    }
  });

  it("replaces our hook on re-run instead of installing a second", () => {
    const once = applyCodexHooks(userHooks(), INSTALL);
    const twice = applyCodexHooks(once, {
      hookCommand: "/usr/local/bin/clocktopus agent hook --provider codex_cli",
    });

    // Two of our hooks would POST every SessionStart twice.
    expect(
      groups(twice, "SessionStart").map((group) => group.hooks[0]!.command),
    ).toEqual([
      "echo user-session-start",
      "/usr/local/bin/clocktopus agent hook --provider codex_cli",
      "/usr/local/bin/clocktopus agent context --provider codex_cli",
    ]);
  });

  it("adds the synchronous context hook to SessionStart only", () => {
    const next = applyCodexHooks({}, INSTALL);

    expect(groups(next, "SessionStart")[1]!.hooks).toEqual([
      {
        type: "command",
        command: "clocktopus agent context --provider codex_cli",
        timeout: 10,
      },
    ]);
    expect(
      groups(next, "SessionEnd").flatMap((group) => group.hooks),
    ).toHaveLength(1);
  });

  it("removes ours and leaves the user's intact", () => {
    const installed = applyCodexHooks(userHooks(), INSTALL);
    const { file, removed } = removeCodexHooks(installed);

    expect(removed).toBe(true);
    expect(file).toMatchObject({ hooks: userHooks().hooks });
  });

  it("round-trips through disk and finds our command again", () => {
    writeCodexHooks(applyCodexHooks(userHooks(), INSTALL), hooksPath);

    const read = readCodexHooks(hooksPath);
    expect(read.commands.SessionStart).toBe(INSTALL.hookCommand);
    expect(read.commands.SessionEnd).toBe(INSTALL.hookCommand);
    expect(read.contextCommand).toBe(
      "clocktopus agent context --provider codex_cli",
    );
  });

  it("raises rather than overwriting a hooks.json it cannot parse", () => {
    writeFileSync(hooksPath, "{ not json");
    expect(() => readCodexHooks(hooksPath)).toThrow(CodexConfigParseError);
  });
});

describe("readCodexHookTrust — Codex's per-entry trust records", () => {
  /**
   * The key format is taken verbatim from a `~/.codex/config.toml` written
   * by Codex 0.147. Trust is recorded per hook *entry* —
   * `<path>:<event>:<group>:<index>` — not per file.
   */
  const trustState = (entries: string[]) =>
    `[hooks.state]\n${entries
      .map(
        (key) =>
          `\n[hooks.state."${key}"]\ntrusted_hash = "sha256:c3ffbe52"\nenabled = true\n`,
      )
      .join("")}`;

  it("reads a fully approved install", () => {
    writeFileSync(
      configPath,
      trustState([
        `${hooksPath}:session_start:0:0`,
        `${hooksPath}:session_end:0:0`,
      ]),
    );

    // `hooksPath` is the temp dir's file, so point the reader at it too.
    process.env.CODEX_HOME = dir;
    try {
      expect(readCodexHookTrust(configPath)).toEqual({
        trusted: ["SessionStart", "SessionEnd"],
        untrusted: [],
      });
    } finally {
      delete process.env.CODEX_HOME;
    }
  });

  it("spots the half-approved install that loses repository context", () => {
    // The state an `async: true` SessionStart leaves on Codex 0.147: the
    // hook is skipped, so it is never offered for approval, while SessionEnd
    // is. Sessions close but never open.
    writeFileSync(configPath, trustState([`${hooksPath}:session_end:0:0`]));

    process.env.CODEX_HOME = dir;
    try {
      expect(readCodexHookTrust(configPath)).toEqual({
        trusted: ["SessionEnd"],
        untrusted: ["SessionStart"],
      });
    } finally {
      delete process.env.CODEX_HOME;
    }
  });

  it("reads Codex 0.148's hash-only record, which omits `enabled`", () => {
    // 0.148 persists `hooks.state."<key>".trusted_hash` and nothing else —
    // its `HookStateToml` has no `enabled` field. Demanding `enabled = true`
    // reported a just-approved install as still pending, and no amount of
    // restarting Codex could clear it: it never prompts again once trusted.
    writeFileSync(
      configPath,
      `[hooks.state."${hooksPath}:session_start:0:0"]\ntrusted_hash = "sha256:c3ffbe52"\n` +
        `\n[hooks.state."${hooksPath}:session_end:0:0"]\ntrusted_hash = "sha256:8b152fa9"\nenabled = true\n`,
    );

    process.env.CODEX_HOME = dir;
    try {
      expect(readCodexHookTrust(configPath)).toEqual({
        trusted: ["SessionStart", "SessionEnd"],
        untrusted: [],
      });
    } finally {
      delete process.env.CODEX_HOME;
    }
  });

  it("treats an entry the user explicitly disabled as untrusted", () => {
    writeFileSync(
      configPath,
      `[hooks.state."${hooksPath}:session_start:0:0"]\ntrusted_hash = "sha256:c3ffbe52"\nenabled = false\n`,
    );

    process.env.CODEX_HOME = dir;
    try {
      expect(readCodexHookTrust(configPath).untrusted).toEqual([
        "SessionStart",
        "SessionEnd",
      ]);
    } finally {
      delete process.env.CODEX_HOME;
    }
  });

  it("reports everything untrusted when there is no config at all", () => {
    expect(readCodexHookTrust(join(dir, "missing.toml")).untrusted).toEqual([
      "SessionStart",
      "SessionEnd",
    ]);
  });
});
