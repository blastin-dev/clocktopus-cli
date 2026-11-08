// What the Clocktopus panel decides, with no Herdr imports: reading the CLI's board, matching
// Herdr's live agents to tasks, and the commands that resume a session.

export const STAGES = [
  ["created", "To do"],
  ["in_progress", "In progress"],
  ["in_review", "In review"],
  ["merged", "Ready to ship"],
];

// Agent-session providers Clocktopus records, as people name them.
export const AGENT_NAMES = {
  claude_code: "Claude Code",
  codex_cli: "Codex",
  opencode: "OpenCode",
  gemini_cli: "Gemini",
  cursor: "Cursor",
  copilot: "Copilot",
  windsurf: "Windsurf",
  antigravity: "Antigravity",
};
export const agentName = (agent) => AGENT_NAMES[agent] ?? agent;

// The task key a branch names, as `extractTaskKeyFromBranch`
// (`packages/cli-contract/src/task-key.ts`) reads it; a mod can't import it, so
// `apps/cli/src/lib/herdr-mod.test.ts` holds the two to the same answers.
const BRANCH_SEGMENT_TASK_KEY =
  /^([A-Za-z][A-Za-z0-9]*-\d+)(?:[-_]|\.(?!\d)|$)/;
const BOT_BRANCH = /^(?:dependabot|renovate)\//;

export function branchKeyOf(branch) {
  if (!branch || BOT_BRANCH.test(branch)) return null;
  for (const segment of branch.split("/")) {
    const raw = segment.match(BRANCH_SEGMENT_TASK_KEY)?.[1];
    if (raw) return raw.toUpperCase();
  }
  return null;
}

// `clocktopus tasks --json` prints one JSON object, also when it fails; anything else (an old
// CLI, a crash) is reported with its output.
export function parseBoard(result) {
  const text = (result.stdout ?? "").trim();
  const line = text.split("\n").filter(Boolean).pop() ?? "";
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed.status === "string") return parsed;
  } catch {
    // Falls through to the error below.
  }
  if (result.code === 127 && /clocktopus/.test(result.stderr ?? "")) {
    return { status: "no_cli" };
  }
  if (/unknown command/i.test(result.stderr ?? ""))
    return { status: "old_cli" };
  const message = (result.stderr || text || `exit code ${result.code}`).trim();
  return { status: "error", message: message.split("\n").slice(-3).join("\n") };
}

// The banner over the board, from the `environment` `clocktopus tasks --json` prints beside it
// (`describeEnvironment` in `apps/cli/src/lib/cli-environment.ts`): a title naming the server
// and, for a CLI built from a checkout, a line naming it. Null on a production release, and
// for a CLI that prints no environment.
export function environmentBanner(environment) {
  if (!environment || typeof environment.apiUrl !== "string") return null;
  const cli = environment.cli ?? {};
  if (environment.isProduction === true && cli.isCheckout !== true) return null;
  // QuickJS has no `URL`.
  const host =
    /^[a-z]+:\/\/([^/?#]+)/i.exec(environment.apiUrl)?.[1] ??
    environment.apiUrl;
  return {
    title:
      environment.isProduction === true
        ? `Production · ${host}`
        : `${String(environment.name ?? host).toUpperCase()} · ${host}`,
    detail:
      cli.isCheckout === true
        ? `CLI ${cli.version ?? ""} · checkout ${cli.path ?? ""}`
            .replace(/\s+/g, " ")
            .trim()
        : null,
  };
}

// The files `clocktopus realtime watch` rewrites under `~/.clocktopus/realtime` on a hint that
// can change the board (`BOARD_TOPICS` in `apps/cli/src/lib/realtime-watch.ts`, which
// `herdr-mod.test.ts` holds this to). The folder's other files (`lease`, `status`) change
// without news.
export const BOARD_HINTS = [
  "tasks",
  "pull-requests",
  "agent-sessions",
  "time-entries",
];

/** @param {string[]} paths what `watchFolder` reported */
export const isBoardHint = (paths) =>
  paths.some((path) => BOARD_HINTS.includes(path.split("/").pop() ?? ""));

// How long the panel waits between fetches when no hint comes: 30 s, or 5 min while the
// realtime watcher says it is connected and hints arrive on their own.
export const POLL_MS = 30 * 1000;
export const CONNECTED_POLL_MS = 5 * 60 * 1000;

/** @param {string | null} statusFile the watcher's `status` file, or null */
export function pollEvery(statusFile) {
  try {
    return JSON.parse(statusFile ?? "")?.state === "connected"
      ? CONNECTED_POLL_MS
      : POLL_MS;
  } catch {
    return POLL_MS;
  }
}

// The labels Clocktopus puts on a Herdr terminal (`apps/cli/src/lib/herdr-terminal.ts`): the
// agent hook its session, the Claude plugin also the task the session counts toward now.
const SESSION_LABEL = "clocktopus.session";
const TASK_LABEL = "clocktopus.task";

// One label's value on each terminal that has it, by address.
/**
 * @param {{ address: string, labels?: Record<string, string> | null }[]} terminals
 * @param {string} label
 */
function labelled(terminals, label) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const terminal of terminals) {
    const value = terminal.labels?.[label];
    if (value) values[terminal.address] = value;
  }
  return values;
}

