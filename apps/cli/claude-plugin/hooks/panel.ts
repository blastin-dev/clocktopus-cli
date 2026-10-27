import type { Attribution, Cli, Goal, Task, View } from "../types";

// The web app's `STAGE_LABEL`, lowercased.
export const STAGE_LABEL: Record<string, string> = {
  created: "created",
  in_progress: "in progress",
  in_review: "in review",
  merged: "ready to ship",
  done: "delivered",
  cancelled: "cancelled",
};
// The web app's `STAGE_COLOR` (`apps/web/src/components/tasks/stage-icon.tsx`): Tailwind's
// 500 shades, and the theme's grey for its muted foreground.
export const STAGE_COLOR: Record<string, string> = {
  created: "inactive",
  in_progress: "#f59e0b",
  in_review: "#10b981",
  merged: "#0ea5e9",
  done: "#8b5cf6",
  cancelled: "inactive",
};
const STATUS_NOTE: Record<string, string> = {
  no_project: "this repository is linked to no Clocktopus project",
  choose_organization: "several organisations link this repository",
  unsupported_repository:
    "Clocktopus doesn't recognise this repository's remote",
};
// The plugin is installed for every repository, so one Clocktopus doesn't know shows nothing.
const SILENT_STATUSES = new Set(["no_project", "unsupported_repository"]);
const BRANCH_CHANGE = /\bgit\b[^\n]*\b(checkout|switch|worktree)\b/;
// Matches the plugin's `mcp__plugin_clocktopus_clocktopus__*` and a hand-configured `mcp__clocktopus__*`.
const CLOCKTOPUS_TOOL = /^mcp__(?:plugin_clocktopus_)?clocktopus__[a-z_]+$/;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const records = (value: unknown) =>
  Array.isArray(value) ? value.filter(isRecord) : [];
export const text = (value: unknown) =>
  typeof value === "string" ? value : null;
const amount = (value: unknown) => (typeof value === "number" ? value : null);
const usd = (value: number) => `$${value.toFixed(2)}`;
export const duration = (hours: number) =>
  hours < 1 ? `${Math.round(hours * 60)}m` : `${hours.toFixed(1)}h`;
export const stageOf = (stage: string) => STAGE_LABEL[stage] ?? stage;
export const colorOf = (stage: string) => STAGE_COLOR[stage] ?? "inactive";
export const totalOf = (goal: Goal) => goal.doneCount + goal.open.length;
export const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .split("\n")[0]!
    .slice(0, 160);

