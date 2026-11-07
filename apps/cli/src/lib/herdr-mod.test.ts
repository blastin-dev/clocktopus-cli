import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskBoard } from "@repo/cli-contract/task-board";
import { extractTaskKeyFromBranch } from "@repo/cli-contract/task-key";
import { describe, expect, it } from "vitest";

import {
  HERDR_SESSION_LABEL as PLUGIN_SESSION_LABEL,
  HERDR_TASK_LABEL as PLUGIN_TASK_LABEL,
  herdrLabelArgs as pluginLabelArgs,
} from "../../claude-plugin/hooks/panel";
import {
  agentsByTask,
  ago,
  BOARD_HINTS,
  branchKeyOf,
  clickTarget,
  environmentBanner,
  filterTasks,
  forkArgv,
  goalKeys,
  isBoardHint,
  labelledSessions,
  labelledTasks,
  liveAgents,
  localSessionsScript,
  mostUrgent,
  parseBoard,
  parseLocalSessions,
  pollEvery,
  resumeArgv,
  resumeChoice,
  resumeSpace,
  spaceFolder,
  startAgent,
  startPrompt,
  terminalOf,
  withAgentStages,
} from "../../herdr/mods/clocktopus/model.js";
import { HERDR_SESSION_LABEL, HERDR_TASK_LABEL } from "./herdr-terminal.js";
import { BOARD_TOPICS } from "./realtime-watch.js";

type BoardTask = Extract<TaskBoard, { status: "ok" }>["tasks"][number];
type BoardSession = BoardTask["sessions"][number];

function session(overrides: Partial<BoardSession> = {}): BoardSession {
  return {
    agent: "claude_code",
    sessionId: "session-1",
    cwd: "~/acme-portal",
    gitBranch: "dana/acme-1-export",
    startedAt: "2026-11-05T09:00:00.000Z",
    lastActivityAt: "2026-11-05T10:00:00.000Z",
    closedAt: "2026-11-05T10:00:00.000Z",
    current: true,
    ...overrides,
  };
}

function task(key: string, overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    key,
    title: `Task ${key}`,
    kind: null,
    stage: "in_progress",
    stageSince: null,
    lastActivityAt: null,
    stale: false,
    goal: null,
    pageUrl: null,
    working: [],
    sessions: [],
    ...overrides,
  };
}

const program = { name: "Claude Code" };

function herdrAgent(address: string, pane: string, status = "working") {
  return {
    address,
    pane,
    space: "space-1",
    status,
    app: "claude-code",
    program,
    focused: false,
  };
}

describe("branchKeyOf", () => {
  it("reads a branch's task key as the shared contract does", () => {
    for (const branch of [
      "dana/acme-42-export-invoices",
      "ACME-42",
      "acme-42_export",
      "feature/add-oauth-2",
      "release-1.0",
      "release/2",
      "dependabot/github_actions/actions/checkout-7",
      "dana/acme-7.x-fix",
      "main",
    ]) {
      expect(branchKeyOf(branch), branch).toBe(
        extractTaskKeyFromBranch(branch),
      );
    }
  });
});

describe("parseBoard", () => {
  it("reads the JSON line the CLI prints, also on a failure", () => {
    expect(
      parseBoard({ code: 1, stdout: '{"status":"signed_out"}\n', stderr: "" }),
    ).toEqual({ status: "signed_out" });
  });

  it("tells a missing CLI and one without the tasks command from other failures", () => {
    expect(
      parseBoard({
        code: 127,
        stdout: "",
        stderr: "sh: clocktopus: not found",
      }),
    ).toEqual({ status: "no_cli" });
    expect(
      parseBoard({
        code: 1,
        stdout: "",
        stderr: "error: unknown command 'tasks'",
      }),
    ).toEqual({ status: "old_cli" });
    expect(
      parseBoard({ code: 1, stdout: "", stderr: "something broke" }),
    ).toEqual({ status: "error", message: "something broke" });
  });
});

describe("parseBoard on a run that never started", () => {
  it("reports a missing folder or an unreachable machine as an error, not a missing CLI", () => {
    expect(
      parseBoard({
        code: null,
        stdout: "",
        stderr: "No such file or directory: /home/dana/gone",
      }),
    ).toEqual({
      status: "error",
      message: "No such file or directory: /home/dana/gone",
    });
  });
});