/** @param {{ address: string, labels?: Record<string, string> | null }[]} terminals */
export const labelledSessions = (terminals) =>
  labelled(terminals, SESSION_LABEL);

/** @param {{ address: string, labels?: Record<string, string> | null }[]} terminals */
export const labelledTasks = (terminals) => labelled(terminals, TASK_LABEL);

// A Herdr agent with where its pane is: `agents()` joined to `panes()`, and the agent's own
// session id when the panel found one (`sessionIds`, by terminal address).
/**
 * @param {{ address: string, pane: string, space: string, tab?: string, space_name?: string, tab_name?: string, status: string, app: string | null, program?: { name: string }, focused: boolean }[]} agents
 * @param {{ pane: string, cwd: string | null, branch: string | null }[]} panes
 * @param {Record<string, string>} sessionIds
 * @param {Record<string, string>} [taskLabels] the task each terminal's label names
 */
export function liveAgents(agents, panes, sessionIds, taskLabels = {}) {
  return agents.map((agent) => {
    const pane = panes.find((p) => p.pane === agent.pane);
    const branch = pane?.branch ?? null;
    return {
      address: agent.address,
      pane: agent.pane,
      space: agent.space,
      tab: agent.tab ?? null,
      where: [agent.space_name, agent.tab_name].filter(Boolean).join(" › "),
      spaceName: agent.space_name ?? null,
      tabName: agent.tab_name ?? null,
      status: agent.status,
      app: agent.app,
      name: agent.program?.name ?? agent.app ?? "Agent",
      cwd: pane?.cwd ?? null,
      branch,
      branchKey: branchKeyOf(branch),
      sessionId: sessionIds[agent.address] ?? null,
      labelTask: taskLabels[agent.address] ?? null,
      focused: agent.focused,
    };
  });
}

// The task each live agent works on, and how the panel knows: `label` when its terminal's task
// label names it (set the moment the session ties itself to a task), `session` when the board
// lists the agent's session as working on it now, `branch` when only its pane's branch names it
// (several tabs on one checkout all match that way). An agent counts toward one task at most.
/**
 * @template {{ key: string, sessions: { sessionId: string, current: boolean }[] }} T
 * @param {T[]} tasks
 * @param {ReturnType<typeof liveAgents>} live
 */
