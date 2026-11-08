// Clocktopus beside your agents: the shown space's project tasks by stage, which ones a Herdr
// agent is working on, and a way back into each task's agent sessions.
// Roles (props.role): the panel (default); "toggle", the tab-bar button that shows or hides
// the layout's "clocktopus-panel" node; "start", the popup that starts work on a task or its goal.
import { h_flex, Input, InputState, v_flex } from "gpui-base";
import { div, image, svg, View } from "gpui-kit";
import {
  agents,
  props as blockProps,
  closeOverlay,
  exec,
  focused,
  hc,
  home,
  knownAgents,
  layout,
  machines,
  nextCommand,
  openOverlay,
  panes,
  readTextFile,
  run,
  setShared,
  settings,
  shared,
  spaces,
  terminals,
  theme,
  watchFolder,
} from "herdr";

import {
  agentName,
  agentsByTask,
  ago,
  clickTarget,
  environmentBanner,
  filterTasks,
  focusTarget,
  folderName,
  forkArgv,
  goalKeys,
  inView,
  isBoardHint,
  labelledSessions,
  labelledTasks,
  liveAgents,
  localSessionsScript,
  mostUrgent,
  movedOn,
  parseBoard,
  parseLocalSessions,
  POLL_MS,
  pollEvery,
  resumeArgv,
  resumeChoice,
  resumeSpace,
  spaceFolder,
  STAGES,
  startAgents,
  startPrompt,
  worktreeBranch,
  tabRenames,
  terminalOf,
  withAgentStages,
  workingElsewhere,
} from "./model.js";

const PANEL = "clocktopus-panel"; // the layout node the toggle shows and hides; its hidden state is the layout's, so it survives space switches
const TODO_SHOWN = 30; // To do rows before "Show n more"; the CLI is asked for more so the filter reaches them
const TODO_LOADED = 200;
// Where the CLI is usually installed, for a desktop app started without the login shell's PATH.
const PATHS =
  'PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.local/share/pnpm:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH';
const STAGE_ORDER = ["merged", "in_review", "in_progress", "created"];
const MARK = "mods/clocktopus/mark.png";
// Where `clocktopus realtime watch` keeps its files on this computer.
const realtimeDir = () => `${home()}/.clocktopus/realtime`;

// The organisation chosen for a space folder whose repository several organisations link,
// by `<machine>|<folder>`.
const ORGS = "clocktopus.orgs.v1";
// The goals picked as filters, by `<machine>|<folder>`: goal refs.
const GOALS = "clocktopus.goals.v1";

// Work started from render: cx.notify() throws while a view renders, so it starts after.
const later = (cx, fn) =>
  cx.spawn(async (cx) => {
    await cx.sleep(0);
    return fn(cx);
  });
const stop = (_e, cx) => cx.stop_propagation();
const sh = (script, args, opts) =>
  exec(
    "sh",
    ["-c", `${PATHS}\n${script}`, "clocktopus-panel", ...args],
    opts,
  ).catch((e) => ({
    // exec rejects when the folder is gone or the machine can't be reached.
    code: null,
    stdout: "",
    stderr: String(e?.message ?? e),
  }));

function S() {
  const b = Number(settings().ui_font_size) || 13;
  return { title: b + 1, body: b + 0.5, secondary: b - 0.5, label: b - 1 };
}
const mono = () => settings().font_family || "Menlo";

const icon = (name, size, color) =>
  svg(`mods/clocktopus/icons/${name}.svg`)
    .size(size)
    .flex_none()
    .text_color(color);
const dot = (color, size = 8, hollow = false) =>
  hollow
    ? div()
        .w(size)
        .h(size)
        .flex_none()
        .rounded_full()
        .border(1.5)
        .border_color(color)
    : div().w(size).h(size).flex_none().rounded_full().bg(color);
const pill = (text, t) =>
  h_flex()
    .h(20)
    .px(8)
    .flex_none()
    .items_center()
    .rounded(10)
    .bg(t.selected)
    .text_size(S().label)
    .text_color(t.muted)
    .child(text);
const note = (t, text, color) =>
  div()
    .text_size(S().secondary)
    .text_color(color ?? t.muted)
    .child(text);

function button(id, label, t, onClick, opts = {}) {
  const solid = opts.primary;
  return h_flex()
    .id(id)
    .h(opts.h ?? (opts.small ? 22 : 26))
    .px(opts.px ?? (opts.small ? 8 : 10))
    .gap(6)
    .flex_none()
    .items_center()
    .rounded(6)
    .when(solid, (el) => el.bg(t.solid).font_semibold())
    .when(!solid && !opts.quiet, (el) => el.border_1().border_color(t.border))
    .text_size(S().label)
    .text_color(solid ? t.solid_foreground : (opts.color ?? t.foreground))
    .cursor_pointer()
    .hover((s) => (solid ? s.opacity(0.88) : s.bg(t.hover)))
    .on_mouse_down("left", stop)
    .on_click((e, cx) => {
      cx.stop_propagation();
      onClick(e, cx);
    })
    .when(Boolean(opts.tip), (el) => el.tooltip(opts.tip))
    .when(Boolean(opts.icon), (el) =>
      el.child(
        icon(
          opts.icon,
          12,
          solid ? t.solid_foreground : (opts.color ?? t.foreground),
        ),
      ),
    )
    .child(label);
}

function iconButton(id, name, tip, t, onClick) {
  return h_flex()
    .id(id)
    .size(24)
    .flex_none()
    .justify_center()
    .items_center()
    .rounded(6)
    .cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .tooltip(tip)
    .on_mouse_down("left", stop)
    .on_click((e, cx) => {
      cx.stop_propagation();
      onClick(e, cx);
    })
    .child(icon(name, 14, t.muted));
}

// Agents at work, in the theme's yellow: Herdr's `working` is the theme's own and often blue.
const cooking = (t) => t.ansi3 || t.working;
// The spinning ring at 10px draws an 8px circle, the size of `dot`.
const spinner = (color) => icon("ring", 10, color).spin(900);

