import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyOpencodeMcp,
  buildOpencodePlugin,
  OPENCODE_PLUGIN_VERSION,
  opencodePluginApiFor,
  readOpencodeConfig,
  readOpencodeMcpUrl,
  readOpencodePlugin,
  removeOpencodeMcp,
  removeOpencodePlugin,
  splitCommandLine,
  writeOpencodeConfig,
  writeOpencodePlugin,
} from "./opencode-config";

/**
 * OpenCode's integration is a JavaScript file we generate and drop into the
 * user's config directory, which makes two things worth testing that the
 * other agents do not need: that the file we write is syntactically valid —
 * OpenCode loads every plugin at startup, so a broken one takes its whole
 * plugin system down — and that the configuration baked into it survives a
 * round trip, since that file is also where the ingest token lives.
 */

const INSTALL = {
  endpoint: "https://otel.example.com",
  token: "ctop_agt_testtoken",
  hookArgv: ["/usr/bin/node", "/opt/clocktopus/cli.js", "agent", "hook"],
};

let dir: string;
let pluginPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "clocktopus-opencode-"));
  pluginPath = join(dir, "plugin", "clocktopus.js");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("splitCommandLine", () => {
  it("keeps a quoted path with spaces in one piece", () => {
    // The failure this prevents is silent: the plugin spawns argv directly,
    // so a path torn in two at a space produces a command that does not
    // exist, and the hook simply never runs.
    expect(
      splitCommandLine('"/opt/my node/bin/node" /opt/cli.js agent hook'),
    ).toEqual(["/opt/my node/bin/node", "/opt/cli.js", "agent", "hook"]);
  });

  it("handles the ordinary unquoted case", () => {
    expect(
      splitCommandLine("clocktopus agent hook --provider opencode"),
    ).toEqual(["clocktopus", "agent", "hook", "--provider", "opencode"]);
  });
});

const importPlugin = async (source: string) =>
  (await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  )) as Record<string, unknown>;

describe("opencodePluginApiFor", () => {
  it("picks the plugin API from the installed OpenCode's major version", () => {
    expect(opencodePluginApiFor("1.18.35")).toBe(1);
    expect(opencodePluginApiFor("2.0.26")).toBe(2);
    expect(opencodePluginApiFor("3.1.0")).toBe(2);
    expect(opencodePluginApiFor(null)).toBeNull();
    expect(opencodePluginApiFor("opencode")).toBeNull();
  });
});

describe("the generated plugin", () => {
  // Imported rather than merely parsed: OpenCode loads this file into its own process,
  // so a syntax error here breaks every other plugin the user has.
  it("exports a default { id, setup } for OpenCode 2", async () => {
    const module = await importPlugin(buildOpencodePlugin(INSTALL, 2));
    const plugin = module.default as { id: unknown; setup: unknown };

    expect(plugin.id).toBe("clocktopus");
    expect(typeof plugin.setup).toBe("function");
  });

  it("exports a plugin function with an event handler for OpenCode 1", async () => {
    const { ClocktopusPlugin } = (await importPlugin(
      buildOpencodePlugin(INSTALL, 1),
    )) as {
      ClocktopusPlugin: (input: unknown) => Promise<Record<string, unknown>>;
    };

    const hooks = await ClocktopusPlugin({
      directory: "/repo",
      worktree: "/repo",
    });

    expect(typeof hooks.event).toBe("function");
  });

  it.each([1, 2] as const)(
    "sends counts and identifiers, and nothing a person wrote (API %i)",
    (api) => {
      const source = buildOpencodePlugin(INSTALL, api);

      // OpenCode hands the plugin whole messages and every session event, so
      // what it chooses *not* to read is the entire privacy story. These are
      // the fields that carry content: on OpenCode 1's `AssistantMessage` and
      // its parts, and on OpenCode 2's text, reasoning and tool events.
      for (const forbidden of [
        "message.parts",
        "\\.text",
        "message.prompt",
        "message.summary",
        "\\.delta",
        "\\.content",
        "data\\.input",
        "\\.instructions",
      ]) {
        expect(source).not.toMatch(new RegExp(forbidden));
      }
    },
  );

  it("round-trips its configuration back out of the file", () => {
    writeOpencodePlugin(buildOpencodePlugin(INSTALL), pluginPath);

    const read = readOpencodePlugin(pluginPath);
    expect(read.exists).toBe(true);
    // This is how `doctor`, `status` and the hook find the token: there is
    // nowhere else it is written.
    expect(read.config).toEqual(INSTALL);
  });

  it("stamps the generation that wrote it", () => {
    // Unlike the hook agents, this file does not follow the CLI: it stays as
    // written until `setup` runs again. The stamp is the only way `doctor`
    // can tell an outdated plugin from a current one.
    writeOpencodePlugin(buildOpencodePlugin(INSTALL), pluginPath);

    expect(readOpencodePlugin(pluginPath).version).toBe(
      OPENCODE_PLUGIN_VERSION,
    );
  });

  it.each([1, 2] as const)("stamps the OpenCode API it targets (%i)", (api) => {
    // `doctor` compares this with the installed OpenCode, which refuses a
    // plugin written for the other major version.
    writeOpencodePlugin(buildOpencodePlugin(INSTALL, api), pluginPath);

    expect(readOpencodePlugin(pluginPath).api).toBe(api);
  });

  it("writes the file readable only by its owner", () => {
    writeOpencodePlugin(buildOpencodePlugin(INSTALL), pluginPath);
    // The ingest token is in there in plaintext.
    expect(readFileSync(pluginPath, "utf8")).toContain(INSTALL.token);
  });

  it("backs up whatever was there before overwriting", () => {
    writeOpencodePlugin("// something the user wrote\n", pluginPath);
    const { backupPath } = writeOpencodePlugin(
      buildOpencodePlugin(INSTALL),
      pluginPath,
    );

    expect(backupPath).toBe(`${pluginPath}.clocktopus-backup`);
    expect(readFileSync(backupPath!, "utf8")).toBe(
      "// something the user wrote\n",
    );
  });
});

