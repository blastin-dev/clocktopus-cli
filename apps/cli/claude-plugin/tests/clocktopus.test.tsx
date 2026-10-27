import type { On } from "claude-code";
import type { TestBody } from "claude-code/testing";
import { expect, mock, test } from "claude-code/testing";

const REMOTE = "git@github.com:acme-co/acme-portal.git";
const SERVER = "plugin:clocktopus:clocktopus";
const START = {
  cwd: "/work/acme-portal",
  surface: "terminal",
  isInteractive: true,
} as const;
const BAND = {
  plugin: "clocktopus",
  component: "AbovePrompt",
  requestId: "band",
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const;
const PANE = {
  plugin: "clocktopus",
  component: "Pane",
  requestId: "clocktopus-goal",
  props: {
    title: "Clocktopus",
    isFocused: false,
    bodyColumns: 70,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const;
const MODES = {
  plugin: "clocktopus",
  component: "SessionMode",
  requestId: "modes",
  props: { modes: ["focus"] },
} as const;
const FULLSCREEN = { columns: 160, rows: 40, isFullscreen: true } as const;

// The footer's last mode label, as the test's own `SessionMode` hook draws it: `focus` when the
// plugin adds none.
async function footer($: Parameters<TestBody>[0]) {
  const ui = await $.ui.mount({ ...MODES, surface: "terminal" });
  const line = (await ui.find({ type: "Text" }))?.text;
  await ui.unmount();
  return line;
}

const GOAL = {
  id: "goal-2",
  ref: "G-2",
  title: "Invoices go out without a spreadsheet",
  doneCount: 1,
};
const TASKS: Record<
  string,
  {
    key: string;
    title: string;
    stage: string;
    hours: number;
    agentHours: number;
  }
> = {
  "ACME-41": {
    key: "ACME-41",
    title: "Invoices carry the client address",
    stage: "in_review",
    hours: 0,
    agentHours: 0,
  },
  "ACME-42": {
    key: "ACME-42",
    title: "Export invoices as CSV",
    stage: "in_progress",
    hours: 1.5,
    agentHours: 0.25,
  },
  "ACME-43": {
    key: "ACME-43",
    title: "Email the invoice to the client",
    stage: "created",
    hours: 0,
    agentHours: 0,
  },
};
const BRANCH_KEY: Record<string, string> = { "dana/acme-42-export": "ACME-42" };

// What the server holds for this session and repository.
type World = {
  branch: string;
  // `get_session_panel`'s status for the repository; `ok` when absent.
  status?: "no_project" | "unsupported_repository" | "choose_organization";
  // `$.mcp.connect`'s refusal: `failed` while the server is still connecting.
  refusal?: "failed" | "auth";
  // Whether `get_session_panel` fails.
  isFailing?: boolean;
  // `origin` as git has it; REMOTE when absent, none when null.
  remote?: string | null;
  // Whether the session runs in a linked worktree rather than the main checkout.
  worktree?: boolean;
  // Whether Clocktopus has seen the session, and the task it last tied it to.
  isKnown: boolean;
  currentKey?: string;
  // The session's spend on each task listing it, in dollars; the whole session's is $4.
  shares: Record<string, number | null>;
  sessionCostUsd?: number | null;
  // `clocktopus --version`'s, and this session's plugin manifest's; the plugin carries 0.0.0, as
  // one built from source does, when absent.
  installedCli?: string;
  pluginVersion?: string;
  // What the server answers for the CLI version it is sent.
  cli?: {
    latest: string | null;
    minimum: string;
    isBehind: boolean;
    isUnsupported: boolean;
  };
};

const reported = (
  shares: Record<string, number | null>,
  currentKey?: string,
): World => ({
  branch: "dana/acme-42-export",
  isKnown: true,
  currentKey,
  shares,
});

// Stands for the engine beneath the plugin.
function engine(on: On, world: World) {
  const calls: {
    tool: string;
    server: string;
    args: Record<string, unknown>;
  }[] = [];
  const connects: string[] = [];
  const opens: string[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 26, 9, 30) });
  mock.env(on, { HOME: "/home/dana" });
  const describe = (key: string | null) => {
    const task = key ? TASKS[key] : undefined;
    return task
      ? {
          ...task,
          pageUrl: `https://clocktopus.app/acme/work/tasks/${task.key}`,
        }
      : null;
  };

  const sessionPanel = (args: Record<string, unknown>) => {
    const cli =
      world.cli && args.cliVersion
        ? { cli: { version: args.cliVersion, ...world.cli } }
        : {};
    return { ...taskPanel(args), ...cli };
  };
  const taskPanel = (args: Record<string, unknown>) => {
    if (args.repositoryUrl !== REMOTE)
      return { status: "unsupported_repository" };
    if (world.status) return { status: world.status };
    const branchKey = BRANCH_KEY[String(args.branch)] ?? null;
    const taskKey = world.currentKey ?? branchKey;
    const sessionCostUsd =
      world.sessionCostUsd === undefined ? 4 : world.sessionCostUsd;
    return {
      status: "ok",
      project: {
        id: "p-1",
        name: "Acme Portal",
        organizationId: "org-1",
        organizationSlug: "acme",
      },
      taskKey,
      task: describe(taskKey),
      branchTask:
        branchKey && branchKey !== taskKey ? describe(branchKey) : null,
      attribution: {
        agent: "claude_code",
        sessionId: args.agentSessionId,
        known: world.isKnown,
        currentKey: world.currentKey ?? null,
        branchKey,
        countsTowardTask:
          world.isKnown && taskKey !== null && taskKey in world.shares,
        sessionCostUsd: world.isKnown ? sessionCostUsd : null,
        tasks: Object.entries(world.shares).map(([key, costUsd]) => ({
          key,
          share: 0.5,
          costUsd,
        })),
        startedAt: world.isKnown ? "2026-10-26T09:00:00.000Z" : null,
        lastActivityAt: world.isKnown ? "2026-10-26T09:29:00.000Z" : null,
        closedAt: null,
      },
      goal:
        taskKey && TASKS[taskKey]
          ? {
              ...GOAL,
              open: [
                { ...TASKS["ACME-41"], claimed: true },
                { ...TASKS["ACME-42"], claimed: true },
                { ...TASKS["ACME-43"], claimed: false },
              ].map(({ key, title, stage, claimed }) => ({
                key,
                title,
                stage,
                claimed,
              })),
            }
          : null,
    };
  };

  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: { command: "clocktopus-panel" } }));
  let isPaneUp = false;
  on("ui.open", () => {
    opens.push("pane");
    isPaneUp = true;
    return { value: { isPlaced: true } };
  });
  on("ui.close", () => {
    opens.push("closed");
    isPaneUp = false;
    return { value: undefined };
  });
  on("ui.panes", () => ({
    value: isPaneUp
      ? [
          {
            id: "clocktopus-goal",
            title: "Clocktopus",
            isShown: true,
            isFocused: false,
            isPlaced: true,
          },
        ]
      : [],
  }));
  on("ui.render", { component: "SessionMode" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{e.props.modes.at(-1) ?? ""}</Text>;
  });
  on("session.id", () => ({ value: "s-1" }));
  on("ui.copy", (_, e) => {
    copied.push(e.text);
    return { value: { isCopied: true } };
  });
  on("ui.toast", () => ({ value: undefined }));
  on("session.repo", () => ({
    value:
      world.remote === null
        ? null
        : {
            root: "/work/acme-portal",
            remote: world.remote ?? REMOTE,
            internal: false,
            name: null,
          },
  }));
  on("fs.read", (_, e) => ({
    value: e.path.endsWith("/.claude-plugin/plugin.json")
      ? JSON.stringify({
          name: "clocktopus",
          version: world.pluginVersion ?? "0.0.0",
        })
      : "",
  }));
  on("process.run", (_, e) => {
    if (e.argv[0] === "clocktopus") {
      return {
        value: {
          exitCode: world.installedCli ? 0 : 127,
          stdout: world.installedCli ? `${world.installedCli}\n` : "",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    }
    if (e.argv[0] === "xdg-open") opened.push(e.argv[1] ?? "");
    const stdout =
      e.argv[0] === "ssh"
        ? `user dana\nhostname ${e.argv[2] === "github-acme" ? "github.com" : e.argv[2]}\nport 22\n`
        : e.argv.includes("--show-toplevel")
          ? world.worktree
            ? `/home/dana/work/acme-portal-export\n/home/dana/work/acme-portal/.git/worktrees/acme-portal-export\n/home/dana/work/acme-portal/.git\n`
            : `/home/dana/work/acme-portal\n/home/dana/work/acme-portal/.git\n/home/dana/work/acme-portal/.git\n`
          : e.argv.includes("rev-parse")
            ? "/work/acme-portal/.git\n"
            : `${world.branch}\n`;
    return {
      value: {
        exitCode: 0,
        stdout,
        stderr: "",
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  on("classic.SessionStart", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine band</Text>;
  });
  on("classic.FileChanged", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("mcp.connect", (_, e) => {
    connects.push(e.server);
    if (world.refusal) {
      return {
        value: {
          isConnected: false,
          reason: world.refusal,
          message: `${e.server}: ${world.refusal}`,
        },
      };
    }
    return { value: { isConnected: true, server: SERVER } };
  });
  on("mcp.call", (_, e) => {
    calls.push({ tool: e.tool, server: e.server, args: e.args });
    if (e.tool !== "get_session_panel")
      throw new Error(`unexpected tool ${e.tool}`);
    if (world.isFailing) throw new Error("clocktopus: unavailable");
    return {
      value: {
        content: [{ type: "text", text: JSON.stringify(sessionPanel(e.args)) }],
        isError: false,
      },
    };
  });
  on("tool.call", (_, e) =>
    e.tool.endsWith("__failing_tool")
      ? { result: {}, text: "failed", isError: true }
      : { result: {}, text: "{}" },
  );

  return { calls, connects, clock, opens, opened, copied };
}

test("the status line, band and pane show the branch task, its goal and the attribution", async ($, on) => {
  const { clock, opened } = engine(on, reported({ "ACME-42": 1.5 }, "ACME-42"));
  await $.session.start(START);
  await clock.settle();

  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");

  await $.command.run({
    command: "clocktopus-panel",
    args: "band",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 120 },
  });
  for (const surface of ["terminal", "desktop"] as const) {
    const band = await $.ui.mount({ ...BAND, surface });
    expect(
      (await band.find({ type: "Text", text: /ACME-42/ }))?.text,
    ).toContain("ACME-42");
    expect(
      (await band.find({ type: "Text", text: /^attributed/ }))?.props.color,
    ).toBe("success");
    expect(await band.find({ type: "Button", key: "open" })).toBeDefined();
    expect((await band.find({ type: "Text", text: /G-2/ }))?.text).toContain(
      "1/4 done",
    );
    expect((await band.find({ type: "Text", text: /human/ }))?.text).toContain(
      "1.5h human",
    );
    await band.unmount();

    const pane = await $.ui.mount({ ...PANE, surface });
    expect((await pane.find({ type: "Text", text: /Linked to/ }))?.text).toBe(
      "✓ Linked to ACME-42",
    );
    expect((await pane.find({ type: "Text", text: /^1\.5h$/ }))?.text).toBe(
      "1.5h",
    );
    expect((await pane.find({ type: "Text", text: /^15m$/ }))?.text).toBe(
      "15m",
    );
    expect((await pane.find({ type: "Text", text: /in all/ }))?.text).toBe(
      "$4.00 in all · $1.50 on ACME-42",
    );
    await pane.press({ key: "open" });
    expect(opened.at(-1)).toBe(
      "https://clocktopus.app/acme/work/tasks/ACME-42",
    );
    expect(
      (await pane.find({ type: "Text", text: /Invoices go out/ }))?.text,
    ).toBe("Invoices go out without a spreadsheet");
    expect((await pane.find({ type: "Text", text: /▶/ }))?.text).toMatch(
      /in progress/,
    );
    const keys = await pane.findAll({ type: "Text", text: /^ACME-4[123]\s*$/ });
    expect(keys.map((found) => [found.text.trim(), found.props.color])).toEqual(
      [
        ["ACME-42", "#f59e0b"],
        ["ACME-41", "#10b981"],
        ["ACME-42", "#f59e0b"],
        ["ACME-43", "inactive"],
      ],
    );
    await pane.unmount();
  }
});

test("one get_session_panel call on the connected server reads everything", async ($, on) => {
  const { calls, clock, connects } = engine(on, reported({ "ACME-42": 1 }));
  await $.session.start(START);
  await clock.settle();

  expect(connects).toEqual(["clocktopus"]);
  expect(calls).toEqual([
    {
      tool: "get_session_panel",
      server: SERVER,
      args: {
        repositoryUrl: REMOTE,
        agentSessionId: "s-1",
        agent: "claude_code",
        branch: "dana/acme-42-export",
      },
    },
  ]);
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /^✓/ }))?.text).toBe(
    "✓ Counts toward ACME-42 by its branch",
  );
  await pane.unmount();
});