export function agentsByTask(tasks, live) {
  /** @type {Map<string, (ReturnType<typeof liveAgents>[number] & { via: "label" | "session" | "branch" })[]>} */
  const byTask = new Map();
  for (const agent of live) {
    const byLabel = agent.labelTask
      ? tasks.find((task) => task.key === agent.labelTask)
      : null;
    const bySession = byLabel
      ? null
      : agent.sessionId
        ? tasks.find((task) =>
            task.sessions.some(
              (s) => s.sessionId === agent.sessionId && s.current,
            ),
          )
        : null;
    const task =
      byLabel ?? bySession ?? tasks.find((t) => t.key === agent.branchKey);
    if (!task) continue;
    /** @type {"label" | "session" | "branch"} */
    const via = byLabel ? "label" : bySession ? "session" : "branch";
    const entry = { ...agent, via };
    byTask.set(task.key, [...(byTask.get(task.key) ?? []), entry]);
  }
  return byTask;
}

// The live agents the window shows: those in its shown tab, and the one an agent block shows.
/**
 * @param {ReturnType<typeof liveAgents>} live
 * @param {{ tab: string, agent?: string | null } | null} view what `focused()` reports
 */
export const inView = (live, view) =>
  new Set(
    view
      ? live
          .filter((a) => a.tab === view.tab || a.address === view.agent)
          .map((a) => a.address)
      : [],
  );

// The tasks a live agent's session worked on before it moved on: the board lists the session on
// them, but the agent counts toward another task now. Each task gets those agents with `now`, the
// task `agentsByTask` puts the agent on (null when it is on none the board lists).
/**
 * @param {{ key: string, sessions: { sessionId: string }[] }[]} tasks
 * @param {ReturnType<typeof agentsByTask>} byTask
 * @param {ReturnType<typeof liveAgents>} live
 */
export function movedOn(tasks, byTask, live) {
  /** @type {Map<string, string>} */
  const now = new Map();
  for (const [key, agents] of byTask)
    for (const agent of agents) now.set(agent.address, key);
  /** @type {Map<string, { agent: ReturnType<typeof liveAgents>[number], now: string | null }[]>} */
  const moved = new Map();
  for (const agent of live) {
    if (!agent.sessionId) continue;
    const current = now.get(agent.address) ?? null;
    for (const task of tasks) {
      if (task.key === current) continue;
      if (!task.sessions.some((s) => s.sessionId === agent.sessionId)) continue;
      moved.set(task.key, [
        ...(moved.get(task.key) ?? []),
        { agent, now: current },
      ]);
    }
  }
  return moved;
}

// The agent a click on the task brings up: the one whose session is the task's, else the only
// one on its branch. Null when that leaves a choice, so the row lists them instead.
/** @param {ReturnType<typeof agentsByTask> extends Map<string, infer V> ? V : never} agents */
export function clickTarget(agents) {
  const bySession = agents.filter((agent) => agent.via !== "branch");
  if (bySession.length === 1) return bySession[0];
  if (bySession.length === 0 && agents.length === 1) return agents[0];
  return null;
}

// The agent a click on the row focuses: `clickTarget`'s, unless it is already in view, where
// focusing it changes nothing on screen and the click opens the row instead.
/**
 * @template {{ address: string }} A
 * @param {A | null | undefined} target
 * @param {Set<string>} shown `inView`
 */
export const focusTarget = (target, shown) =>
  target && !shown.has(target.address) ? target : null;

// The first session the board has working on the task that isn't a Herdr agent the panel shows
// elsewhere: while `away`'s session is still the task's current one, a session of yours working
// on it can be that agent, so yours are skipped then.
/**
 * @template {{ mine: boolean }} W
 * @param {{ working: W[], sessions: { sessionId: string, current: boolean }[] }} task
 * @param {{ agent: { sessionId: string | null } } | null} away the first of `movedOn` for the task
 * @returns {W | null}
 */
export function workingElsewhere(task, away) {
  const lagging =
    Boolean(away?.agent.sessionId) &&
    task.sessions.some(
      (s) => s.sessionId === away?.agent.sessionId && s.current,
    );
  return task.working.find((w) => !(w.mine && lagging)) ?? null;
}

// A tab name the panel gives: a task key or goal ref, or a goal ref then the task its run is on.
const PANEL_TAB_NAME =
  /^(?:([A-Za-z][A-Za-z0-9]*-\d+) · )?([A-Za-z][A-Za-z0-9]*-\d+)$/;