export function clock(ms: number) {
  const at = new Date(ms);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export const hidden = (note: string | null) => ({
  isShown: false,
  task: null,
  goal: null,
  attribution: null,
  cli: null,
  note,
});

// Whether a finished tool call can have moved the session to another task: a Clocktopus MCP
// call, or a branch or worktree change.
export function isRefreshingCall(tool: string, command: string | null) {
  return (
    CLOCKTOPUS_TOOL.test(tool) ||
    tool === "EnterWorktree" ||
    tool === "ExitWorktree" ||
    (tool === "Bash" && BRANCH_CHANGE.test(command ?? ""))
  );
}

function readTask(value: unknown): Task | null {
  if (!isRecord(value)) return null;
  const key = text(value.key);
  if (!key) return null;
  return {
    key,
    title: text(value.title),
    stage: text(value.stage) ?? "created",
    hours: amount(value.hours),
    agentHours: amount(value.agentHours),
    pageUrl: text(value.pageUrl),
  };
}

function readGoal(value: unknown): Goal | null {
  if (!isRecord(value)) return null;
  const ref = text(value.ref);
  if (!ref) return null;
  return {
    ref,
    title: text(value.title) ?? "",
    doneCount: amount(value.doneCount) ?? 0,
    open: records(value.open).flatMap((row) => {
      const key = text(row.key);
      return key
        ? [
            {
              key,
              title: text(row.title),
              stage: text(row.stage) ?? "created",
              claimed: row.claimed === true,
            },
          ]
        : [];
    }),
  };
}

// The first `major.minor.patch` in `text`, as `clocktopus --version` prints it; null for none,
// or for `0.0.0`, the version a plugin built from source carries.
export function versionIn(text: string) {
  const version = /\d+\.\d+\.\d+\S*/.exec(text)?.[0] ?? null;
  return version === "0.0.0" ? null : version;
}

// `installed` is `clocktopus --version`'s, `plugin` this session's plugin manifest's.
export type LocalVersions = { installed: string | null; plugin: string | null };

function readCli(value: unknown, local: LocalVersions): Cli | null {
  if (!isRecord(value)) return null;
  const version = local.installed ?? local.plugin;
  if (!version) return null;
  return {
    version,
    plugin: local.plugin,
    latest: text(value.latest),
    minimum: text(value.minimum),
    isBehind: value.isBehind === true,
    isUnsupported: value.isUnsupported === true,
  };
}

// `panel` is `get_session_panel`'s answer; the rest is what the session itself knows.
export function viewOf(
  panel: Record<string, unknown>,
  session: Pick<Attribution, "sessionId" | "branch" | "checkout">,
  local: LocalVersions = { installed: null, plugin: null },
): Omit<View, "error" | "updatedAt"> {
  return { ...taskViewOf(panel, session), cli: readCli(panel.cli, local) };
}

function taskViewOf(
  panel: Record<string, unknown>,
  session: Pick<Attribution, "sessionId" | "branch" | "checkout">,
): Omit<View, "error" | "updatedAt" | "cli"> {
  const status = text(panel.status) ?? "unknown";
  if (SILENT_STATUSES.has(status)) return hidden(STATUS_NOTE[status] ?? status);
  if (status !== "ok")
    return { ...hidden(STATUS_NOTE[status] ?? status), isShown: true };

  const task = readTask(panel.task);
  const taskKey = text(panel.taskKey);
  if (!task) {
    return {
      ...hidden(
        taskKey
          ? `Clocktopus has no task ${taskKey}`
          : session.branch
            ? `branch ${session.branch} names no task`
            : "HEAD is detached",
      ),
      isShown: true,
    };
  }
  const tie = isRecord(panel.attribution) ? panel.attribution : {};
  return {
    isShown: true,
    task,
    goal: readGoal(panel.goal),
    attribution: {
      ...session,
      isKnown: tie.known === true,
      countsTowardTask: tie.countsTowardTask === true,
      currentKey: text(tie.currentKey),
      branchKey: text(tie.branchKey),
      sessionCostUsd: amount(tie.sessionCostUsd),
      lastActivityAt: text(tie.lastActivityAt),
      shares: records(tie.tasks).flatMap((row) => {
        const key = text(row.key);
        return key ? [{ key, costUsd: amount(row.costUsd) }] : [];
      }),
    },
    note: null,
  };
}

export function statusLine(current: View | null) {
  if (!current) return undefined;
  const upgrade = current.cli?.isUnsupported ? " · CLI upgrade required" : "";
  if (!current.isShown || !current.task) {
    const why = current.error ?? (current.isShown ? current.note : null);
    if (why) return `Clocktopus: ${why}${upgrade}`;
    return upgrade ? "Clocktopus: CLI upgrade required" : undefined;
  }
  const goal = current.goal
    ? ` · ${current.goal.ref} ${current.goal.doneCount}/${totalOf(current.goal)}`
    : "";
  const attribution = current.attribution;
  const attributed = attribution
    ? ` · ${attribution.countsTowardTask ? "attributed" : "not attributed"}`
    : "";
  const branch =
    attribution?.branchKey && attribution.branchKey !== current.task.key
      ? ` · branch ${attribution.branchKey}`
      : "";
  return `${current.task.key} · ${stageOf(current.task.stage)}${goal}${attributed}${branch}${current.error ? " · not refreshed" : ""}${upgrade}`;
}

export type Row = {
  label: string;
  value: string;
  color?: "success" | "warning";
};

export function spendOf(attribution: Attribution) {
  const total = attribution.sessionCostUsd;
  if (!total) return "none yet";
  const shares = attribution.shares.flatMap((share) =>
    share.costUsd === null ? [] : [{ ...share, costUsd: share.costUsd }],
  );
  if (shares.length === 1 && shares[0]!.costUsd === total) return usd(total);
  return [
    `${usd(total)} in all`,
    ...shares.map((share) => `${usd(share.costUsd)} on ${share.key}`),
  ].join(" · ");
}

export function sessionRows(attribution: Attribution, task: Task): Row[] {
  const rows: Row[] = [
    { label: "Session", value: `${attribution.sessionId.slice(0, 8)}…` },
    !attribution.isKnown
      ? {
          label: "Status",
          value: "✗ Not attributed: Clocktopus hasn't seen this session",
          color: "warning",
        }
      : !attribution.countsTowardTask
        ? {
            label: "Status",
            value: `✗ Not attributed: ${task.key} doesn't list it`,
            color: "warning",
          }
        : attribution.currentKey
          ? {
              label: "Status",
              value: `✓ Linked to ${attribution.currentKey}`,
              color: "success",
            }
          : {
              label: "Status",
              value: `✓ Counts toward ${task.key} by its branch`,
              color: "success",
            },
    {
      label: "Branch",
      value: attribution.branch
        ? `${attribution.branch}${attribution.branchKey ? "" : " (no task)"}`
        : "detached HEAD",
    },
  ];
  if (attribution.checkout) {
    rows.push({
      label: "Worktree",
      value: `${attribution.checkout.path}${attribution.checkout.isWorktree ? "" : " (main checkout)"}`,
    });
  }
  if (attribution.isKnown)
    rows.push({ label: "Spend", value: spendOf(attribution) });
  if (attribution.lastActivityAt) {
    rows.push({
      label: "Reported",
      value: clock(Date.parse(attribution.lastActivityAt)),
    });
  }
  return rows;
}

export function cliRows(cli: Cli): Row[] {
  const rows: Row[] = [{ label: "Version", value: cli.version }];
  if (cli.isUnsupported) {
    rows.push({
      label: "Status",
      value: `✗ Upgrade required: Clocktopus needs ${cli.minimum ?? "a newer CLI"} or later`,
      color: "warning",
    });
  } else if (cli.isBehind) {
    rows.push({
      label: "Status",
      value: `${cli.latest ?? "A newer version"} available`,
      color: "warning",
    });
  } else if (cli.latest) {
    rows.push({ label: "Status", value: "✓ Latest", color: "success" });
  }
  if (cli.isUnsupported || cli.isBehind) {
    rows.push({ label: "Upgrade", value: "clocktopus upgrade" });
  }
  // The CLI was upgraded after this session loaded its plugin.
  if (cli.plugin && cli.plugin !== cli.version) {
    rows.push({
      label: "Plugin",
      value: `${cli.plugin} in this session; new sessions load ${cli.version}`,
    });
  }
  return rows;
}

// `stdout` is `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir`'s.
export function checkoutOf(stdout: string, home: string | undefined) {
  const [root, gitDir, commonDir] = stdout.trim().split("\n");
  if (!root) return null;
  const path =
    home && (root === home || root.startsWith(`${home}/`))
      ? `~${root.slice(home.length)}`
      : root;
  // A linked worktree's git dir is `<common dir>/worktrees/<name>`; the main checkout's is the common dir.
  return {
    path,
    isWorktree: Boolean(gitDir && commonDir && gitDir !== commonDir),
  };
}

// Drops what can carry a credential from a git remote, as `stripRemoteCredentials`
// (`packages/cli-contract/src/remote-url.ts`) does; a hooks module can't import it, so
// `claude-plugin-panel.test.ts` holds the two to the same answers.
const URL_FORM = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/is;
const SCP_USERINFO = /^([^@/]+)@([^/:]+:.*)$/s;
const SSH_SCHEMES = new Set(["ssh", "git+ssh", "ssh+git"]);

export function withoutCredentials(remote: string) {
  const url = URL_FORM.exec(remote);
  if (url) {
    const [, scheme = "", authority = "", rest = ""] = url;
    const at = authority.lastIndexOf("@");
    if (at === -1) return remote;
    const user = authority.slice(0, at).split(":")[0];
    const keptUser =
      SSH_SCHEMES.has(scheme.toLowerCase()) && user ? `${user}@` : "";
    return `${scheme}://${keptUser}${authority.slice(at + 1)}${rest}`;
  }
  const scp = SCP_USERINFO.exec(remote);
  if (scp) {
    const [, userinfo = "", hostAndPath = ""] = scp;
    return `${userinfo.split(":")[0]}@${hostAndPath}`;
  }
  return remote;
}

// An SSH host alias (`git@github-work:acme/portal.git`) is known only to `~/.ssh/config`, so it
// is resolved here as `resolveSshHostAlias` (`apps/cli/src/lib/ssh-host-alias.ts`) does, split in
// two because the engine runs `ssh` asynchronously; `claude-plugin-panel.test.ts` holds the two equal.
const KNOWN_HOSTS = new Set(["github.com", "bitbucket.org"]);
const SSH_URL =
  /^(ssh|git\+ssh|ssh\+git):\/\/(?:([^@/]+)@)?([^/:]+)(:\d+)?(\/.*)$/i;
// git reads `[user@]host:path` as SSH only when no `/` precedes the colon.
const SCP_FORM = /^(?:([^@/:]+)@)?([^/:]+):(?!\/\/)(.+)$/;
// A host starting with `-` would reach ssh as an option.
const SSH_HOST = /^[a-z0-9_][a-z0-9._-]*$/i;

function sshRemote(remote: string) {
  const url = SSH_URL.exec(remote);
  const scp = url || remote.includes("://") ? null : SCP_FORM.exec(remote);
  const host = url ? url[3] : scp?.[2];
  if (!host || !SSH_HOST.test(host)) return null;
  return { url, scp, host, user: url ? url[2] : scp?.[1] };
}

// The host `ssh -G` has to resolve; null for a remote that isn't SSH or is already on a known host.
export function sshHostOf(remote: string) {
  const host = sshRemote(remote)?.host;
  return host && !KNOWN_HOSTS.has(host.toLowerCase()) ? host : null;
}

// `config` is `ssh -G <host>`'s: one `<option> <value>` line per setting.
function sshSetting(config: string, key: string) {
  for (const line of config.split("\n")) {
    const [name, ...value] = line.trim().split(/\s+/);
    if (name?.toLowerCase() === key) return value.join(" ") || undefined;
  }
  return undefined;
}

// The remote with its host alias replaced by the host `config` connects to, in the scp-like form
// the server matches; unchanged when the host is already real.
export function withSshConfig(remote: string, config: string) {
  const parts = sshRemote(remote);
  const hostname = sshSetting(config, "hostname");
  if (
    !parts ||
    !hostname ||
    hostname.toLowerCase() === parts.host.toLowerCase()
  )
    return remote;
  // Without a user in the remote, ssh logs in as the alias's `User`.
  const login = parts.user ?? sshSetting(config, "user");
  const prefix = login ? `${login}@` : "";
  if (parts.url) {
    const [, scheme, , , port = "", path = ""] = parts.url;
    // A non-default port keeps the URL form, which carries it.
    if (port && port !== ":22")
      return `${scheme}://${prefix}${hostname}${port}${path}`;
    return `${prefix}${hostname}:${path.slice(1)}`;
  }
  return `${prefix}${hostname}:${parts.scp?.[3] ?? ""}`;
}