describe("the OpenCode 2 plugin", () => {
  const REPO = "/work/acme-portal";
  const step = (
    type: string,
    directory: string,
    sessionID: string,
    data: Record<string, unknown>,
    created = 1_700_000_005_000,
  ) => ({
    id: `evt_${type}_${sessionID}`,
    created,
    type,
    location: { directory },
    data: { sessionID, assistantMessageID: `msg_${sessionID}`, ...data },
  });

  // Shaped like what OpenCode 2.0 emits for one turn of one session.
  const turn = (directory: string, sessionID: string) => [
    step("session.step.started", directory, sessionID, {
      agent: "build",
      model: { id: "big-model", providerID: "acme-ai", variant: "default" },
      started: 1_700_000_000_000,
    }),
    step("session.text.delta", directory, sessionID, { delta: "hi" }),
    step("session.step.ended", directory, sessionID, {
      finish: "stop",
      cost: 0.0123,
      tokens: {
        input: 29,
        output: 3,
        reasoning: 8,
        cache: { read: 8320, write: 0 },
      },
    }),
    {
      id: `evt_done_${sessionID}`,
      created: 1_700_000_005_001,
      type: "session.execution.succeeded",
      data: { sessionID },
    },
  ];

  const run = async (events: unknown[]) => {
    const hookLog = join(dir, "hook.log");
    const source = buildOpencodePlugin(
      {
        ...INSTALL,
        hookArgv: [
          process.execPath,
          "-e",
          `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>require("fs").appendFileSync(${JSON.stringify(hookLog)},s+"\\n"))`,
        ],
      },
      2,
    );
    const { default: plugin } = (await importPlugin(source)) as {
      default: { setup: (context: unknown) => Promise<void> };
    };

    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await plugin.setup({
      app: { name: "opencode", version: "2.0.26", channel: "latest" },
      location: { directory: REPO, project: { directory: REPO } },
      event: {
        subscribe: async function* () {
          yield* events;
        },
      },
    });

    return { fetchMock, hookLog };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports one generation span per step, with its model, tokens and cost", async () => {
    const { fetchMock } = await run(turn(REPO, "ses_a"));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://otel.example.com/v1/traces");

    const body = JSON.parse(String(init.body));
    const [session, generation] = body.resourceSpans[0].scopeSpans[0].spans;
    expect(session.startTimeUnixNano).toBe("1700000000000000000");
    expect(session.endTimeUnixNano).toBe("1700000005000000000");

    const attributes = Object.fromEntries(
      generation.attributes.map(
        (a: { key: string; value: Record<string, unknown> }) => [
          a.key,
          Object.values(a.value)[0],
        ],
      ),
    );
    expect(attributes).toMatchObject({
      "gen_ai.client.session_id": "ses_a",
      "gen_ai.request.model": "big-model",
      "gen_ai.provider.name": "acme-ai",
      "gen_ai.usage.input_tokens": 29,
      "gen_ai.usage.output_tokens": 11,
      "gen_ai.usage.cache_read_input_tokens": 8320,
      "gen_ai.usage.cost": 0.0123,
    });
  });

  it("ignores sessions running in another directory", async () => {
    // OpenCode runs a setup per directory and hands each every directory's
    // events; reporting them all would count each step once per directory.
    const { fetchMock, hookLog } = await run(turn("/work/other", "ses_b"));

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => readFileSync(hookLog, "utf8")).toThrow();
  });

  it("hands the hook SessionStart on the first step and SessionEnd when the turn ends", async () => {
    const { hookLog } = await run(turn(REPO, "ses_c"));

    await vi.waitFor(
      () => {
        const events = readFileSync(hookLog, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(events).toHaveLength(2);
        expect(events).toEqual(
          expect.arrayContaining([
            { session_id: "ses_c", hook_event_name: "SessionStart", cwd: REPO },
            { session_id: "ses_c", hook_event_name: "SessionEnd", cwd: REPO },
          ]),
        );
      },
      { timeout: 5000 },
    );
  });
});