// The name a tab takes when its agent is on task `key`, keeping a goal ref the tab was opened
// for in front. Null leaves the tab as it is: a name the panel doesn't give (a number, one a
// person chose), or the name it already has.
/**
 * @param {string | null} name
 * @param {string} key
 * @param {string[]} goalRefs the board's goals
 */
export function followedTabName(name, key, goalRefs) {
  const match = PANEL_TAB_NAME.exec(name ?? "");
  if (!match) return null;
  const goal = match[1] ?? (goalRefs.includes(match[2]) ? match[2] : null);
  const next = goal && goal !== key ? `${goal} · ${key}` : key;
  return next === name ? null : next;
}

// The tabs to rename, as [tab id, name]: each tab whose agents are on one task by their label or
// their session (`agentsByTask`), and whose name `followedTabName` changes. A tab whose agents are
// on several tasks, or only matched by branch, keeps its name.
/**
 * @param {ReturnType<typeof liveAgents>} live
 * @param {ReturnType<typeof agentsByTask>} byTask
 * @param {string[]} goalRefs
 */
export function tabRenames(live, byTask, goalRefs) {
  /** @type {Map<string, string>} */
  const taskOf = new Map();
  for (const [key, agents] of byTask)
    for (const agent of agents)
      if (agent.via !== "branch") taskOf.set(agent.address, key);
  /** @type {Map<string, { name: string | null, keys: Set<string> }>} */
  const tabs = new Map();
  for (const agent of live) {
    if (!agent.tab) continue;
    const tab = tabs.get(agent.tab) ?? { name: agent.tabName, keys: new Set() };
    const key = taskOf.get(agent.address);
    if (key) tab.keys.add(key);
    tabs.set(agent.tab, tab);
  }
  /** @type {[string, string][]} */
  const renames = [];
  for (const [id, { name, keys }] of tabs) {
    if (keys.size !== 1) continue;
    const next = followedTabName(name, [...keys][0], goalRefs);
    if (next) renames.push([id, next]);
  }
  return renames;
}

// The board as the panel shows it: a To do task an agent has taken up (by its label or its
// session, not merely its branch) shows In progress at once, before the server's stage
// catches up. `moved` counts those, which To do's total no longer holds.
/**
 * @template {{ key: string, stage: string }} T
 * @param {T[]} tasks
 * @param {ReturnType<typeof agentsByTask>} byTask
 */
export function withAgentStages(tasks, byTask) {
  let moved = 0;
  const shown = tasks.map((task) => {
    const taken =
      task.stage === "created" &&
      (byTask.get(task.key) ?? []).some((agent) => agent.via !== "branch");
    if (!taken) return task;
    moved += 1;
    return { ...task, stage: "in_progress" };
  });
  return { tasks: shown, moved };
}

// Most urgent first, as Herdr ranks a space's agents: blocked > done > working > idle.
const URGENCY = { blocked: 0, done: 1, working: 2, idle: 3 };
export const mostUrgent = (agents) =>
  [...agents].sort(
    (a, b) => (URGENCY[a.status] ?? 4) - (URGENCY[b.status] ?? 4),
  )[0] ?? null;

// The agents the panel starts work with, by their key in Herdr's program table
// (`knownAgents()`): those with the start-work skill (`startPrompt`).
const START_AGENTS = ["claude", "codex", "opencode"];

// The start agents installed on the space's machine, in `knownAgents()`'s order (most picked
// first), so the first is the default.
/** @param {{ key: string, name: string, run: string[], installed: boolean, icon?: string | null, tint?: boolean }[]} known */
export const startAgents = (known) =>
  known
    .filter((a) => a.installed && START_AGENTS.includes(a.key))
    .map((a) => ({
      key: a.key,
      name: a.name,
      run: a.run,
      icon: a.icon ?? null,
      tint: Boolean(a.tint),
    }));

