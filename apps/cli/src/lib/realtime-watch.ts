import { execFileSync, spawn } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RealtimeTopic } from "@repo/cli-contract/realtime";
import type { RealtimeStatus } from "@repo/cli-contract/realtime-client";
import {
  organizationChannel,
  RealtimeConnectionResponseSchema,
  userChannel,
} from "@repo/cli-contract/realtime";
import { openRealtime } from "@repo/cli-contract/realtime-client";

// `realtime watch` keeps one socket per machine and turns each hint into a file
// clients wait on, so a Herdr mod (which can't hold a socket) and the Claude
// plugin both follow Clocktopus without polling. In `dir`:
//   <topic>    rewritten on each hint for that topic, and all of them on a resync
//   status     `{ state, pid, at }`, `state` an `openRealtime` status or `stopped`
//   lease      touched by every client that wants the watcher; it exits once
//              nobody has for `IDLE_MS`
//   watch.pid  the running watcher's pid, the one-per-machine lock
export const realtimeDir = () => join(homedir(), ".clocktopus", "realtime");

// What a task board shows changes with these: a commit that starts a task
// arrives only as `time-entries`.
export const BOARD_TOPICS: RealtimeTopic[] = [
  "tasks",
  "pull-requests",
  "agent-sessions",
  "time-entries",
];

export const IDLE_MS = 15 * 60 * 1000;
// How long a `disabled` status keeps `--detach` from starting another watcher.
export const DISABLED_RECHECK_MS = 60 * 60 * 1000;
const IDLE_CHECK_MS = 60 * 1000;

const lockPath = (dir: string) => join(dir, "watch.pid");
const leasePath = (dir: string) => join(dir, "lease");

// A Node system error's code (`EEXIST`, `EPERM`), or null.
const codeOf = (error: unknown) =>
  error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return codeOf(error) === "EPERM";
  }
}

// The running watcher's pid, or null when none holds the lock.
export function runningWatcher(dir: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(lockPath(dir), "utf8"), 10);
    return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function touchLease(dir: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(leasePath(dir), String(Date.now()));
}

// Takes the lock for this process: false when another live watcher holds it.
// The pid is written to a file of this process's own and linked into place, so
// the lock never exists without its pid. A dead watcher's lock is renamed aside
// before it goes; when what was renamed turns out to be a lock another starter
// took meanwhile, it is put back and this one gives way.
export function acquireLock(dir: string, pid = process.pid): boolean {
  mkdirSync(dir, { recursive: true });
  const own = join(dir, `watch.pid.${pid}`);
  writeFileSync(own, String(pid));
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        linkSync(own, lockPath(dir));
        return true;
      } catch (error) {
        if (codeOf(error) !== "EEXIST") throw error;
        if (runningWatcher(dir) !== null) return false;
        if (!removeDeadLock(dir, pid)) return false;
      }
    }
    return false;
  } finally {
    try {
      unlinkSync(own);
    } catch {
      // Already gone.
    }
  }
}

function removeDeadLock(dir: string, pid: number) {
  const aside = join(dir, `watch.pid.dead.${pid}`);
  try {
    renameSync(lockPath(dir), aside);
  } catch {
    // Another starter moved it first; the next attempt decides.
    return true;
  }
  const holder = Number.parseInt(readFileSync(aside, "utf8"), 10);
  if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) {
    try {
      linkSync(aside, lockPath(dir));
    } catch {
      // A third starter holds it now; it is theirs.
    }
    unlinkSync(aside);
    return false;
  }
  unlinkSync(aside);
  return true;
}

export function releaseLock(dir: string, pid = process.pid) {
  try {
    if (readFileSync(lockPath(dir), "utf8").trim() === String(pid))
      unlinkSync(lockPath(dir));
  } catch {
    // Already gone.
  }
}

export function touchTopic(dir: string, topic: string, now = Date.now()) {
  writeFileSync(join(dir, topic), String(now));
}

export function writeStatus(
  dir: string,
  state: RealtimeStatus | "stopped",
  now = Date.now(),
  pid = process.pid,
) {
  writeFileSync(join(dir, "status"), JSON.stringify({ state, pid, at: now }));
}

// Whether the last watcher found the stage without realtime this recently.
export function wasDisabled(dir: string, now = Date.now()) {
  try {
    const status: unknown = JSON.parse(
      readFileSync(join(dir, "status"), "utf8"),
    );
    return (
      typeof status === "object" &&
      status !== null &&
      "state" in status &&
      "at" in status &&
      status.state === "disabled" &&
      typeof status.at === "number" &&
      now - status.at < DISABLED_RECHECK_MS
    );
  } catch {
    return false;
  }
}

// Whether no client has touched the lease for `IDLE_MS`; a missing lease counts
// as idle.
export function isIdle(dir: string, now = Date.now()) {
  try {
    return now - statSync(leasePath(dir)).mtimeMs > IDLE_MS;
  } catch {
    return true;
  }
}