test("a session linked to another task shows that task, with the branch’s beside it", async ($, on) => {
  const { clock, opened } = engine(
    on,
    reported({ "ACME-42": 1, "ACME-43": 3 }, "ACME-43"),
  );
  await $.session.start(START);
  await clock.settle();

  expect(await footer($)).toBe(
    "ACME-43 · created · G-2 1/4 · attributed · branch ACME-42",
  );

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /Linked to/ }))?.text).toBe(
    "✓ Linked to ACME-43",
  );
  expect((await pane.find({ type: "Text", text: /in all/ }))?.text).toBe(
    "$4.00 in all · $1.00 on ACME-42 · $3.00 on ACME-43",
  );
  await pane.press({ key: "open" });
  expect(opened.at(-1)).toBe("https://clocktopus.app/acme/work/tasks/ACME-43");
  expect(
    (await pane.find({ type: "Text", text: /^ACME-43\s*$/ }))?.props.color,
  ).toBe("inactive");
  await pane.unmount();
});

test("a session its task does not list is not attributed, and is checked again", async ($, on) => {
  const world: World = {
    branch: "dana/acme-42-export",
    isKnown: true,
    shares: {},
  };
  const { clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();

  expect(await footer($)).toBe(
    "ACME-42 · in progress · G-2 1/4 · not attributed",
  );
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  const line = await pane.find({ type: "Text", text: /Not attributed/ });
  expect(line?.text).toBe("✗ Not attributed: ACME-42 doesn't list it");
  expect(line?.props.color).toBe("warning");
  await pane.unmount();

  world.shares = { "ACME-42": 0 };
  await clock.advance(10_000);
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("a session Clocktopus has not seen says so", async ($, on) => {
  const { clock } = engine(on, {
    branch: "dana/acme-42-export",
    isKnown: false,
    shares: {},
  });
  await $.session.start(START);
  await clock.settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(
    (await pane.find({ type: "Text", text: /Not attributed/ }))?.text,
  ).toBe("✗ Not attributed: Clocktopus hasn't seen this session");
  expect(await pane.find({ type: "Text", text: /^Spend$/ })).toBeUndefined();
  await pane.unmount();
});

test("spend the agent does not report reads as none yet, never $0.00", async ($, on) => {
  const { clock } = engine(on, {
    ...reported({ "ACME-42": null }, "ACME-42"),
    sessionCostUsd: null,
  });
  await $.session.start(START);
  await clock.settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /none yet/ }))?.text).toBe(
    "none yet",
  );
  expect(await pane.find({ type: "Text", text: /\$0\.00/ })).toBeUndefined();
  await pane.unmount();
});