// One line of an open row's list of agents and sessions: a marker, the agent, its state, and
// then the space › tab it is in, or an action. With `onClick` the whole line is the click.
function listRow(
  t,
  {
    id,
    first,
    marker,
    name,
    status,
    statusColor,
    tag,
    tip,
    onClick,
    action,
    shown,
  },
) {
  const go = Boolean(onClick);
  return h_flex()
    .when(Boolean(id), (el) => el.id(id))
    .h(34)
    .pl(10)
    .pr(8)
    .gap(9)
    .items_center()
    .when(Boolean(shown), (el) =>
      el.rounded(7).border_1().border_color(t.accent),
    )
    .when(!first && !shown, (el) => el.border_t_1().border_color(t.border))
    .when(go, (el) =>
      el
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          cx.stop_propagation();
          onClick();
        }),
    )
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .child(h_flex().w(10).flex_none().justify_center().child(marker))
    .child(div().flex_none().text_size(S().secondary).font_medium().child(name))
    .child(
      div()
        .flex_1()
        .min_w(0)
        .truncate()
        .text_size(S().secondary)
        .text_color(statusColor ?? t.muted)
        .child(status),
    )
    .when(Boolean(tag), (el) =>
      el.child(
        h_flex()
          .flex_none()
          .max_w(150)
          .px(5)
          .gap(4)
          .items_center()
          .rounded(4)
          .border_1()
          .border_color(t.border)
          .font_family(mono())
          .text_size(S().label)
          .when(Boolean(tag.space), (row) =>
            row.child(
              div()
                .min_w(0)
                .truncate()
                .text_color(t.muted)
                .child(`${tag.space} ›`),
            ),
          )
          .child(div().flex_none().child(tag.tab)),
      ),
    )
    .when(go, (el) => el.child(icon("arrow-right", 13, t.muted)))
    .when(Boolean(action), (el) => el.child(action));
}

// " · on <machine>" for a session on another machine; nothing for this computer.
const machineLabel = (machine) => (machine ? ` · on ${machine}` : "");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const f = find(child, id);
    if (f) return f;
  }
  return null;
}

// How a Herdr agent status reads on a row.
function statusLook(status, t) {
  switch (status) {
    case "working":
      return { color: cooking(t), label: "cooking", spin: true };
    case "blocked":
      return { color: t.blocked, label: "needs you" };
    case "done":
      return { color: t.done, label: "finished" };
    default:
      return { color: t.idle, label: "idle" };
  }
}

// A new tab in the space whose agent runs the start-work skill on `target` (a task key or a
// goal ref) as its first message.
function startWork(ctx, agent, target) {
  run("tab.new", {
    space: ctx.space,
    folder: ctx.folder || undefined,
    argv: agent.run,
    task: startPrompt(agent.key, target),
    name: target,
  });
}

// What a To do task can start work on: the task, and its goal when it is in one.
const startTargets = (task, goal) => [
  { id: "task", label: `Start ${task.key}`, target: task.key },
  ...(goal
    ? [
        {
          id: "goal",
          label: `Start goal ${goal.ref}${goal.count ? ` · ${goal.count} open` : ""}`,
          target: goal.ref,
        },
      ]
    : []),
];
const START_POPUP_WIDTH = 260;
const START_ROW = 31;
const START_HEADER = 28;
// Herdr's new-tab menu: 5px padding, the New worktree row and a divider, then each target's
// header and one row per agent, a divider between targets.
const startPopupHeight = (targets, starterCount) =>
  10 +
  targets * (START_HEADER + starterCount * START_ROW) +
  targets * 11 +
  START_ROW;

const agentIcon = (agent, t) =>
  !agent.icon
    ? div().size(14).flex_none()
    : agent.tint
      ? svg(agent.icon).size(14).flex_none().text_color(t.foreground)
      : image(agent.icon).size(14).flex_none();

// The menu the play button opens, drawn like Herdr's new-tab menu: a new worktree for the task,
// then start-work on the task, and on its goal, in each installed agent. Keys 1-9 start the task.
function startPopup(handle) {
  const t = theme();
  const { ctx, starters, task, goal, overlay } = blockProps();
  const start = (agent, target) => {
    closeOverlay(overlay);
    startWork(ctx, agent, target);
  };
  const branch = worktreeBranch(task);
  // Herdr's worktree dialog, given a branch, checks it out in ~/.herdr/worktrees/<repo>/ (a new
  // branch from the space's HEAD) and opens it as a new space with a terminal.
  const newWorktree = () => {
    closeOverlay(overlay);
    openOverlay({
      mod: "worktree",
      kind: "dialog",
      width: 460,
      height: 280,
      props: {
        space: ctx.space,
        folder: ctx.folder || undefined,
        action: "new",
        branch,
      },
    });
  };
  const line = (id, lead, name, hint, onClick) =>
    h_flex()
      .id(id)
      .h(START_ROW)
      .px(9)
      .gap(10)
      .flex_none()
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .hover((s) => s.bg(t.selected))
      .on_click(onClick)
      .child(lead)
      .child(div().flex_1().min_w(0).truncate().child(name))
      .child(
        div()
          .flex_none()
          .text_size(11)
          .text_color(t.dim ?? t.muted)
          .child(hint),
      );
  const row = (id, agent, target, hint) =>
    line(id, agentIcon(agent, t), agent.name, hint, () =>
      start(agent, target),
    );
  const divider = () => div().h(1).mx(4).my(5).bg(t.border);
  const sections = startTargets(task, goal).flatMap(
    ({ id, label, target }, i) => [
      ...(i > 0 ? [divider()] : []),
      div()
        .h(START_HEADER)
        .px(9)
        .pt(8)
        .pb(4)
        .truncate()
        .text_size(11)
        .text_color(t.dim ?? t.muted)
        .child(label),
      ...starters.map((agent, n) =>
        row(
          `start-${id}-${agent.key}`,
          agent,
          target,
          id === "task" && n < 9 ? String(n + 1) : "",
        ),
      ),
    ],
  );
  return v_flex()
    .id("clocktopus-start")
    .size_full()
    .p(5)
    .bg(t.popover)
    .text_color(t.foreground)
    .text_size(12.8)
    .track_focus(handle)
    .on_key_down((e) => {
      if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt)
        return;
      const agent = /^[1-9]$/.test(e.key) ? starters[Number(e.key) - 1] : null;
      if (agent) start(agent, task.key);
    })
    .child(
      line(
        "start-worktree",
        icon("branch", 14, t.foreground),
        "New worktree",
        branch,
        newWorktree,
      ).tooltip(`Check out ${branch} in a new worktree and open a terminal there`),
    )
    .child(divider())
    .children(sections);
}

function toggle() {
  const t = theme(),
    node = find(layout(), PANEL),
    on = node && !node.hidden;
  return h_flex()
    .size_full()
    .pr(10)
    .items_center()
    .bg(t.chrome)
    .border_b(1)
    .border_color(t.border)
    .child(
      h_flex()
        .id("toggle-clocktopus")
        .h(26)
        .px(8)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .bg(on ? t.selected : t.chrome)
        .text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => run("layout.toggle", { id: PANEL }))
        .child(image(MARK).w(16).h(16).rounded(4).flex_none())
        .child("Clocktopus"),
    );
}