// Stops the running watcher and starts another, which reads the environment
// afresh; nothing starts when none ran. False when the old one didn't stop
// within `waitMs`.
export async function restartWatcher(input: {
  dir: string;
  topics: RealtimeTopic[];
  argv: string[];
  waitMs?: number;
}): Promise<boolean> {
  // A `disabled` status belonged to the environment switched from.
  rmSync(join(input.dir, "status"), { force: true });
  const pid = runningWatcher(input.dir);
  if (pid === null) return true;
  // A lock whose pid now belongs to another program is stale: removed, that
  // program left alone.
  if (!isWatcherProcess(pid)) {
    rmSync(lockPath(input.dir), { force: true });
    return true;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Gone already.
  }
  const deadline = Date.now() + (input.waitMs ?? 3000);
  while (runningWatcher(input.dir) !== null) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  ensureWatcher(input);
  return true;
}

// Whether `pid` runs `realtime watch`, as `ensureWatcher` starts it; false
// when its command line can't be read.
export function isWatcherProcess(pid: number): boolean {
  let command: string;
  try {
    command =
      process.platform === "linux"
        ? readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ")
        : execFileSync("ps", ["-p", String(pid), "-o", "command="], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 2000,
          });
  } catch {
    return false;
  }
  return /\brealtime\s+watch\b/.test(command);
}

// The watcher's environment: the caller's, without `HC_SCOPE`. herdr-core hangs
// up every program still carrying the scope of a mod's `exec` when that exec
// returns, which would end a watcher Herdr's panel started.
export function watcherEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { HC_SCOPE, ...rest } = env;
  return rest;
}

// `--detach`: renews the lease, makes sure the topic files exist, and starts a
// watcher in the background when none runs and the stage was not found
// `disabled` within `DISABLED_RECHECK_MS`, then returns. The child gets its own
// process group so the caller's exit can't take it down.
export function ensureWatcher(input: {
  dir: string;
  topics: RealtimeTopic[];
  // The CLI's own command line minus `--detach`, so `--env` carries over.
  argv: string[];
}): { pid: number | null; started: boolean } {
  touchLease(input.dir);
  // Clients name these files to watch as soon as this returns, before the
  // child has started; one that exists keeps its content.
  for (const topic of input.topics) {
    try {
      writeFileSync(join(input.dir, topic), "", { flag: "wx" });
    } catch {
      // Already there.
    }
  }
  const running = runningWatcher(input.dir);
  if (running !== null) return { pid: running, started: false };
  if (wasDisabled(input.dir)) return { pid: null, started: false };
  const child = spawn(process.execPath, input.argv, {
    detached: true,
    stdio: "ignore",
    env: watcherEnv(process.env),
  });
  child.unref();
  return { pid: child.pid ?? null, started: true };
}

// Holds the socket until it is told to stop or goes idle, and resolves then.
export function watchRealtime(input: {
  dir: string;
  topics: RealtimeTopic[];
  getConnection: () => Promise<unknown>;
  createSocket: (url: string, protocols: string[]) => WebSocket;
  // Resolves when the watcher should stop (a signal); the idle check also stops it.
  stopped?: Promise<void>;
  idleCheckMs?: number;
}): Promise<void> {
  const { dir } = input;
  // A watcher started by hand counts as wanted until clients take over.
  touchLease(dir);
  const topics = new Set(input.topics);
  for (const topic of topics) touchTopic(dir, topic);
  writeStatus(dir, "connecting");

  return new Promise((resolve) => {
    let ended = false;
    let disabled = false;
    const realtime = openRealtime({
      getConnection: async () =>
        RealtimeConnectionResponseSchema.parse(await input.getConnection())
          .connection,
      channels: (connection) => [
        userChannel(connection.userId),
        ...connection.organizationIds.map(organizationChannel),
      ],
      onTopic: (topic) => {
        if (topics.has(topic)) touchTopic(dir, topic);
      },
      // Hints published while the socket was down are gone.
      onResync: () => {
        for (const topic of topics) touchTopic(dir, topic);
      },
      onStatus: (status) => {
        writeStatus(dir, status);
        if (status === "disabled") {
          disabled = true;
          end();
        }
      },
      createSocket: input.createSocket,
    });
    const idle = setInterval(() => {
      if (isIdle(dir)) end();
    }, input.idleCheckMs ?? IDLE_CHECK_MS);
    void input.stopped?.then(end);

    function end() {
      if (ended) return;
      ended = true;
      clearInterval(idle);
      realtime.close();
      // `disabled` stays, so `--detach` starts no watcher for a while (`wasDisabled`).
      if (!disabled) writeStatus(dir, "stopped");
      resolve();
    }
  });
}
