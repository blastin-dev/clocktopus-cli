import type { z } from "zod";
import { stripRemoteCredentials } from "@repo/cli-contract/remote-url";
import {
  SessionPanelSchema,
  TaskStageSchema,
} from "@repo/cli-contract/session-panel";
import { describe, expect, it } from "vitest";

import {
  checkoutOf,
  cliRows,
  colorOf,
  duration,
  isRefreshingCall,
  messageOf,
  sessionRows,
  spendOf,
  sshHostOf,
  STAGE_COLOR,
  STAGE_LABEL,
  stageOf,
  statusLine,
  versionIn,
  viewOf,
  withoutCredentials,
  withSshConfig,
} from "../../claude-plugin/hooks/panel.js";
import { resolveSshHostAlias } from "./ssh-host-alias.js";

const SESSION = {
  sessionId: "0f3c9a6e-1b2d-4c5e-8f90-123456789abc",
  branch: "dana/acme-42-export-invoices",
  checkout: { path: "~/work/acme-portal", isWorktree: false },
};

const PANEL = {
  status: "ok",
  taskKey: "ACME-42",
  task: {
    key: "ACME-42",
    title: "Export invoices as CSV",
    stage: "in_progress",
    hours: 1.5,
    agentHours: 0.25,
    pageUrl: "https://clocktopus.example/acme/tasks/ACME-42",
  },
  goal: {
    ref: "G-2",
    title: "Invoices go out without a spreadsheet",
    doneCount: 1,
    open: [
      { key: "ACME-41", title: "Address", stage: "in_review", claimed: true },
      { title: "a row without a key" },
      { key: "ACME-42", stage: 7 },
    ],
  },
  attribution: {
    known: true,
    countsTowardTask: true,
    currentKey: null,
    branchKey: "ACME-42",
    sessionCostUsd: 3.5,
    lastActivityAt: "2026-10-26T09:05:00.000Z",
    tasks: [{ key: "ACME-42", costUsd: 3.5 }, { costUsd: 1 }],
  },
};

function shown(overrides: { attribution?: object; task?: object } = {}) {
  const view = viewOf(
    {
      ...PANEL,
      task: { ...PANEL.task, ...overrides.task },
      attribution: { ...PANEL.attribution, ...overrides.attribution },
    },
    SESSION,
  );
  return { ...view, error: null, updatedAt: 0 };
}