test("a branch naming no task says so, and a Clocktopus tool call shows the tie it made", async ($, on) => {
  const world: World = { branch: "main", isKnown: true, shares: {} };
  const { clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();
  expect(await footer($)).toBe("Clocktopus: branch main names no task");

  world.currentKey = "ACME-42";
  world.shares = { "ACME-42": 0 };
  await $.tool.call({
    tool: "mcp__plugin_clocktopus_clocktopus__link_session",
    repositoryUrl: REMOTE,
    key: "acme-42",
    agentSessionId: "s-1",
  });
  await clock.settle();
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("several organisations linking the repository says so", async ($, on) => {
  const { clock } = engine(on, {
    ...reported({}),
    status: "choose_organization",
  });
  await $.session.start(START);
  await clock.settle();
  expect(await footer($)).toBe(
    "Clocktopus: several organisations link this repository",
  );
});

for (const status of ["no_project", "unsupported_repository"] as const) {
  test(`a repository answering ${status} shows nothing and opens no pane`, async ($, on) => {
    const { clock, opens } = engine(on, {
      ...reported({ "ACME-42": 1 }),
      status,
    });
    await $.session.start(START);
    await clock.settle();

    expect(await footer($)).toBe("focus");
    const full = await $.ui.mount({
      ...MODES,
      surface: "terminal",
      viewport: FULLSCREEN,
    });
    await full.unmount();
    await clock.advance(1);
    expect(opens).toEqual([]);
    await $.command.run({
      command: "clocktopus-panel",
      args: "band",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 120 },
    });
    const band = await $.ui.mount({ ...BAND, surface: "terminal" });
    expect((await band.find({ type: "Text" }))?.text).toBe("engine band");
    await band.unmount();
  });
}

test("a repository answering no_project stays silent when a later refresh fails", async ($, on) => {
  const world: World = { ...reported({ "ACME-42": 1 }), status: "no_project" };
  const { clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();

  world.isFailing = true;
  await $.classic.CwdChanged({
    old_cwd: "/work/acme-portal",
    new_cwd: "/work/acme-portal",
  });
  await clock.settle();
  expect(await footer($)).toBe("focus");
});

test("a remote Clocktopus does not recognise shows nothing", async ($, on) => {
  const { clock } = engine(on, {
    ...reported({ "ACME-42": 1 }),
    remote: "git@gitlab.example:acme-co/acme-portal.git",
  });
  await $.session.start(START);
  await clock.settle();
  expect(await footer($)).toBe("focus");
});

test("outside a git repository nothing shows and the server is not asked", async ($, on) => {
  const { calls, clock, connects } = engine(on, {
    ...reported({}),
    remote: null,
  });
  await $.session.start(START);
  await clock.settle();

  expect(await footer($)).toBe("focus");
  expect(connects).toEqual([]);
  expect(calls).toEqual([]);
});

test("a server waiting for sign-in shows nothing, and the pane says why", async ($, on) => {
  const { calls, clock } = engine(on, {
    ...reported({ "ACME-42": 1 }),
    refusal: "auth",
  });
  await $.session.start(START);
  await clock.settle();

  expect(await footer($)).toBe("focus");
  expect(calls).toEqual([]);
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /auth/ }))?.text).toBe(
    "clocktopus: auth",
  );
  await pane.unmount();
});