// The branch a task's new worktree checks out: its key and the first words of its title,
// lowercase, so Clocktopus attributes the branch's commits to the task.
/** @param {{ key: string, title?: string | null }} task */
export function worktreeBranch(task) {
  const words = (task.title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);
  return [task.key.toLowerCase(), ...words].join("-");
}

// The first message that has the agent start work on `target`, a task key or a goal ref,
// through the start-work skill: the Clocktopus plugin's command in Claude Code, the skill
// `clocktopus agent setup` copies into `~/.agents/skills` for the others.
/** @param {string} agentKey @param {string} target */
export const startPrompt = (agentKey, target) =>
  agentKey === "claude"
    ? `/clocktopus:start-work ${target}`
    : `Use the clocktopus-start-work skill to start work on ${target}.`;

// The command that reopens an agent session in its folder; null for agents that can't.
export function resumeArgv(session) {
  switch (session.agent) {
    case "claude_code":
      return ["claude", "--resume", session.sessionId];
    case "codex_cli":
      return ["codex", "resume", session.sessionId];
    default:
      return null;
  }
}

// The command that opens a copy of a session still running elsewhere as a new session, its
// conversation so far included, leaving the original alone; null for agents that can't.
export function forkArgv(session) {
  return session.agent === "claude_code"
    ? ["claude", "--resume", session.sessionId, "--fork-session"]
    : null;
}

// The Herdr terminal a running process belongs to: the one whose foreground program it is
// (`hc get <t> --json`, `foreground.pid`), on the session's machine. Null outside Herdr.
/**
 * @param {{ address: string, pid: number | null }[]} foregrounds the machine's terminals
 * @param {number | null} pid
 */
export const terminalOf = (foregrounds, pid) =>
  (pid && foregrounds.find((t) => t.pid === pid)?.address) || null;

// A shell script and its arguments that, run on a machine, print one line per session of
// `sessions` found there: `here <id> <folder>` when its transcript is there and its folder
// exists, `running <id> <pid> <folder>` when its agent's process still runs (paths: RECIPE.md,
// Resume). Folders arrive home-relative (`~/…`, as the hook reports them) and leave absolute.
export function localSessionsScript(sessions) {
  const args = [];
  for (const s of sessions) {
    if (!s.cwd || !resumeArgv(s)) continue;
    args.push(s.agent, s.sessionId, s.cwd);
  }
  const script = [
    'claude="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"',
    'codex=""',
    'if [ -d "$HOME/.codex/sessions" ]; then codex=$(find "$HOME/.codex/sessions" -name "rollout-*.jsonl" 2>/dev/null); fi',
    'while [ "$#" -ge 3 ]; do',
    "  agent=$1; id=$2; cwd=$3; shift 3",
    '  case $cwd in "~" | "~/"*) cwd="$HOME${cwd#?}" ;; esac',
    '  [ -d "$cwd" ] || continue',
    "  case $agent in",
    "    claude_code)",
    "      running=",
    '      for f in "$claude"/sessions/*.json; do',
    '        [ -f "$f" ] || continue',
    '        grep -qF "$id" "$f" || continue',
    '        pid=$(basename "$f" .json)',
    '        kill -0 "$pid" 2>/dev/null && running=$pid',
    "      done",
    '      if [ -n "$running" ]; then echo "running $id $running $cwd"',
    '      elif [ -f "$claude/projects/$(printf %s "$cwd" | sed "s/[^A-Za-z0-9]/-/g")/$id.jsonl" ]; then echo "here $id $cwd"; fi ;;',
    '    codex_cli) case $codex in *"$id.jsonl"*) echo "here $id $cwd" ;; esac ;;',
    "  esac",
    "done",
  ].join("\n");
  return { script, args };
}

// `localSessionsScript`'s output, by session id.
/** @param {string} stdout */
export function parseLocalSessions(stdout) {
  /** @type {Map<string, { state: "here" | "running", cwd: string, pid: number | null }>} */
  const found = new Map();
  for (const line of (stdout ?? "").split("\n")) {
    const here = line.match(/^here (\S+) (.+)$/);
    if (here) found.set(here[1], { state: "here", cwd: here[2], pid: null });
    const running = line.match(/^running (\S+) (\d+) (.+)$/);
    if (running)
      found.set(running[1], {
        state: "running",
        cwd: running[3],
        pid: Number(running[2]),
      });
  }
  return found;
}