describe("viewOf", () => {
  it("reads the task, its goal and the session's attribution", () => {
    const view = viewOf(PANEL, SESSION);

    expect(view).toEqual({
      isShown: true,
      task: PANEL.task,
      goal: {
        ref: "G-2",
        title: "Invoices go out without a spreadsheet",
        doneCount: 1,
        open: [
          {
            key: "ACME-41",
            title: "Address",
            stage: "in_review",
            claimed: true,
          },
          { key: "ACME-42", title: null, stage: "created", claimed: false },
        ],
      },
      attribution: {
        ...SESSION,
        isKnown: true,
        countsTowardTask: true,
        currentKey: null,
        branchKey: "ACME-42",
        sessionCostUsd: 3.5,
        lastActivityAt: "2026-10-26T09:05:00.000Z",
        shares: [{ key: "ACME-42", costUsd: 3.5 }],
      },
      cli: null,
      note: null,
    });
  });

  it("reads where the CLI stands, as the version the hooks run", () => {
    const view = viewOf(
      {
        ...PANEL,
        cli: {
          version: "0.10.0",
          latest: "0.10.0",
          minimum: "0.0.0",
          isBehind: false,
          isUnsupported: false,
        },
      },
      SESSION,
      { installed: "0.10.0", plugin: "0.9.0" },
    );

    expect(view.cli).toEqual({
      version: "0.10.0",
      plugin: "0.9.0",
      latest: "0.10.0",
      minimum: "0.0.0",
      isBehind: false,
      isUnsupported: false,
    });
  });

  it("reads the CLI's status even where no task shows", () => {
    expect(
      viewOf({ status: "no_project", cli: { isUnsupported: true } }, SESSION, {
        installed: null,
        plugin: "0.7.0",
      }).cli,
    ).toMatchObject({ version: "0.7.0", isUnsupported: true });
  });

  it("hides the panel in a repository Clocktopus links to no project", () => {
    expect(viewOf({ status: "no_project" }, SESSION)).toMatchObject({
      isShown: false,
      note: "this repository is linked to no Clocktopus project",
    });
    expect(viewOf({ status: "unsupported_repository" }, SESSION).isShown).toBe(
      false,
    );
  });

  it("shows why when several organisations link the repository", () => {
    expect(viewOf({ status: "choose_organization" }, SESSION)).toMatchObject({
      isShown: true,
      task: null,
      note: "several organisations link this repository",
    });
  });

  it("names the missing task, the branch naming none, or a detached HEAD", () => {
    expect(viewOf({ status: "ok", taskKey: "ACME-9" }, SESSION).note).toBe(
      "Clocktopus has no task ACME-9",
    );
    expect(viewOf({ status: "ok" }, SESSION).note).toBe(
      "branch dana/acme-42-export-invoices names no task",
    );
    expect(viewOf({ status: "ok" }, { ...SESSION, branch: null }).note).toBe(
      "HEAD is detached",
    );
  });

  it("reads an answer without attribution as an unknown session", () => {
    const view = viewOf(
      { ...PANEL, attribution: undefined, goal: null },
      SESSION,
    );

    expect(view.goal).toBeNull();
    expect(view.attribution).toMatchObject({
      isKnown: false,
      countsTowardTask: false,
      sessionCostUsd: null,
      shares: [],
    });
  });

  it("reads a whole answer as the server's contract describes it", () => {
    const answer = {
      status: "ok",
      project: {
        id: "project-1",
        name: "Acme Portal",
        organizationId: "org-1",
        organizationSlug: "acme",
      },
      taskKey: "ACME-42",
      task: { ...PANEL.task, stage: "in_progress" },
      branchTask: null,
      attribution: {
        ...PANEL.attribution,
        agent: "claude_code",
        sessionId: SESSION.sessionId,
        tasks: [{ key: "ACME-42", share: 1, costUsd: 3.5 }],
        startedAt: "2026-10-26T09:00:00.000Z",
        closedAt: null,
      },
      goal: {
        id: "goal-1",
        ref: "G-2",
        title: "Invoices go out without a spreadsheet",
        doneCount: 1,
        open: [
          { key: "ACME-42", title: null, stage: "in_progress", claimed: true },
          { key: "ACME-43", title: null, stage: null, claimed: false },
        ],
      },
    } satisfies z.input<typeof SessionPanelSchema>;

    const view = viewOf(SessionPanelSchema.parse(answer), SESSION);

    expect(view.task).toEqual(PANEL.task);
    expect(view.goal?.open.map((row) => row.stage)).toEqual([
      "in_progress",
      "created",
    ]);
    expect(view.attribution).toMatchObject({
      isKnown: true,
      shares: [{ key: "ACME-42", costUsd: 3.5 }],
    });
  });
});