test("a server still connecting at start shows nothing, then the task once it connects", async ($, on) => {
  const world: World = { ...reported({ "ACME-42": 1 }), refusal: "failed" };
  const { clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();
  expect(await footer($)).toBe("focus");

  delete world.refusal;
  await clock.advance(3000);
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("a server that never connects shows its error once the retries run out", async ($, on) => {
  const { clock } = engine(on, { ...reported({}), refusal: "failed" });
  await $.session.start(START);
  await clock.advance(11 * 3000);
  expect(await footer($)).toBe("Clocktopus: clocktopus: failed");
});

test("the checkout’s HEAD is watched, and a branch switch there refreshes", async ($, on) => {
  const world: World = {
    branch: "main",
    isKnown: true,
    shares: { "ACME-42": 1 },
  };
  const { clock } = engine(on, world);
  await $.session.start(START);
  const started = await $.classic.SessionStart({ source: "startup" });
  expect(started.watchPaths).toEqual(["/work/acme-portal/.git/HEAD"]);
  await clock.settle();
  expect(await footer($)).toBe("Clocktopus: branch main names no task");

  world.branch = "dana/acme-42-export";
  await $.classic.FileChanged({
    file_path: "/work/acme-portal/.git/HEAD",
    event: "change",
  });
  await clock.settle();
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("moving to another directory refreshes", async ($, on) => {
  const world: World = {
    branch: "main",
    isKnown: true,
    shares: { "ACME-42": 1 },
  };
  const { clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();

  world.branch = "dana/acme-42-export";
  await $.classic.CwdChanged({
    old_cwd: "/work/acme-portal",
    new_cwd: "/work/acme-portal-export",
  });
  await clock.settle();
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("a branch switch in Bash and EnterWorktree refresh", async ($, on) => {
  const world: World = {
    branch: "main",
    isKnown: true,
    shares: { "ACME-42": 1 },
  };
  const { calls, clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();

  world.branch = "dana/acme-42-export";
  await $.tool.call({
    tool: "Bash",
    command: "git switch dana/acme-42-export",
  });
  await clock.settle();
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");

  const before = calls.length;
  await $.tool.call({ tool: "EnterWorktree", name: "acme-42" });
  await clock.settle();
  expect(calls.length).toBe(before + 1);
});

test("a change to another watched file does not refresh", async ($, on) => {
  const { clock, calls } = engine(on, {
    branch: "main",
    isKnown: true,
    shares: {},
  });
  await $.session.start(START);
  await clock.settle();
  const before = calls.length;

  await $.classic.FileChanged({
    file_path: "/work/acme-portal/.env",
    event: "change",
  });
  await clock.settle();
  expect(calls.length).toBe(before);
});

test("any Clocktopus tool call the model makes refreshes once it finishes", async ($, on) => {
  const world: World = {
    branch: "dana/acme-42-export",
    isKnown: true,
    shares: {},
  };
  const { clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();
  expect(await footer($)).toBe(
    "ACME-42 · in progress · G-2 1/4 · not attributed",
  );

  world.shares = { "ACME-42": 1 };
  await $.tool.call({
    tool: "mcp__plugin_clocktopus_clocktopus__search_tasks",
    repositoryUrl: REMOTE,
  });
  await clock.settle();
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("a failed Clocktopus call or another server’s call does not refresh", async ($, on) => {
  const { clock, calls } = engine(on, reported({ "ACME-42": 1 }));
  await $.session.start(START);
  await clock.settle();
  const before = calls.length;

  await $.tool.call({
    tool: "mcp__plugin_clocktopus_clocktopus__failing_tool",
  });
  await $.tool.call({ tool: "mcp__linear__search_issues" });
  await clock.settle();
  expect(calls.length).toBe(before);
});

test("the band is hidden until asked for", async ($, on) => {
  const { clock } = engine(on, reported({ "ACME-42": 1 }));
  await $.session.start(START);
  await clock.settle();
  const band = await $.ui.mount({ ...BAND, surface: "terminal" });
  expect(await band.find({ type: "Text", text: /ACME-42/ })).toBeUndefined();
  await band.unmount();
});

test("the pane opens once by itself in the fullscreen layout, and not on the main screen", async ($, on) => {
  const { clock, opens } = engine(on, reported({}));
  await $.session.start(START);
  await clock.settle();

  const main = await $.ui.mount({
    ...MODES,
    surface: "terminal",
    viewport: { ...FULLSCREEN, isFullscreen: false },
  });
  await main.unmount();
  await clock.settle();
  expect(opens).toEqual([]);

  for (let i = 0; i < 2; i += 1) {
    const full = await $.ui.mount({
      ...MODES,
      surface: "terminal",
      viewport: FULLSCREEN,
    });
    await full.unmount();
    await clock.advance(1);
  }
  expect(opens).toEqual(["pane"]);
});

test("the pane names the checkout: the main one, or the linked worktree the session runs in", async ($, on) => {
  const world = reported({ "ACME-42": 1 });
  const { clock } = engine(on, world);
  await $.session.start(START);
  await clock.settle();

  let pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /^~\// }))?.text).toBe(
    "~/work/acme-portal (main checkout)",
  );
  await pane.unmount();

  world.worktree = true;
  await $.classic.CwdChanged({
    old_cwd: "/home/dana/work/acme-portal",
    new_cwd: "/home/dana/work/acme-portal-export",
  });
  await clock.settle();
  pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /^~\// }))?.text).toBe(
    "~/work/acme-portal-export",
  );
  await pane.unmount();
});

test("the command opens the pane, and closes it when it is up", async ($, on) => {
  const { clock, opens } = engine(on, reported({}));
  await $.session.start(START);
  await clock.settle();
  const run = () =>
    $.command.run({
      command: "clocktopus-panel",
      args: "",
      origin: { kind: "composer" },
      presentation: { isFullscreen: true, columns: 160 },
    });

  await run();
  await run();
  await run();
  expect(opens).toEqual(["pane", "closed", "pane"]);
  await clock.settle();
});

test("the refresh command prints the status line", async ($, on) => {
  const { clock } = engine(on, reported({ "ACME-42": 1 }));
  await $.session.start(START);
  await clock.settle();
  const result = await $.command.run({
    command: "clocktopus-panel",
    args: "refresh",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 120 },
  });
  expect(result.text).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("the pane shows this session’s id and copies it whole", async ($, on) => {
  const { clock, copied } = engine(on, reported({ "ACME-42": 1 }));
  await $.session.start(START);
  await clock.settle();

  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /^s-1/ }))?.text).toBe("s-1…");
  await pane.press({ key: "copy-session" });
  expect(copied).toEqual(["s-1"]);
  await pane.unmount();
});

test("a remote through an SSH host alias is resolved to the real host", async ($, on) => {
  const { calls, clock } = engine(on, {
    ...reported({ "ACME-42": 1 }),
    remote: "git@github-acme:acme-co/acme-portal.git",
  });
  await $.session.start(START);
  await clock.settle();
  expect(calls[0]?.args.repositoryUrl).toBe(REMOTE);
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
});

test("the pane shows the CLI's version, the one available and how to upgrade", async ($, on) => {
  const { calls, clock } = engine(on, {
    ...reported({ "ACME-42": 1 }),
    installedCli: "0.9.0",
    pluginVersion: "0.9.0",
    cli: {
      latest: "0.10.0",
      minimum: "0.0.0",
      isBehind: true,
      isUnsupported: false,
    },
  });
  await $.session.start(START);
  await clock.settle();

  expect(calls[0]?.args.cliVersion).toBe("0.9.0");
  expect(await footer($)).toBe("ACME-42 · in progress · G-2 1/4 · attributed");
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /available$/ }))?.text).toBe(
    "0.10.0 available",
  );
  expect(
    (await pane.find({ type: "Text", text: /^clocktopus upgrade$/ }))?.text,
  ).toBe("clocktopus upgrade");
  await pane.unmount();
});

test("a CLI the server no longer serves puts an upgrade in the status line", async ($, on) => {
  const { clock } = engine(on, {
    ...reported({ "ACME-42": 1 }),
    installedCli: "0.7.0",
    cli: {
      latest: "0.10.0",
      minimum: "0.8.0",
      isBehind: true,
      isUnsupported: true,
    },
  });
  await $.session.start(START);
  await clock.settle();

  expect(await footer($)).toBe(
    "ACME-42 · in progress · G-2 1/4 · attributed · CLI upgrade required",
  );
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(
    (await pane.find({ type: "Text", text: /^✗ Upgrade required/ }))?.text,
  ).toBe("✗ Upgrade required: Clocktopus needs 0.8.0 or later");
  await pane.unmount();
});

test("a CLI upgraded under the session names the plugin the session loaded", async ($, on) => {
  const { calls, clock } = engine(on, {
    ...reported({ "ACME-42": 1 }),
    installedCli: "0.10.0",
    pluginVersion: "0.9.0",
    cli: {
      latest: "0.10.0",
      minimum: "0.0.0",
      isBehind: false,
      isUnsupported: false,
    },
  });
  await $.session.start(START);
  await clock.settle();

  expect(calls[0]?.args.cliVersion).toBe("0.10.0");
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect((await pane.find({ type: "Text", text: /^✓ Latest$/ }))?.text).toBe(
    "✓ Latest",
  );
  expect(
    (await pane.find({ type: "Text", text: /in this session/ }))?.text,
  ).toBe("0.9.0 in this session; new sessions load 0.10.0");
  await pane.unmount();
});

test("without a CLI or a plugin version the server is not asked about one", async ($, on) => {
  const { calls, clock } = engine(on, reported({ "ACME-42": 1 }));
  await $.session.start(START);
  await clock.settle();

  expect(calls[0]?.args).not.toHaveProperty("cliVersion");
});