describe("labelledSessions", () => {
  it("reads each terminal's session from the label the Clocktopus hook sets", () => {
    expect(
      labelledSessions([
        { address: "t1", labels: { "clocktopus.session": "session-1" } },
        { address: "box/t3", labels: { "clocktopus.session": "session-2" } },
        { address: "t2", labels: { "herdr.space": "space-1" } },
        { address: "t4" },
      ]),
    ).toEqual({ t1: "session-1", "box/t3": "session-2" });
  });
});

describe("the labels Clocktopus puts on a Herdr terminal", () => {
  it("are named the same by the agent hook, the Claude plugin and the panel", () => {
    expect(PLUGIN_SESSION_LABEL).toBe(HERDR_SESSION_LABEL);
    expect(PLUGIN_TASK_LABEL).toBe(HERDR_TASK_LABEL);
    const terminals = [
      {
        address: "t1",
        labels: {
          [HERDR_SESSION_LABEL]: "session-1",
          [HERDR_TASK_LABEL]: "ACME-1",
        },
      },
    ];
    expect(labelledSessions(terminals)).toEqual({ t1: "session-1" });
    expect(labelledTasks(terminals)).toEqual({ t1: "ACME-1" });
  });

  it("has the plugin label the terminal with its session and task, clearing a task it no longer has", () => {
    expect(pluginLabelArgs("t7", "session-1", "ACME-1")).toEqual([
      "label",
      "t7",
      "clocktopus.session=session-1",
      "clocktopus.task=ACME-1",
    ]);
    expect(pluginLabelArgs("t7", "session-1", null)[3]).toBe(
      "clocktopus.task=",
    );
  });
});

describe("a goal run moving to its next task", () => {
  const panes = [
    { pane: "p1", cwd: "/home/dana/acme-portal", branch: "dana/acme-9-older" },
  ];
  const tasks = [
    task("ACME-9", { stage: "in_progress" }),
    task("ACME-1", { stage: "created" }),
    task("ACME-2", { stage: "created" }),
  ];

  it("follows the task label over the board and the branch, and shows that task in progress at once", () => {
    const live = liveAgents(
      [herdrAgent("t1", "p1")],
      panes,
      { t1: "session-1" },
      {
        t1: "ACME-1",
      },
    );
    const byTask = agentsByTask(tasks, live);

    expect(byTask.get("ACME-1")?.map((agent) => agent.via)).toEqual(["label"]);
    expect(byTask.has("ACME-9")).toBe(false);
    expect(clickTarget(byTask.get("ACME-1") ?? [])?.address).toBe("t1");

    const shown = withAgentStages(tasks, byTask);
    expect(shown.tasks.map((t) => `${t.key}:${t.stage}`)).toEqual([
      "ACME-9:in_progress",
      "ACME-1:in_progress",
      "ACME-2:created",
    ]);
    expect(shown.moved).toBe(1);
  });

  it("leaves a To do task where it is when only a branch names it", () => {
    const live = liveAgents(
      [herdrAgent("t1", "p1")],
      [{ pane: "p1", cwd: "/x", branch: "dana/acme-2-y" }],
      {},
    );

    expect(withAgentStages(tasks, agentsByTask(tasks, live)).moved).toBe(0);
  });
});

describe("agentsByTask and clickTarget", () => {
  const panes = [
    { pane: "p1", cwd: "/home/dana/acme-portal", branch: "dana/acme-1-export" },
    { pane: "p2", cwd: "/home/dana/acme-portal", branch: "dana/acme-1-export" },
    { pane: "p3", cwd: "/home/dana/acme-wt", branch: "dana/acme-2-totals" },
  ];
  const tasks = [
    task("ACME-1", {
      sessions: [session({ sessionId: "session-1", current: true })],
    }),
    task("ACME-2"),
    task("ACME-3", {
      sessions: [session({ sessionId: "session-9", current: false })],
    }),
  ];

  it("brings up the tab whose session is the task's, when another tab shares its checkout", () => {
    const live = liveAgents(
      [herdrAgent("t1", "p1"), herdrAgent("t2", "p2", "blocked")],
      panes,
      { t1: "session-1", t2: "session-other" },
    );

    const onTask = agentsByTask(tasks, live).get("ACME-1") ?? [];

    expect(onTask.map((agent) => [agent.address, agent.via])).toEqual([
      ["t1", "session"],
      ["t2", "branch"],
    ]);
    expect(clickTarget(onTask)?.address).toBe("t1");
  });

  it("leaves the choice to the person when only branches match and several tabs do", () => {
    const live = liveAgents(
      [herdrAgent("t1", "p1"), herdrAgent("t2", "p2")],
      panes,
      {},
    );

    expect(
      clickTarget(agentsByTask(tasks, live).get("ACME-1") ?? []),
    ).toBeNull();
  });

  it("brings up the only agent on a branch, and puts no agent on a task its session left", () => {
    const live = liveAgents(
      [herdrAgent("t3", "p3"), herdrAgent("t9", "p9")],
      panes,
      { t9: "session-9" },
    );
    const byTask = agentsByTask(tasks, live);

    expect(clickTarget(byTask.get("ACME-2") ?? [])?.address).toBe("t3");
    expect(byTask.has("ACME-3")).toBe(false);
  });
});