describe("statusLine", () => {
  it("names the task, its stage, the goal's progress and the attribution", () => {
    expect(statusLine(shown())).toBe(
      "ACME-42 · in progress · G-2 1/3 · attributed",
    );
  });

  it("names the branch's task when the session is tied to another", () => {
    expect(
      statusLine(
        shown({
          attribution: { countsTowardTask: false, branchKey: "ACME-9" },
        }),
      ),
    ).toBe("ACME-42 · in progress · G-2 1/3 · not attributed · branch ACME-9");
  });

  it("marks a line whose last refresh failed", () => {
    expect(statusLine({ ...shown(), error: "boom" })).toBe(
      "ACME-42 · in progress · G-2 1/3 · attributed · not refreshed",
    );
  });

  it("says why no task shows, and nothing where the panel is hidden", () => {
    const empty = { error: null, updatedAt: 0 };
    expect(statusLine({ ...viewOf({ status: "ok" }, SESSION), ...empty })).toBe(
      "Clocktopus: branch dana/acme-42-export-invoices names no task",
    );
    expect(
      statusLine({ ...viewOf({ status: "no_project" }, SESSION), ...empty }),
    ).toBeUndefined();
    expect(statusLine(null)).toBeUndefined();
  });

  it("asks for an upgrade the server requires, even where the panel is hidden", () => {
    const unsupported = {
      version: "0.7.0",
      plugin: null,
      latest: "0.10.0",
      minimum: "0.8.0",
      isBehind: true,
      isUnsupported: true,
    };
    expect(statusLine({ ...shown(), cli: unsupported })).toBe(
      "ACME-42 · in progress · G-2 1/3 · attributed · CLI upgrade required",
    );
    expect(
      statusLine({
        ...viewOf({ status: "no_project" }, SESSION),
        cli: unsupported,
        error: null,
        updatedAt: 0,
      }),
    ).toBe("Clocktopus: CLI upgrade required");
  });

  it("leaves a CLI that is only behind to the pane", () => {
    expect(
      statusLine({
        ...shown(),
        cli: {
          version: "0.9.0",
          plugin: null,
          latest: "0.10.0",
          minimum: "0.0.0",
          isBehind: true,
          isUnsupported: false,
        },
      }),
    ).toBe("ACME-42 · in progress · G-2 1/3 · attributed");
  });
});

describe("versionIn", () => {
  it.each([
    ["0.9.0\n", "0.9.0"],
    ["clocktopus 0.10.0-rc.1", "0.10.0-rc.1"],
    ["0.0.0", null],
    ["command not found", null],
  ])("reads %j as %s", (output, version) => {
    expect(versionIn(output)).toBe(version);
  });
});

describe("cliRows", () => {
  const cli = {
    version: "0.9.0",
    plugin: "0.9.0",
    latest: "0.10.0",
    minimum: "0.0.0",
    isBehind: true,
    isUnsupported: false,
  };

  it("names the newer version and the command to upgrade with", () => {
    expect(cliRows(cli)).toEqual([
      { label: "Version", value: "0.9.0" },
      { label: "Status", value: "0.10.0 available", color: "warning" },
      { label: "Upgrade", value: "clocktopus upgrade" },
    ]);
  });

  it("says the latest is running", () => {
    expect(
      cliRows({ ...cli, version: "0.10.0", plugin: null, isBehind: false }),
    ).toEqual([
      { label: "Version", value: "0.10.0" },
      { label: "Status", value: "✓ Latest", color: "success" },
    ]);
  });

  it("says nothing of the latest while the server doesn't know it", () => {
    expect(
      cliRows({ ...cli, latest: null, isBehind: false }).map(
        (row) => row.label,
      ),
    ).toEqual(["Version"]);
  });
});

describe("spendOf", () => {
  const attribution = shown().attribution!;

  it("shows the session's spend alone when it all went on one task", () => {
    expect(spendOf(attribution)).toBe("$3.50");
  });

  it("splits the session's spend across its tasks", () => {
    expect(
      spendOf({
        ...attribution,
        sessionCostUsd: 5,
        shares: [
          { key: "ACME-42", costUsd: 3.5 },
          { key: "ACME-9", costUsd: 1.5 },
          { key: "ACME-7", costUsd: null },
        ],
      }),
    ).toBe("$5.00 in all · $3.50 on ACME-42 · $1.50 on ACME-9");
  });

  it("says none yet before the session reports any", () => {
    expect(spendOf({ ...attribution, sessionCostUsd: null })).toBe("none yet");
    expect(spendOf({ ...attribution, sessionCostUsd: 0 })).toBe("none yet");
  });
});