export default class Clocktopus extends View {
  init(_props, cx) {
    this.role = blockProps()?.role ?? "panel";
    if (this.role === "toggle") return;
    if (this.role === "start") {
      this.handle = cx.focus_handle();
      this.handle.focus();
      return;
    }
    this.handle = cx.focus_handle();
    this.ctx = null;
    this.ctxKey = null;
    this.token = 0;
    this.board = null;
    this.loading = false;
    // A refresh asked for while one ran, so a hint arriving mid-fetch isn't lost.
    this.refreshDue = false;
    this.loadedAt = 0;
    // Session id to where it is: `{ machine, state: "here" | "running", cwd }`.
    this.found = new Map();
    // Sessions a click just resumed, so a second click focuses rather than resuming again.
    this.resumed = new Set();
    // Running session id to the Herdr terminal its process is in, when it is in one.
    this.hosts = new Map();
    // The agents To do tasks can start with on the space's machine (`startAgents`), default first.
    this.starters = [];
    this.sessionIds = {};
    // What each place showed last, by `<machine>|<folder>`, so switching back shows it at once.
    this.cache = new Map();
    this.open = null;
    // The name each tab was last renamed to, so a rename is asked for once.
    this.renamed = new Map();
    // Ready to ship starts collapsed: its tasks are there to go back to, not to work through.
    this.collapsed = new Set(["merged"]);
    this.query = "";
    this.allTodo = false;
    this.filter = InputState.new({
      placeholder: "Filter by key, title or goal",
    });
    this.filter.on("change", (_e, cx) => {
      this.query = this.filter.value();
      cx.notify();
    });
    // Nothing is fetched while the panel is hidden; showing it again refreshes (see render).
    // A board fetch is due every `pollEvery` (slower while the realtime watcher is
    // connected), and at once when the watcher rewrites a board topic's file.
    this.pollMs = POLL_MS;
    cx.timer.every(POLL_MS, (cx) => {
      if (this.hidden()) return;
      if (Date.now() - this.loadedAt >= this.pollMs - 1000) this.refresh(cx);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        let paths;
        try {
          paths = await watchFolder(realtimeDir());
        } catch {
          // No folder yet (no watcher has run): try again after the next fetch starts one.
          await cx.sleep(POLL_MS);
          continue;
        }
        if (isBoardHint(paths) && !this.hidden()) this.refresh(cx);
      }
    });
    cx.timer.every(60000, (cx) => cx.notify()); // the "3m ago" labels
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "focus") this.handle.focus();
        cx.notify();
      }
    });
  }

  hidden() {
    return Boolean(find(layout(), PANEL)?.hidden);
  }

  // The shown space's machine and folder (`spaceFolder`).
  context() {
    const space = spaces().find((s) => s.active);
    if (!space) return null;
    const on = space.machine ?? null;
    const folder = spaceFolder(space, panes());
    return { on, folder, space: space.id, key: `${on ?? ""}|${folder}` };
  }

  chosenOrg(ctx) {
    return shared(ORGS)?.[ctx.key] ?? null;
  }

  pickedGoals(ctx) {
    return shared(GOALS)?.[ctx.key] ?? [];
  }

  toggleGoal(ctx, ref) {
    const picked = this.pickedGoals(ctx);
    const next = picked.includes(ref)
      ? picked.filter((r) => r !== ref)
      : [...picked, ref];
    setShared(GOALS, { ...(shared(GOALS) ?? {}), [ctx.key]: next });
  }

  chooseOrg(ctx, organizationId) {
    const orgs = { ...(shared(ORGS) ?? {}) };
    if (organizationId) orgs[ctx.key] = organizationId;
    else delete orgs[ctx.key];
    setShared(ORGS, orgs);
  }

  refresh(cx) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.loading) {
      this.refreshDue = true;
      return;
    }
    this.loading = true;
    const token = this.token;
    cx.spawn(async (cx) => {
      try {
        const args = [
          "--limit",
          String(TODO_LOADED),
          ...(this.chosenOrg(ctx) ? ["--org", this.chosenOrg(ctx)] : []),
        ];
        // This computer's watcher serves every space: hints are per user and
        // organisation, not per machine.
        void sh("exec clocktopus realtime watch --detach", [], {
          timeout: 10000,
        });
        const status = await readTextFile(`${realtimeDir()}/status`).catch(
          () => null,
        );
        this.pollMs = pollEvery(status);
        const result = await sh('exec clocktopus tasks --json "$@"', args, {
          cwd: ctx.folder || undefined,
          on: ctx.on,
          timeout: 30000,
        });
        if (token !== this.token) return;
        this.board = parseBoard(result);
        this.loadedAt = Date.now();
        cx.notify();
        await this.findSessionIds();
        if (this.board.status === "ok") {
          const found = await this.findSessions(
            this.board.tasks.flatMap((task) => task.sessions),
            ctx.on,
          );
          if (token !== this.token) return;
          this.found = found;
          this.resumed = new Set();
          this.hosts = await this.findHosts(found);
          const known = await knownAgents({ on: ctx.on }).catch(() => []);
          if (token !== this.token) return;
          this.starters = startAgents(known);
        }
        this.cache.set(ctx.key, {
          starters: this.starters,
          board: this.board,
          found: this.found,
          loadedAt: this.loadedAt,
        });
      } finally {
        if (token === this.token) {
          this.loading = false;
          if (this.refreshDue) {
            this.refreshDue = false;
            this.refresh(cx);
          }
        }
        cx.notify();
      }
    });
  }

  // Each agent's session id: the label the Clocktopus hook puts on its terminal, on any
  // machine. A local Claude Code terminal without one is read through its foreground pid and
  // `~/.claude/sessions/<pid>.json`; the rest match by branch.
  async findSessionIds() {
    const next = labelledSessions(terminals());
    const claude = agents().filter(
      (a) =>
        a.app === "claude-code" && !a.address.includes("/") && !next[a.address],
    );
    await Promise.all(
      claude.map(async (agent) => {
        try {
          const got = await hc(["get", agent.address, "--json"]);
          const pid = JSON.parse(got.stdout)?.foreground?.pid;
          if (!pid) return;
          const file = await readTextFile(
            `${home()}/.claude/sessions/${pid}.json`,
          );
          const id = file ? JSON.parse(file)?.sessionId : null;
          if (id) next[agent.address] = id;
        } catch {
          // A terminal that ended or a session file mid-write: matched by branch until the next refresh.
        }
      }),
    );
    this.sessionIds = next;
  }

  // Where each of `sessions` is, asked of every machine Herdr reaches at once; a session on
  // several (a shared folder) counts on the space's machine first, then this computer.
  async findSessions(sessions, spaceMachine) {
    const { script, args } = localSessionsScript(sessions);
    const found = new Map();
    if (!args.length) return found;
    const names = [
      spaceMachine,
      null,
      ...machines()
        .filter((m) => m.name && m.layout !== "unavailable")
        .map((m) => m.name),
    ].filter((name, i, all) => all.indexOf(name) === i);
    const answers = await Promise.all(
      names.map((on) => sh(script, args, { on, timeout: 20000 })),
    );
    names.forEach((machine, i) => {
      for (const [id, where] of parseLocalSessions(answers[i].stdout)) {
        if (!found.has(id)) found.set(id, { machine, ...where });
      }
    });
    return found;
  }

  // For each running session, the Herdr terminal whose foreground program it is: an agent
  // that reports no status is in no agent list, but its terminal is still Herdr's.
  async findHosts(found) {
    const hosts = new Map();
    const running = [...found].filter(([, where]) => where.state === "running");
    if (!running.length) return hosts;
    const onMachine = (address, machine) =>
      machine ? address.startsWith(`${machine}/`) : !address.includes("/");
    const machinesRunning = new Set(running.map(([, where]) => where.machine));
    const candidates = terminals().filter((t) =>
      [...machinesRunning].some((machine) => onMachine(t.address, machine)),
    );
    const foregrounds = await Promise.all(
      candidates.map(async (t) => {
        try {
          const got = await hc(["get", t.address, "--json"]);
          return {
            address: t.address,
            pid: JSON.parse(got.stdout)?.foreground?.pid ?? null,
          };
        } catch {
          return { address: t.address, pid: null };
        }
      }),
    );
    for (const [id, where] of running) {
      const address = terminalOf(
        foregrounds.filter((t) => onMachine(t.address, where.machine)),
        where.pid,
      );
      if (address) hosts.set(id, address);
    }
    return hosts;
  }

  // Renames the tabs the panel named after a task to the task their agent is on now
  // (`tabRenames`), once the render ends.
  followTabs(cx, live, byTask, goals) {
    const renames = tabRenames(
      live,
      byTask,
      goals.map((goal) => goal.ref),
    ).filter(([id, name]) => this.renamed.get(id) !== name);
    if (!renames.length) return;
    for (const [id, name] of renames) this.renamed.set(id, name);
    later(cx, () => {
      for (const [id, name] of renames) run("tab.rename", { id, name });
    });
  }

  // Opens a task's row, uncollapsing its group and showing all of To do so the row is drawn.
  reveal(key, stage) {
    this.open = key;
    if (stage) this.collapsed.delete(stage);
    if (stage === "created") this.allTodo = true;
  }

  // Opens the session again as a new tab in the space already at its folder on its machine,
  // else in a new space there.
  resume(task, choice) {
    this.resumed.add(choice.session.sessionId);
    const space = resumeSpace(spaces(), panes(), choice);
    if (space) {
      run("tab.new", {
        space: space.id,
        folder: choice.cwd,
        argv: choice.argv,
        name: task.key,
      });
    } else {
      run("space.new", {
        machine: choice.machine ?? "",
        folder: choice.cwd,
        argv: choice.argv,
        tab: task.key,
      });
    }
  }

  render(cx) {
    if (this.role === "toggle") return toggle();
    if (this.role === "start") return startPopup(this.handle);
    const t = theme();

    const ctx = this.context(),
      key = ctx?.key ?? null;
    if (key !== this.ctxKey) {
      this.ctxKey = key;
      this.ctx = ctx;
      this.token++;
      this.loading = false;
      this.refreshDue = false;
      // Another place may be another project, in another organisation or on another machine:
      // its board, sessions and starters are its own. The open row, collapsed groups and Show more
      // carry over, so a space at another checkout of the same project keeps the task open.
      const last = key ? this.cache.get(key) : null;
      this.board = last?.board ?? null;
      this.found = last?.found ?? new Map();
      this.starters = last?.starters ?? [];
      this.loadedAt = last?.loadedAt ?? 0;
      if (ctx) later(cx, (cx) => this.refresh(cx));
    }
    const shownNow = !this.hidden();
    if (shownNow && this.wasHidden && ctx) later(cx, (cx) => this.refresh(cx));
    this.wasHidden = !shownNow;

    const board = this.board;
    const banner = environmentBanner(board?.environment);
    return v_flex()
      .id("clocktopus")
      .track_focus(this.handle)
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(S().body)
      .child(
        h_flex()
          .h(42)
          .flex_none()
          .pl(14)
          .pr(8)
          .gap(8)
          .items_center()
          .border_b(1)
          .border_color(t.border)
          .child(image(MARK).w(18).h(18).rounded(4).flex_none())
          .child(
            div()
              .flex_1()
              .min_w(0)
              .text_size(S().title)
              .font_semibold()
              .child("Clocktopus"),
          )
          .when(
            board?.status === "ok" && Boolean(board.project.pageUrl),
            (el) =>
              el.child(
                iconButton(
                  "open-project",
                  "external",
                  "Open the Work page",
                  t,
                  (_e, cx) => cx.open_url(board.project.pageUrl),
                ),
              ),
          )
          .child(
            h_flex()
              .id("refresh")
              .size(24)
              .flex_none()
              .justify_center()
              .items_center()
              .rounded(6)
              .cursor_pointer()
              .hover((s) => s.bg(t.hover))
              .tooltip("Refresh")
              .on_mouse_down("left", stop)
              .on_click((_e, cx) => this.refresh(cx))
              .child(
                this.loading
                  ? icon("ring", 14, t.working).spin(900)
                  : icon("refresh", 14, t.muted),
              ),
          )
          .child(
            iconButton("close", "close", "Hide", t, () =>
              run("layout.hide", { id: PANEL }),
            ),
          ),
      )
      .when(Boolean(banner), (el) =>
        el.child(this.renderEnvironment(t, banner)),
      )
      .child(this.renderBody(t, ctx, cx))
      .child(this.renderFooter(t, ctx));
  }

  // Off production, or on a CLI built from a checkout, so nobody mistakes the board for the real one.
  renderEnvironment(t, banner) {
    return v_flex()
      .flex_none()
      .px(14)
      .py(6)
      .gap(2)
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.blocked)
      .child(
        h_flex()
          .gap(7)
          .items_center()
          .text_color(t.blocked)
          .child(icon("alert", 13, t.blocked))
          .child(
            div()
              .flex_1()
              .min_w(0)
              .truncate()
              .text_size(S().secondary)
              .font_semibold()
              .child(banner.title),
          ),
      )
      .when(Boolean(banner.detail), (el) =>
        el.child(
          div()
            .pl(20)
            .truncate()
            .text_size(S().label)
            .text_color(t.muted)
            .child(banner.detail),
        ),
      );
  }

  renderBody(t, ctx, cx) {
    if (!ctx)
      return v_flex()
        .flex_1()
        .p(16)
        .child(note(t, "Open a space to see its project's tasks."));
    const board = this.board;
    if (!board) {
      return v_flex()
        .flex_1()
        .p(14)
        .gap(10)
        .children(
          [0, 1, 2, 3, 4].map((i) =>
            div()
              .h(44)
              .rounded(8)
              .bg(t.chrome)
              .opacity(1 - i * 0.15),
          ),
        );
    }
    if (board.status !== "ok") return this.renderProblem(t, ctx, board);

    const live = liveAgents(
      agents(),
      panes(),
      this.sessionIds,
      labelledTasks(terminals()),
    );
    const byTask = agentsByTask(board.tasks, live);
    const shown = withAgentStages(board.tasks, byTask);
    const scene = {
      byTask,
      inView: inView(live, focused()),
      moved: movedOn(board.tasks, byTask, live),
      stageOf: new Map(shown.tasks.map((task) => [task.key, task.stage])),
    };
    this.followTabs(cx, live, byTask, board.goals);
    const todoTotal = board.todoTotal - shown.moved;
    const counts = Object.fromEntries(
      STAGES.map(([stage]) => [
        stage,
        shown.tasks.filter((task) => task.stage === stage).length,
      ]),
    );

    const keys = goalKeys(board.goals, this.pickedGoals(ctx));
    const narrowed = Boolean(this.query) || keys !== null;
    const sections = [];
    for (const stage of STAGE_ORDER) {
      const label = STAGES.find(([s]) => s === stage)[1];
      const matching = filterTasks(shown.tasks, stage, this.query, keys);
      const capped =
        stage === "created" && !narrowed && !this.allTodo
          ? matching.slice(0, TODO_SHOWN)
          : matching;
      const total =
        stage === "created"
          ? todoTotal
          : stage === "merged"
            ? (board.mergedTotal ?? 0)
            : counts[stage];
      // An older CLI or server lists no Ready to ship tasks, and an empty one is noise.
      if (stage === "merged" && total === 0) continue;
      // Tasks an agent is working on now; an idle or finished agent isn't cooking.
      const cookingCount = matching.filter((task) =>
        (byTask.get(task.key) ?? []).some(
          (agent) => agent.status === "working",
        ),
      ).length;
      const collapsed = this.collapsed.has(stage) && !narrowed;
      // A collapsed group still says it holds the task the window shows.
      const hiddenInView = collapsed
        ? matching.find((task) =>
            (byTask.get(task.key) ?? []).some((agent) =>
              scene.inView.has(agent.address),
            ),
          )
        : null;
      sections.push(
        h_flex()
          .id(`group-${stage}`)
          .min_h(30)
          .px(14)
          .pt(10)
          .pb(4)
          .gap(8)
          .items_center()
          .cursor_pointer()
          .on_mouse_down("left", stop)
          .on_click((_e, cx) => {
            if (this.collapsed.has(stage)) this.collapsed.delete(stage);
            else this.collapsed.add(stage);
            cx.notify();
          })
          .child(
            icon(collapsed ? "chevron-right" : "chevron-down", 12, t.muted),
          )
          .child(
            div()
              .flex_1()
              .text_size(S().label)
              .font_semibold()
              .text_color(t.muted)
              .child(
                `${label} · ${narrowed ? `${matching.length} of ${total}` : total}`,
              ),
          )
          .when(cookingCount > 0, (el) =>
            el.child(
              h_flex()
                .gap(5)
                .items_center()
                .text_size(S().label)
                .text_color(cooking(t))
                .child(dot(cooking(t), 6))
                .child(`${cookingCount} cooking`),
            ),
          )
          .when(Boolean(hiddenInView), (el) =>
            el.child(
              h_flex()
                .gap(5)
                .items_center()
                .text_size(S().label)
                .text_color(t.accent)
                .child(`in view · ${hiddenInView.key}`),
            ),
          ),
      );
      if (collapsed) continue;
      sections.push(...capped.map((task) => this.row(t, ctx, task, scene)));
      if (!matching.length)
        sections.push(
          div()
            .px(14)
            .pb(6)
            .child(
              note(
                t,
                narrowed ? "Nothing matches the filter." : "Nothing here.",
              ),
            ),
        );
      const hiddenTodo =
        stage === "created" && !narrowed && !this.allTodo
          ? Math.max(0, matching.length - capped.length)
          : 0;
      if (hiddenTodo > 0) {
        sections.push(
          div()
            .px(14)
            .py(4)
            .child(
              button(
                "all-todo",
                `Show ${hiddenTodo} more`,
                t,
                (_e, cx) => {
                  this.allTodo = true;
                  cx.notify();
                },
                { quiet: true, color: t.muted },
              ),
            ),
        );
      }
      if (
        stage === "created" &&
        todoTotal > counts.created &&
        (this.allTodo || narrowed)
      ) {
        sections.push(
          div()
            .px(14)
            .pb(6)
            .child(
              note(
                t,
                `The oldest ${todoTotal - counts.created} are on the Work page.`,
              ),
            ),
        );
      }
      if (stage === "merged" && !collapsed && total > counts.merged) {
        sections.push(
          div()
            .px(14)
            .pb(6)
            .child(
              note(
                t,
                `The ${total - counts.merged} merged longer ago are on the Work page.`,
              ),
            ),
        );
      }
    }

    const tools = v_flex()
      .flex_none()
      .px(14)
      .py(10)
      .gap(8)
      .border_b(1)
      .border_color(t.border)
      .child(
        h_flex()
          .w_full()
          .min_w(0)
          .h(30)
          .px(10)
          .gap(8)
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(t.border)
          .bg(t.chrome)
          .child(icon("search", 14, t.muted))
          .child(
            Input.new(this.filter)
              .flex_1()
              .min_w(0)
              .h_full()
              .text_size(S().secondary)
              .text_color(t.foreground),
          ),
      )
      .when(board.goals.length > 0, (el) =>
        el.child(this.renderGoals(t, ctx, board.goals)),
      );

    return v_flex()
      .flex_1()
      .min_h(0)
      .child(this.renderPlace(t, ctx, board.project))
      .child(tools)
      .child(
        div()
          .id("list")
          .flex_1()
          .min_h(0)
          .overflow_y_scrollbar()
          .child(v_flex().pb(16).children(sections)),
      );
  }

  // One toggle per active goal; the tasks of every goal picked show, and none picked shows all.
  renderGoals(t, ctx, goals) {
    const picked = this.pickedGoals(ctx);
    const chips = goals.map((goal) => {
      const on = picked.includes(goal.ref);
      return h_flex()
        .id(`goal-${goal.ref}`)
        .h(24)
        .px(9)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(12)
        .border_1()
        .border_color(on ? t.accent : t.border)
        .bg(on ? t.selected : t.background)
        .text_size(S().label)
        .text_color(on ? t.foreground : t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip(goal.title)
        .on_mouse_down("left", stop)
        .on_click(() => this.toggleGoal(ctx, goal.ref))
        .child(div().flex_none().font_semibold().child(goal.ref))
        .child(div().max_w(150).truncate().child(goal.title))
        .child(
          div().flex_none().text_color(t.muted).child(String(goal.keys.length)),
        );
    });
    return h_flex()
      .w_full()
      .flex_wrap()
      .gap(6)
      .children(chips)
      .when(
        picked.some((ref) => goals.some((goal) => goal.ref === ref)),
        (el) =>
          el.child(
            button(
              "clear-goals",
              "Clear",
              t,
              () =>
                setShared(GOALS, { ...(shared(GOALS) ?? {}), [ctx.key]: [] }),
              { quiet: true, color: t.muted, h: 24, px: 6 },
            ),
          ),
      );
  }

  renderPlace(t, ctx, project) {
    const where = [
      project.organizationName,
      folderName(ctx.folder, ctx.on ? null : home()) || "~",
    ].filter(Boolean);
    return h_flex()
      .flex_none()
      .px(14)
      .py(8)
      .gap(8)
      .items_center()
      .border_b(1)
      .border_color(t.border)
      .child(icon("folder", 13, t.muted))
      .child(
        div()
          .flex_none()
          .text_size(S().secondary)
          .font_semibold()
          .child(project.name),
      )
      .child(
        div()
          .flex_1()
          .min_w(0)
          .truncate()
          .text_size(S().label)
          .text_color(t.muted)
          .child(where.join(" · ")),
      )
      .when(Boolean(this.chosenOrg(ctx)), (el) =>
        el.child(
          iconButton(
            "change-org",
            "refresh",
            "Choose another organisation",
            t,
            (_e, cx) => {
              this.chooseOrg(ctx, null);
              this.refresh(cx);
            },
          ),
        ),
      )
      .child(pill(ctx.on ?? "this computer", t));
  }

  row(t, ctx, task, scene) {
    const here = scene.byTask.get(task.key) ?? [];
    const open = this.open === task.key;
    const agent = mostUrgent(here);
    const look = agent ? statusLook(agent.status, t) : null;
    const shownHere = here.some((a) => scene.inView.has(a.address));
    const moved = agent ? [] : (scene.moved.get(task.key) ?? []);
    const away =
      moved.find((m) => scene.inView.has(m.agent.address)) ?? moved[0] ?? null;
    const awayShown = Boolean(away) && scene.inView.has(away.agent.address);
    const elsewhere = agent ? null : workingElsewhere(task, away);
    const liveIds = new Set([
      ...Object.values(this.sessionIds),
      ...this.resumed,
    ]);
    const target = clickTarget(here);
    const resumable = agent ? null : resumeChoice(task, this.found, liveIds);
    const runningOutside = task.sessions.find(
      (s) =>
        !liveIds.has(s.sessionId) &&
        this.found.get(s.sessionId)?.state === "running",
    );
    const host = runningOutside
      ? (this.hosts.get(runningOutside.sessionId) ?? null)
      : null;
    const now = Date.now();

    let sub;
    let subColor = t.muted;
    if (agent) {
      sub = `${agent.name} ${look.label}${here.length > 1 ? ` · ${here.length} agents` : ""}${shownHere ? " · in view" : ""}`;
      subColor = look.color;
    } else if (runningOutside) {
      sub = host
        ? `${agentName(runningOutside.agent)} open in a Herdr terminal`
        : `${agentName(runningOutside.agent)} running outside Herdr${machineLabel(this.found.get(runningOutside.sessionId).machine)}`;
      subColor = cooking(t);
    } else if (elsewhere) {
      sub = elsewhere.mine
        ? `${agentName(elsewhere.agent)} working outside Herdr · ${ago(elsewhere.lastActivityAt, now)}`
        : `${elsewhere.userName ?? "Someone"}'s ${agentName(elsewhere.agent)} working`;
      subColor = cooking(t);
    } else if (away) {
      sub = `${away.agent.name} moved on to ${away.now ?? "another task"}${awayShown ? " · in view" : ""}`;
    } else {
      const bits = [];
      if (resumable)
        bits.push(
          `resume ${agentName(resumable.session.agent)} · ${ago(resumable.session.lastActivityAt, now)}${machineLabel(resumable.machine)}`,
        );
      if (task.stale) bits.push(`quiet ${ago(task.lastActivityAt, now)}`);
      if (task.goal) bits.push(task.goal.ref);
      if (!bits.length && task.stageSince)
        bits.push(
          `${ago(task.stageSince, now)} in ${STAGES.find(([s]) => s === task.stage)[1].toLowerCase()}`,
        );
      sub = bits.join(" · ");
    }

    const marker = agent
      ? look.spin
        ? spinner(look.color)
        : dot(look.color, 8)
      : elsewhere || runningOutside
        ? dot(cooking(t), 8, true)
        : away
          ? dot(statusLook(away.agent.status, t).color, 8, true)
          : dot(resumable ? t.accent : t.border, 8, !resumable);

    // Going to an agent already in view would change nothing on screen, so that click opens the
    // row instead; so does one on a task whose session has moved on, which lists where it went.
    const goTo = focusTarget(target, scene.inView);
    let tip = null;
    if (target)
      tip = goTo
        ? `Go to ${target.name}${target.where ? ` in ${target.where}` : ""}`
        : `${target.name} is in view: click for its sessions`;
    else if (here.length > 1) tip = "Several agents may be on it: pick one";
    else if (host) tip = "Go to its terminal";
    else if (runningOutside)
      tip = "Running in another app: open the row to open a copy here";
    else if (away)
      tip = `This task's ${away.agent.name} session is on ${away.now ?? "another task"} now`;
    else if (resumable)
      tip = `Resume ${agentName(resumable.session.agent)} in ${resumable.cwd}`;

    const head = h_flex()
      .id(`row-${task.key}`)
      .min_h(48)
      .px(10)
      .py(6)
      .gap(10)
      .when(open, (el) => el.items_start())
      .when(!open, (el) => el.items_center().hover((s) => s.bg(t.hover)))
      .rounded(8)
      .cursor_pointer()
      .when(Boolean(tip), (el) => el.tooltip(tip))
      .on_mouse_down("left", stop)
      .on_click((_e, cx) => {
        if (goTo) run("pane.focus", { pane: goTo.pane });
        else if (!agent && host) run("pane.focus", { terminal: host });
        else if (!agent && !away && resumable) {
          this.resume(task, resumable);
          cx.notify();
        } else {
          this.open = open ? null : task.key;
          cx.notify();
        }
      })
      .when(!open, (el) =>
        el.child(h_flex().w(12).flex_none().justify_center().child(marker)),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .when(open, (el) =>
            el
              .gap(2)
              .child(
                div()
                  .font_family(mono())
                  .text_size(S().label)
                  .text_color(t.muted)
                  .child(task.key),
              )
              .child(
                div()
                  .text_size(S().body)
                  .font_medium()
                  .child(task.title ?? "Untitled"),
              ),
          )
          .when(!open, (el) =>
            el.child(
              h_flex()
                .gap(6)
                .items_center()
                .min_w(0)
                .child(
                  div()
                    .flex_none()
                    .font_family(mono())
                    .text_size(S().label)
                    .text_color(t.muted)
                    .child(task.key),
                )
                .child(
                  div()
                    .flex_1()
                    .min_w(0)
                    .truncate()
                    .text_size(S().body)
                    .font_medium()
                    .child(task.title ?? "Untitled"),
                ),
            ),
          )
          .when(!open && Boolean(sub), (el) =>
            el.child(
              div()
                .truncate()
                .text_size(S().secondary)
                .text_color(subColor)
                .child(sub),
            ),
          ),
      )
      .when(task.stage === "created" && this.starters.length > 0, (el) => {
        const starters = this.starters;
        return el.child(
          iconButton(
            `start-${task.key}`,
            "play",
            `Start work on ${task.key}${task.goal ? ` or its goal ${task.goal.ref}` : ""}, or open a worktree for it`,
            t,
            () => {
              const goal = task.goal
                ? {
                    ...task.goal,
                    count:
                      this.board.goals.find((g) => g.ref === task.goal.ref)
                        ?.keys.length ?? null,
                  }
                : null;
              openOverlay({
                mod: "clocktopus",
                kind: "popup",
                width: START_POPUP_WIDTH,
                height: startPopupHeight(goal ? 2 : 1, starters.length),
                props: {
                  role: "start",
                  ctx,
                  starters,
                  task: { key: task.key, title: task.title },
                  goal,
                },
              });
            },
          ),
        );
      })
      .when(Boolean(task.pageUrl), (el) =>
        el.child(
          iconButton(
            `web-${task.key}`,
            "external",
            "Open in Clocktopus",
            t,
            (_e, cx) => cx.open_url(task.pageUrl),
          ),
        ),
      )
      .child(
        iconButton(
          `more-${task.key}`,
          open ? "chevron-down" : "chevron-right",
          open ? "Less" : "Sessions and details",
          t,
          (_e, cx) => {
            this.open = open ? null : task.key;
            cx.notify();
          },
        ),
      );
    // Every row has a 1px border so marking one doesn't shift it: `accent` for the task the window
    // shows, `border` for one its session moved on from, else the row's own background.
    const edge = shownHere
      ? t.accent
      : awayShown
        ? t.border
        : open
          ? t.raised
          : t.background;
    if (!open)
      return div().mx(8).rounded(8).border_1().border_color(edge).child(head);
    return v_flex()
      .mx(8)
      .rounded(8)
      .border_1()
      .border_color(edge)
      .bg(t.raised)
      .child(head)
      .child(this.details(t, ctx, task, scene));
  }

  details(t, ctx, task, scene) {
    const here = scene.byTask.get(task.key) ?? [];
    const now = Date.now();
    // Agents and sessions as one list: live agents on the task, live agents that moved on from
    // it, other people's, then your sessions with something to do (go to, resume, open a copy)
    // before the ones without.
    const items = [];

    const tagOf = (agent) =>
      agent.tabName
        ? { space: agent.spaceName, tab: agent.tabName }
        : agent.spaceName
          ? { space: null, tab: agent.spaceName }
          : null;
    // A line going to a live agent; one already in view says so and goes nowhere.
    const liveLine = (agent, id, status, marker, color) => {
      const shown = scene.inView.has(agent.address);
      return {
        id,
        marker,
        name: agent.name,
        status: `${status}${shown ? " · in view" : ""}`,
        statusColor: color,
        shown,
        tag: tagOf(agent),
        tip: shown
          ? `In view${agent.where ? ` in ${agent.where}` : ""}`
          : `Go to ${agent.name}${agent.where ? ` in ${agent.where}` : ""}`,
        onClick: shown
          ? undefined
          : () => run("pane.focus", { pane: agent.pane }),
      };
    };
    for (const agent of here) {
      const look = statusLook(agent.status, t);
      items.push(
        liveLine(
          agent,
          `go-${agent.address}`,
          `${look.label}${agent.via === "branch" ? " · by branch" : ""}`,
          look.spin ? spinner(look.color) : dot(look.color),
          look.color,
        ),
      );
    }
    for (const { agent, now: nowOn } of scene.moved.get(task.key) ?? []) {
      const look = statusLook(agent.status, t);
      items.push(
        liveLine(
          agent,
          `moved-${agent.address}`,
          `moved on to ${nowOn ?? "another task"}`,
          dot(look.color, 8, true),
          t.muted,
        ),
      );
    }
    // The other tasks the board lists this task's live sessions on, each a click opening its row.
    const alsoOn = [...scene.moved]
      .filter(([, ms]) =>
        ms.some((m) => here.some((a) => a.address === m.agent.address)),
      )
      .map(([key]) => key);
    for (const w of task.working.filter((other) => !other.mine)) {
      items.push({
        marker: dot(cooking(t), 8, true),
        name: `${w.userName ?? "Someone"}'s ${agentName(w.agent)}`,
        status: `working · ${ago(w.lastActivityAt, now)}`,
        statusColor: cooking(t),
      });
    }

    const liveIds = new Set(Object.values(this.sessionIds));
    const quiet = [];
    for (const s of task.sessions.filter(
      (session) => !liveIds.has(session.sessionId),
    )) {
      const argv = resumeArgv(s);
      const where = this.found.get(s.sessionId);
      const hostOf = this.hosts.get(s.sessionId);
      const when = s.closedAt
        ? `ended ${ago(s.closedAt, now)} ago`
        : `active ${ago(s.lastActivityAt, now)} ago`;
      const name = agentName(s.agent);
      const branch = s.gitBranch ? ` on ${s.gitBranch}` : "";
      if (where?.state === "running" && hostOf) {
        items.push({
          id: `go-${s.sessionId}`,
          marker: dot(cooking(t), 8, true),
          name,
          status: "open in a Herdr terminal",
          statusColor: cooking(t),
          tip: "Go to its terminal",
          onClick: () => run("pane.focus", { terminal: hostOf }),
        });
      } else if (where?.state === "running") {
        const fork = forkArgv(s);
        items.push({
          marker: dot(cooking(t), 8, true),
          name,
          status: `running outside Herdr${machineLabel(where.machine)}`,
          statusColor: cooking(t),
          action: fork
            ? button(
                `copy-${s.sessionId}`,
                "Open a copy",
                t,
                (_e, cx) => {
                  this.resume(task, { session: s, ...where, argv: fork });
                  cx.notify();
                },
                {
                  icon: "play",
                  quiet: true,
                  small: true,
                  px: 6,
                  color: t.accent,
                  tip: "It keeps running where it is. This opens its conversation here as a new session.",
                },
              )
            : null,
        });
      } else if (argv && where) {
        items.push({
          marker: dot(t.accent),
          name,
          status: `${when}${machineLabel(where.machine)}`,
          tip: `${name}${branch} in ${where.cwd}`,
          action: button(
            `resume-${s.sessionId}`,
            "Resume",
            t,
            (_e, cx) => {
              this.resume(task, { session: s, ...where, argv });
              cx.notify();
            },
            { icon: "play", quiet: true, small: true, px: 6, color: t.accent },
          ),
        });
      } else {
        quiet.push({
          marker: dot(t.border, 8, true),
          name,
          status: `${when} · ${argv ? "not reachable" : "can't be resumed"}`,
          tip: argv
            ? `Not on a machine Herdr reaches${branch ? ` (${s.gitBranch})` : ""}`
            : `${name} sessions can't be resumed from Herdr`,
        });
      }
    }
    items.push(...quiet);

    const parts = [];
    if (task.goal)
      parts.push(note(t, `${task.goal.ref} · ${task.goal.title}`).px(4));
    if (items.length)
      parts.push(
        v_flex()
          .rounded(7)
          .overflow_hidden()
          .bg(t.background)
          .border_1()
          .border_color(t.border)
          .children(
            items.map((item, i) => listRow(t, { ...item, first: i === 0 })),
          ),
      );
    if (alsoOn.length)
      parts.push(
        h_flex()
          .px(4)
          .gap(6)
          .flex_wrap()
          .items_center()
          .child(note(t, "Its session also worked on"))
          .children(
            alsoOn.map((key) =>
              button(
                `also-${task.key}-${key}`,
                key,
                t,
                (_e, cx) => {
                  this.reveal(key, scene.stageOf.get(key));
                  cx.notify();
                },
                { small: true, h: 20, px: 6, tip: `Open ${key}` },
              ).font_family(mono()),
            ),
          ),
      );
    return v_flex().px(6).pb(8).gap(8).children(parts);
  }

  renderProblem(t, ctx, board) {
    const inTab = (argv, name) =>
      run("tab.new", {
        space: ctx.space,
        folder: ctx.folder || undefined,
        argv,
        name,
      });
    const box = (title, body, action) =>
      v_flex()
        .flex_1()
        .p(16)
        .gap(10)
        .child(
          h_flex()
            .gap(7)
            .items_center()
            .child(icon("alert", 14, t.blocked))
            .child(div().font_semibold().child(title)),
        )
        .child(note(t, body))
        .when(Boolean(action), (el) => el.child(h_flex().child(action)));
    switch (board.status) {
      case "signed_out":
        return box(
          "Sign in to Clocktopus",
          "The panel reads your tasks through the Clocktopus CLI on this machine.",
          button(
            "login",
            "Sign in",
            t,
            () => inTab(["clocktopus", "login"], "Clocktopus login"),
            { primary: true },
          ),
        );
      case "no_cli":
        return box(
          "The Clocktopus CLI isn't installed here",
          `Install it${ctx.on ? ` on ${ctx.on}` : ""} with npm install -g @blastin-dev/clocktopus-cli, then sign in with clocktopus login.`,
          null,
        );
      case "old_cli":
        return box(
          "The Clocktopus CLI is too old for this panel",
          "It needs the tasks command.",
          button(
            "upgrade",
            "Upgrade",
            t,
            () => inTab(["clocktopus", "upgrade"], "Clocktopus upgrade"),
            { primary: true },
          ),
        );
      case "not_a_repository":
        return box(
          "Not in a git checkout",
          `${ctx.folder || "This space"} has no git remote. Focus a terminal in a repository.`,
          null,
        );
      case "unsupported_repository":
        return box(
          "Not a GitHub or Bitbucket repository",
          "Clocktopus reads GitHub and Bitbucket remotes.",
          null,
        );
      case "no_project":
        return box(
          "Not linked to a project",
          `${board.repository} is linked to no Clocktopus project you can see.`,
          button(
            "init",
            "Set it up",
            t,
            () => inTab(["clocktopus", "init"], "Clocktopus init"),
            { primary: true },
          ),
        );
      case "choose_organization":
        return v_flex()
          .flex_1()
          .p(16)
          .gap(8)
          .child(
            div()
              .font_semibold()
              .child("Several organisations link this repository"),
          )
          .children(
            board.projects.map((p) =>
              button(
                `org-${p.organizationId}`,
                `${p.organizationName ?? "Unnamed organisation"} · ${p.projectName}`,
                t,
                (_e, cx) => {
                  this.chooseOrg(ctx, p.organizationId);
                  this.refresh(cx);
                },
              ),
            ),
          );
      default:
        return box(
          "Couldn't read the tasks",
          board.message ?? "The CLI answered something the panel doesn't know.",
          button("retry", "Try again", t, (_e, cx) => this.refresh(cx)),
        );
    }
  }

  renderFooter(t, ctx) {
    const board = this.board;
    const local = agents().filter((a) => a.status === "working").length;
    const age = this.loadedAt
      ? ago(new Date(this.loadedAt).toISOString(), Date.now())
      : null;
    const inFlight =
      board?.status === "ok"
        ? board.tasks.filter(
            (x) => x.stage === "in_progress" || x.stage === "in_review",
          ).length
        : null;
    const text =
      !ctx || !age
        ? this.loading
          ? "Reading tasks…"
          : ""
        : `${inFlight !== null ? `${inFlight} in flight · ` : ""}updated ${age === "now" ? "just now" : `${age} ago`}`;
    return h_flex()
      .h(34)
      .flex_none()
      .px(14)
      .gap(8)
      .items_center()
      .border_t(1)
      .border_color(t.border)
      .text_size(S().label)
      .text_color(t.muted)
      .child(div().flex_1().min_w(0).truncate().child(text))
      .when(local > 0, (el) =>
        el.child(
          h_flex()
            .gap(5)
            .items_center()
            .text_color(cooking(t))
            .child(icon("ring", 11, cooking(t)).spin(900))
            .child(`${local} agent${local === 1 ? "" : "s"} working`),
        ),
      );
  }
}