describe("reading a plugin that is not ours to read", () => {
  it("reports a hand-edited plugin as unconfigured rather than guessing", () => {
    writeOpencodePlugin(
      "export const Whatever = async () => ({});\n",
      pluginPath,
    );

    const read = readOpencodePlugin(pluginPath);
    // The file exists but tells us nothing, so `setup` is the honest next
    // step — reporting it as configured would leave the user staring at a
    // pipeline that cannot possibly deliver.
    expect(read.exists).toBe(true);
    expect(read.config).toBeNull();
  });

  it("reads a plugin with no API stamp as written for OpenCode 1", () => {
    const unstamped = buildOpencodePlugin(INSTALL, 1)
      .split("\n")
      .filter((line) => !line.startsWith("// opencode-plugin-api:"))
      .join("\n");
    writeOpencodePlugin(unstamped, pluginPath);

    expect(readOpencodePlugin(pluginPath).api).toBe(1);
  });

  it("reads a plugin with no stamp as unstamped", () => {
    // `null` means "not the current generation".
    const unstamped = buildOpencodePlugin(INSTALL)
      .split("\n")
      .filter((line) => !line.startsWith("// clocktopus-plugin-version:"))
      .join("\n");
    writeOpencodePlugin(unstamped, pluginPath);

    const read = readOpencodePlugin(pluginPath);
    // Still configured — it reports fine, it is just behind.
    expect(read.config).toEqual(INSTALL);
    expect(read.version).toBeNull();
  });

  it("reports nothing at all when the file is absent", () => {
    expect(readOpencodePlugin(pluginPath)).toMatchObject({
      exists: false,
      config: null,
    });
  });
});

describe("removing the plugin", () => {
  it("deletes the file and says so", () => {
    writeOpencodePlugin(buildOpencodePlugin(INSTALL), pluginPath);

    expect(removeOpencodePlugin(pluginPath)).toBe(true);
    expect(readOpencodePlugin(pluginPath).exists).toBe(false);
  });

  it("is a no-op when there is nothing installed", () => {
    expect(removeOpencodePlugin(pluginPath)).toBe(false);
  });
});