describe("mostUrgent", () => {
  it("ranks an agent that needs the person above one that is working", () => {
    const live = liveAgents(
      [herdrAgent("t1", "p1", "working"), herdrAgent("t2", "p1", "blocked")],
      [],
      {},
    );

    expect(mostUrgent(live)?.address).toBe("t2");
  });
});

describe("resumeArgv", () => {
  it("reopens Claude Code and Codex sessions by id, and no others", () => {
    expect(resumeArgv(session())).toEqual(["claude", "--resume", "session-1"]);
    expect(resumeArgv(session({ agent: "codex_cli" }))).toEqual([
      "codex",
      "resume",
      "session-1",
    ]);
    expect(resumeArgv(session({ agent: "opencode" }))).toBeNull();
    expect(resumeArgv(session({ agent: "cursor" }))).toBeNull();
  });
});

describe("localSessionsScript", () => {
  it("finds, under the home-relative folders the hook reports, the sessions on the machine and those still running", () => {
    const home = mkdtempSync(join(tmpdir(), "clocktopus-herdr-"));
    const checkout = join(home, "acme.portal");
    mkdirSync(checkout);
    const claudeDir = join(
      home,
      ".claude",
      "projects",
      checkout.replace(/[^A-Za-z0-9]/g, "-"),
    );
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, "claude-here.jsonl"), "{}\n");
    writeFileSync(join(claudeDir, "claude-running.jsonl"), "{}\n");
    mkdirSync(join(home, ".claude", "sessions"));
    writeFileSync(
      join(home, ".claude", "sessions", `${process.pid}.json`),
      JSON.stringify({ pid: process.pid, sessionId: "claude-running" }),
    );
    const codexDir = join(home, ".codex", "sessions", "2026", "11", "05");
    mkdirSync(codexDir, { recursive: true });
    writeFileSync(
      join(codexDir, "rollout-2026-11-05T09-00-00-codex-here.jsonl"),
      "{}\n",
    );

    const { script, args } = localSessionsScript([
      session({ sessionId: "claude-here", cwd: "~/acme.portal" }),
      session({ sessionId: "claude-running", cwd: "~/acme.portal" }),
      session({ sessionId: "claude-elsewhere", cwd: "~/acme.portal" }),
      session({ sessionId: "claude-gone", cwd: "~/deleted" }),
      session({ agent: "codex_cli", sessionId: "codex-here", cwd: checkout }),
      session({ agent: "cursor", sessionId: "cursor-1", cwd: "~/acme.portal" }),
      session({ sessionId: "no-folder", cwd: null }),
    ]);
    const stdout = execFileSync("sh", ["-c", script, "test", ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: home },
    });

    expect(parseLocalSessions(stdout)).toEqual(
      new Map([
        ["claude-here", { state: "here", cwd: checkout, pid: null }],
        [
          "claude-running",
          { state: "running", cwd: checkout, pid: process.pid },
        ],
        ["codex-here", { state: "here", cwd: checkout, pid: null }],
      ]),
    );
  });
});

describe("a session still running elsewhere", () => {
  it("is found in the Herdr terminal whose foreground program it is", () => {
    const foregrounds = [
      { address: "t1", pid: 101 },
      { address: "t2", pid: null },
      { address: "t3", pid: 303 },
    ];
    expect(terminalOf(foregrounds, 303)).toBe("t3");
    expect(terminalOf(foregrounds, 999)).toBeNull();
    expect(terminalOf(foregrounds, null)).toBeNull();
  });

  it("opens a Claude Code copy as a new session, and nothing for other agents", () => {
    expect(forkArgv(session())).toEqual([
      "claude",
      "--resume",
      "session-1",
      "--fork-session",
    ]);
    expect(forkArgv(session({ agent: "codex_cli" }))).toBeNull();
  });
});