describe("sessionRows", () => {
  const { attribution, task } = shown();
  const status = (overrides: object) =>
    sessionRows({ ...attribution!, ...overrides }, task!).find(
      (row) => row.label === "Status",
    );

  it("lists the session, its status, branch, worktree, spend and last report", () => {
    expect(
      sessionRows(attribution!, task!).map((row) => [row.label, row.value]),
    ).toEqual([
      ["Session", "0f3c9a6e…"],
      ["Status", "✓ Counts toward ACME-42 by its branch"],
      ["Branch", "dana/acme-42-export-invoices"],
      ["Worktree", "~/work/acme-portal (main checkout)"],
      ["Spend", "$3.50"],
      ["Reported", expect.stringMatching(/^\d\d:\d\d$/)],
    ]);
  });

  it("says why a session isn't attributed, or which task links it", () => {
    expect(status({ isKnown: false })).toEqual({
      label: "Status",
      value: "✗ Not attributed: Clocktopus hasn't seen this session",
      color: "warning",
    });
    expect(status({ countsTowardTask: false })?.value).toBe(
      "✗ Not attributed: ACME-42 doesn't list it",
    );
    expect(status({ currentKey: "ACME-42" })).toEqual({
      label: "Status",
      value: "✓ Linked to ACME-42",
      color: "success",
    });
  });

  it("marks a branch naming no task, a detached HEAD and a linked worktree", () => {
    const rows = sessionRows(
      {
        ...attribution!,
        isKnown: false,
        branch: null,
        checkout: { path: "/srv/acme-portal-wt", isWorktree: true },
        lastActivityAt: null,
      },
      task!,
    );
    expect(rows.map((row) => [row.label, row.value]).slice(2)).toEqual([
      ["Branch", "detached HEAD"],
      ["Worktree", "/srv/acme-portal-wt"],
    ]);
    expect(
      sessionRows({ ...attribution!, branchKey: null }, task!)[2]?.value,
    ).toBe("dana/acme-42-export-invoices (no task)");
  });
});

describe("stages and amounts", () => {
  it("labels and colours a stage as the web app does", () => {
    expect(stageOf("merged")).toBe("ready to ship");
    expect(stageOf("done")).toBe("delivered");
    expect(colorOf("in_review")).toBe("#10b981");
    expect(colorOf("created")).toBe("inactive");
  });

  it("labels and colours every stage the server answers with", () => {
    expect(Object.keys(STAGE_LABEL).sort()).toEqual(
      [...TaskStageSchema.options].sort(),
    );
    expect(Object.keys(STAGE_COLOR).sort()).toEqual(
      [...TaskStageSchema.options].sort(),
    );
  });

  it("keeps a stage it doesn't know as it came, in the muted colour", () => {
    expect(stageOf("parked")).toBe("parked");
    expect(colorOf("parked")).toBe("inactive");
  });

  it("shows under an hour in minutes and longer in tenths of an hour", () => {
    expect(duration(0.25)).toBe("15m");
    expect(duration(0)).toBe("0m");
    expect(duration(1.5)).toBe("1.5h");
  });

  it("keeps an error's first line, cut to 160 characters", () => {
    expect(messageOf(new Error("first\nsecond"))).toBe("first");
    expect(messageOf("x".repeat(200))).toHaveLength(160);
  });
});