// Where the task's sessions are on the machines Herdr reaches (`found`: session id to each
// machine's `parseLocalSessions` entry, `machine` null for this computer), and which one a
// click resumes: the newest session working on the task now that is on a machine and not
// running, else the newest such session. Null when none is, or one of them still runs.
/**
 * @param {{ sessions: { agent: string, sessionId: string, current: boolean }[] }} task
 * @param {Map<string, { machine: string | null, state: "here" | "running", cwd: string, pid: number | null }>} found
 * @param {Set<string>} liveIds sessions open in a Herdr terminal now
 */
export function resumeChoice(task, found, liveIds) {
  const candidates = task.sessions.filter(
    (s) => resumeArgv(s) && !liveIds.has(s.sessionId) && found.has(s.sessionId),
  );
  if (candidates.some((s) => found.get(s.sessionId)?.state === "running"))
    return null;
  const session = candidates.find((s) => s.current) ?? candidates[0];
  if (!session) return null;
  const where = found.get(session.sessionId);
  return where ? { session, ...where, argv: resumeArgv(session) } : null;
}

// The folder a space's tasks are read from, as Herdr's spaces sidebar places a space
// (`mods/spaces/main.js`): its first terminal's live folder, else the folder it was made in.
// That folder's repository decides the project, and so the organisation.
/**
 * @param {{ folder: string, tabs: { id: string }[] }} space
 * @param {{ tab: string, cwd: string | null }[]} panes
 */
export function spaceFolder(space, panes) {
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  return (
    panes.find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder
  );
}

// The space a resumed session opens in, as a new tab: one on its machine whose folder
// (`spaceFolder`) is the session's. Null opens a new space there.
/**
 * @param {{ id: string, machine: string | null, folder: string, tabs: { id: string }[] }[]} spaces
 * @param {{ tab: string, cwd: string | null }[]} panes
 * @param {{ machine: string | null, cwd: string }} where
 */
export function resumeSpace(spaces, panes, where) {
  return (
    spaces.find(
      (space) =>
        (space.machine ?? null) === where.machine &&
        spaceFolder(space, panes) === where.cwd,
    ) ?? null
  );
}

// The board's tasks for one stage, narrowed by the filter (words that all appear in the key,
// title or goal) and by the goals picked (`keys`, the union of their tasks; null: no goal picked).
/**
 * @template {{ key: string, title: string | null, stage: string, goal: { ref: string, title: string } | null }} T
 * @param {T[]} tasks
 * @param {string | null} stage
 * @param {string} query
 * @param {Set<string> | null} [keys]
 * @returns {T[]}
 */
export function filterTasks(tasks, stage, query, keys = null) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tasks.filter((task) => {
    if (stage && task.stage !== stage) return false;
    if (keys && !keys.has(task.key)) return false;
    const text =
      `${task.key} ${task.title ?? ""} ${task.goal?.ref ?? ""} ${task.goal?.title ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

// The keys of the goals picked that the board still lists, or null when none is picked.
/**
 * @param {{ ref: string, keys: string[] }[]} goals
 * @param {string[]} picked
 */
export function goalKeys(goals, picked) {
  const chosen = goals.filter((goal) => picked.includes(goal.ref));
  return chosen.length ? new Set(chosen.flatMap((goal) => goal.keys)) : null;
}

// "3m", "5h", "2d": how long ago `iso` was, from `now` (ms).
export function ago(iso, now) {
  if (!iso) return "";
  const ms = Math.max(0, now - Date.parse(iso));
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// The last folder of a path, `~` at home.
export function folderName(path, home) {
  if (!path) return "";
  if (home && path.replace(/\/+$/, "") === home.replace(/\/+$/, "")) return "~";
  return path.split("/").filter(Boolean).pop() ?? path;
}