describe("resumeChoice", () => {
  const found = new Map<
    string,
    {
      machine: string | null;
      state: "here" | "running";
      cwd: string;
      pid: number | null;
    }
  >([
    [
      "older",
      {
        machine: null,
        state: "here",
        cwd: "/home/dana/acme-portal",
        pid: null,
      },
    ],
    [
      "newer",
      { machine: "box", state: "here", cwd: "/srv/acme-portal", pid: null },
    ],
    [
      "running",
      {
        machine: null,
        state: "running",
        cwd: "/home/dana/acme-portal",
        pid: 4242,
      },
    ],
  ]);
  it("resumes the newest session working on the task now, wherever it is", () => {
    const choice = resumeChoice(
      task("ACME-1", {
        sessions: [
          session({ sessionId: "newer", current: false }),
          session({ sessionId: "older", current: true }),
        ],
      }),
      found,
      new Set(),
    );

    expect(choice).toMatchObject({
      session: { sessionId: "older" },
      machine: null,
      cwd: "/home/dana/acme-portal",
      argv: ["claude", "--resume", "older"],
    });
  });

  it("skips sessions open in Herdr, and resumes nothing while one still runs outside it", () => {
    const sessions = [
      session({ sessionId: "older" }),
      session({ sessionId: "newer", current: false }),
    ];
    expect(
      resumeChoice(task("ACME-1", { sessions }), found, new Set(["older"])),
    ).toMatchObject({ session: { sessionId: "newer" }, machine: "box" });
    expect(
      resumeChoice(
        task("ACME-1", {
          sessions: [session({ sessionId: "running" }), ...sessions],
        }),
        found,
        new Set(),
      ),
    ).toBeNull();
  });
});

describe("resumeSpace", () => {
  it("opens the session in the space already at its folder on its machine", () => {
    const spaces = [
      {
        id: "s1",
        machine: null,
        folder: "/home/dana/acme-api",
        tabs: [{ id: "tab-1" }],
      },
      {
        id: "s2",
        machine: "box",
        folder: "/home/dana/acme-portal",
        tabs: [{ id: "tab-2" }],
      },
      { id: "s3", machine: null, folder: "", tabs: [{ id: "tab-3" }] },
    ];
    const panes = [{ tab: "tab-3", cwd: "/home/dana/acme-portal" }];

    expect(
      resumeSpace(spaces, panes, {
        machine: null,
        cwd: "/home/dana/acme-portal",
      })?.id,
    ).toBe("s3");
    expect(
      resumeSpace(spaces, panes, { machine: "box", cwd: "/srv/other" }),
    ).toBeNull();
  });
});

describe("spaceFolder", () => {
  const panes = [
    { tab: "tab-other", cwd: "/home/dana/elsewhere" },
    { tab: "tab-1", cwd: null },
    { tab: "tab-2", cwd: "/home/dana/acme-api" },
  ];

  it("places a space where its first terminal is now, as Herdr's sidebar does", () => {
    expect(
      spaceFolder(
        {
          folder: "/home/dana/acme-portal",
          tabs: [{ id: "tab-1" }, { id: "tab-2" }],
        },
        panes,
      ),
    ).toBe("/home/dana/acme-api");
  });

  it("falls back to the folder the space was made in", () => {
    expect(
      spaceFolder(
        { folder: "/home/dana/acme-portal", tabs: [{ id: "tab-9" }] },
        panes,
      ),
    ).toBe("/home/dana/acme-portal");
  });
});

describe("filterTasks", () => {
  it("keeps the stage's tasks whose key, title or goal has every word", () => {
    const tasks = [
      task("ACME-1", { title: "Export invoices", stage: "created" }),
      task("ACME-2", {
        title: "Totals",
        stage: "created",
        goal: { ref: "G-1", title: "Invoices go out" },
      }),
      task("ACME-3", { title: "Export invoices", stage: "in_review" }),
    ];

    expect(filterTasks(tasks, "created", "invoices").map((t) => t.key)).toEqual(
      ["ACME-1", "ACME-2"],
    );
    expect(
      filterTasks(tasks, "created", "acme-2 g-1").map((t) => t.key),
    ).toEqual(["ACME-2"]);
  });
});