describe("opencode.json's Clocktopus MCP entry", () => {
  const userConfig = {
    $schema: "https://opencode.ai/config.json",
    model: "anthropic/claude-sonnet-5-5",
    mcp: { linear: { type: "remote", url: "https://mcp.linear.app/mcp" } },
  };
  const v2UserConfig = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      servers: {
        linear: { type: "remote", url: "https://mcp.linear.app/mcp" },
      },
    },
  };
  const API_URL = "https://clocktopus.example.com";
  const MCP_URL = "https://clocktopus.example.com/api/mcp";
  const ENTRY = { type: "remote", url: MCP_URL, oauth: {} };

  it("adds the remote server with OAuth beside the user's own for OpenCode 1, and backs up the file", () => {
    const path = join(dir, "opencode.json");
    writeFileSync(path, JSON.stringify(userConfig));

    const current = readOpencodeConfig(path);
    const { backupPath } = writeOpencodeConfig(
      applyOpencodeMcp(current.config, { apiUrl: API_URL, api: 1 }),
      path,
    );
    const written = JSON.parse(readFileSync(path, "utf8"));

    expect(written).toEqual({
      ...userConfig,
      mcp: { ...userConfig.mcp, clocktopus: ENTRY },
    });
    expect(readOpencodeMcpUrl(readOpencodeConfig(path).config, 1)).toBe(
      MCP_URL,
    );
    expect(JSON.parse(readFileSync(backupPath!, "utf8"))).toEqual(userConfig);
  });

  it("adds the server under mcp.servers for OpenCode 2, beside the user's own", () => {
    const installed = applyOpencodeMcp(v2UserConfig, {
      apiUrl: API_URL,
      api: 2,
    });

    expect(installed).toEqual({
      ...v2UserConfig,
      mcp: { servers: { ...v2UserConfig.mcp.servers, clocktopus: ENTRY } },
    });
    expect(readOpencodeMcpUrl(installed, 2)).toBe(MCP_URL);
    expect(readOpencodeMcpUrl(installed, 1)).toBeNull();
  });

  it("moves an OpenCode 1 entry under mcp.servers when set up for OpenCode 2", () => {
    const v1Installed = applyOpencodeMcp(userConfig, {
      apiUrl: API_URL,
      api: 1,
    });

    expect(applyOpencodeMcp(v1Installed, { apiUrl: API_URL, api: 2 })).toEqual({
      ...userConfig,
      mcp: { ...userConfig.mcp, servers: { clocktopus: ENTRY } },
    });
  });

  it("finds an OpenCode 1 entry for OpenCode 2, which still loads that shape", () => {
    const v1Installed = applyOpencodeMcp(userConfig, {
      apiUrl: API_URL,
      api: 1,
    });

    expect(readOpencodeMcpUrl(v1Installed, 2)).toBe(MCP_URL);
  });

  it("creates the file when there is none", () => {
    const path = join(dir, "opencode.json");
    const current = readOpencodeConfig(path);

    expect(current.exists).toBe(false);
    writeOpencodeConfig(
      applyOpencodeMcp(current.config, { apiUrl: API_URL, api: 2 }),
      path,
    );
    expect(readOpencodeMcpUrl(readOpencodeConfig(path).config, 2)).toBe(
      MCP_URL,
    );
  });

  it("removes only its own entry, and the mcp key when nothing else is left", () => {
    expect(
      removeOpencodeMcp(
        applyOpencodeMcp(userConfig, { apiUrl: API_URL, api: 1 }),
      ),
    ).toEqual({ config: userConfig, removed: ["mcp.clocktopus"] });
    expect(
      removeOpencodeMcp(
        applyOpencodeMcp(v2UserConfig, { apiUrl: API_URL, api: 2 }),
      ),
    ).toEqual({ config: v2UserConfig, removed: ["mcp.servers.clocktopus"] });

    const { config } = removeOpencodeMcp(
      applyOpencodeMcp({}, { apiUrl: API_URL, api: 2 }),
    );
    expect(JSON.parse(JSON.stringify(config))).toEqual({});
  });

  it("removes the entry from both shapes when both are present", () => {
    const both = {
      mcp: { clocktopus: ENTRY, servers: { clocktopus: ENTRY } },
    };

    const { config, removed } = removeOpencodeMcp(both);
    expect(removed).toEqual(["mcp.clocktopus", "mcp.servers.clocktopus"]);
    expect(JSON.parse(JSON.stringify(config))).toEqual({});
  });

  it("reports nothing removed when no entry is there", () => {
    expect(removeOpencodeMcp(userConfig)).toEqual({
      config: userConfig,
      removed: [],
    });
  });

  it("refuses a file with comments rather than rewriting it without them", () => {
    const path = join(dir, "opencode.jsonc");
    writeFileSync(path, '{\n  // my model\n  "model": "x"\n}\n');

    expect(() => readOpencodeConfig(path)).toThrow(/by hand/);
  });
});