// Remotes a hooks module reads from git, with the hosts `ssh -G` resolves them to.
const SSH_CONFIG: Record<string, string> = {
  "github-work": "user git\nhostname github.com\nport 22\n",
  "bb-work": "user git\nhostname bitbucket.org\nport 22\n",
  "plain-alias": "user deploy\nhostname github.com\n",
};
const configOf = (host: string) => SSH_CONFIG[host] ?? `hostname ${host}\n`;
const REMOTES = [
  "git@github-work:acme-co/acme-portal.git",
  "ssh://git@bb-work/acme-co/acme-portal.git",
  "ssh://git@github-work:22/acme-co/acme-portal.git",
  "ssh://git@github-work:2222/acme-co/acme-portal.git",
  "plain-alias:acme-co/acme-portal.git",
  "git@github.com:acme-co/acme-portal.git",
  "https://github.com/acme-co/acme-portal.git",
  "https://dana:token@github.com/acme-co/acme-portal.git",
  "ssh://git:secret@github-work/acme-co/acme-portal.git",
  "git:secret@github-work:acme-co/acme-portal.git",
  "-oProxyCommand=evil:acme-co/acme-portal.git",
  "/srv/git/acme-portal.git",
  "file:///srv/git/acme-portal.git",
];

describe("remotes", () => {
  it("drops credentials as the CLI does", () => {
    for (const remote of REMOTES) {
      expect(withoutCredentials(remote), remote).toBe(
        stripRemoteCredentials(remote),
      );
    }
  });

  it("resolves SSH host aliases as the CLI does", () => {
    for (const remote of REMOTES) {
      const host = sshHostOf(remote);
      expect(
        host ? withSshConfig(remote, configOf(host)) : remote,
        remote,
      ).toBe(resolveSshHostAlias(remote, configOf));
    }
  });

  it("keeps an ssh:// remote's port out of the repository path", () => {
    expect(
      withSshConfig(
        "ssh://git@github-work:2222/acme-co/acme-portal.git",
        configOf("github-work"),
      ),
    ).toBe("ssh://git@github.com:2222/acme-co/acme-portal.git");
  });

  it("asks ssh about aliases only, never about a known host or an option", () => {
    expect(sshHostOf("git@github-work:acme-co/acme-portal.git")).toBe(
      "github-work",
    );
    expect(sshHostOf("git@Bitbucket.org:acme-co/acme-portal.git")).toBeNull();
    expect(sshHostOf("https://github.com/acme-co/acme-portal.git")).toBeNull();
    expect(sshHostOf("-oProxyCommand=evil:acme-co/acme-portal.git")).toBeNull();
  });
});

describe("checkoutOf", () => {
  it("shortens a checkout in the home directory and tells a linked worktree", () => {
    expect(
      checkoutOf(
        "/home/dana/acme-portal-wt\n/home/dana/acme-portal/.git/worktrees/acme-portal-wt\n/home/dana/acme-portal/.git\n",
        "/home/dana",
      ),
    ).toEqual({ path: "~/acme-portal-wt", isWorktree: true });
    expect(
      checkoutOf(
        "/srv/acme-portal\n/srv/acme-portal/.git\n/srv/acme-portal/.git\n",
        "/home/dana",
      ),
    ).toEqual({ path: "/srv/acme-portal", isWorktree: false });
  });

  it("doesn't shorten a sibling of the home directory", () => {
    expect(checkoutOf("/home/danabis/x\n/a\n/a\n", "/home/dana")?.path).toBe(
      "/home/danabis/x",
    );
    expect(checkoutOf("", "/home/dana")).toBeNull();
  });
});

describe("isRefreshingCall", () => {
  it("refreshes after a Clocktopus MCP call, by the plugin or configured by hand", () => {
    expect(
      isRefreshingCall("mcp__plugin_clocktopus_clocktopus__link_session", null),
    ).toBe(true);
    expect(isRefreshingCall("mcp__clocktopus__get_task", null)).toBe(true);
    expect(isRefreshingCall("mcp__linear__get_issue", null)).toBe(false);
  });

  it("refreshes after a branch or worktree change", () => {
    expect(isRefreshingCall("Bash", "git switch -c acme-42-csv")).toBe(true);
    expect(isRefreshingCall("Bash", "git -C ../x worktree add y")).toBe(true);
    expect(isRefreshingCall("Bash", "git status")).toBe(false);
    expect(isRefreshingCall("EnterWorktree", null)).toBe(true);
    expect(isRefreshingCall("Read", "git checkout main")).toBe(false);
  });
});