describe("goal filters", () => {
  const goals = [
    { ref: "G-2", title: "Invoices go out", keys: ["ACME-1", "ACME-2"] },
    { ref: "G-1", title: "Customers sign in", keys: ["ACME-3"] },
  ];
  const tasks = ["ACME-1", "ACME-2", "ACME-3", "ACME-4"].map((key) =>
    task(key, { stage: "created" }),
  );

  it("shows every task while no goal is picked", () => {
    expect(goalKeys(goals, [])).toBeNull();
    expect(filterTasks(tasks, "created", "", goalKeys(goals, []))).toHaveLength(
      4,
    );
  });

  it("shows the tasks of every goal picked, and ignores a goal no longer listed", () => {
    expect(
      filterTasks(tasks, "created", "", goalKeys(goals, ["G-2", "G-1"])).map(
        (t) => t.key,
      ),
    ).toEqual(["ACME-1", "ACME-2", "ACME-3"]);
    expect(
      filterTasks(tasks, "created", "", goalKeys(goals, ["G-1", "G-9"])).map(
        (t) => t.key,
      ),
    ).toEqual(["ACME-3"]);
    expect(goalKeys(goals, ["G-9"])).toBeNull();
  });
});

describe("starting work", () => {
  const known = [
    { key: "opencode", name: "OpenCode", run: ["opencode"], installed: true },
    { key: "codex", name: "Codex", run: ["codex"], installed: true },
    { key: "claude", name: "Claude Code", run: ["claude"], installed: false },
    { key: "pi", name: "Pi", run: ["pi"], installed: true },
  ];

  it("starts with the first of Claude Code, Codex and OpenCode installed on the machine", () => {
    expect(startAgent(known)).toEqual({
      key: "codex",
      name: "Codex",
      run: ["codex"],
    });
    expect(startAgent(known.slice(3))).toBeNull();
  });

  it("asks Claude Code through the plugin's command and others through the copied skill", () => {
    expect(startPrompt("claude", "ACME-12")).toBe(
      "/clocktopus:start-work ACME-12",
    );
    expect(startPrompt("codex", "G-3")).toBe(
      "Use the clocktopus-start-work skill to start work on G-3.",
    );
  });
});

describe("realtime hints", () => {
  it("are the topics the CLI's watcher rewrites, and only those refresh the board", () => {
    expect(BOARD_HINTS).toEqual(BOARD_TOPICS);
    expect(isBoardHint(["/home/dana/.clocktopus/realtime/tasks"])).toBe(true);
    expect(
      isBoardHint([
        "/home/dana/.clocktopus/realtime/lease",
        "/home/dana/.clocktopus/realtime/status",
      ]),
    ).toBe(false);
  });

  it("polls every 30 s, and every 5 min while the watcher is connected", () => {
    expect(pollEvery(JSON.stringify({ state: "connected" }))).toBe(300_000);
    expect(pollEvery(JSON.stringify({ state: "offline" }))).toBe(30_000);
    expect(pollEvery(null)).toBe(30_000);
    expect(pollEvery("not json")).toBe(30_000);
  });
});

describe("ago", () => {
  it("says how long ago in the largest whole unit", () => {
    const now = Date.parse("2026-11-06T10:00:00Z");
    expect(ago("2026-11-06T09:59:30Z", now)).toBe("now");
    expect(ago("2026-11-06T09:45:00Z", now)).toBe("15m");
    expect(ago("2026-11-06T05:00:00Z", now)).toBe("5h");
    expect(ago("2026-11-03T10:00:00Z", now)).toBe("3d");
  });
});

describe("environmentBanner", () => {
  const environment = {
    name: "prod",
    apiUrl: "https://clocktopus.app",
    isProduction: true,
    cli: {
      version: "0.13.0",
      installMethod: "mise",
      isCheckout: false,
      path: null,
    },
  };

  it("shows nothing for a production release, or a CLI that names no environment", () => {
    expect(environmentBanner(environment)).toBeNull();
    expect(environmentBanner(undefined)).toBeNull();
  });

  it("names the environment off production", () => {
    expect(
      environmentBanner({
        ...environment,
        name: "localhost:3018",
        apiUrl: "http://localhost:3018",
        isProduction: false,
      }),
    ).toEqual({ title: "LOCALHOST:3018 · localhost:3018", detail: null });
  });

  it("names a CLI built from a checkout", () => {
    expect(
      environmentBanner({
        ...environment,
        cli: {
          version: "0.13.0",
          installMethod: "checkout",
          isCheckout: true,
          path: "~/src/clocktopus/apps/cli",
        },
      }),
    ).toEqual({
      title: "Production · clocktopus.app",
      detail: "CLI 0.13.0 · checkout ~/src/clocktopus/apps/cli",
    });
  });
});
