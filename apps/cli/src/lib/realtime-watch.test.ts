import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isRealtimeHint,
  REALTIME_TOPICS,
  realtimeDirOf,
} from "../../claude-plugin/hooks/panel";
import {
  acquireLock,
  BOARD_TOPICS,
  ensureWatcher,
  IDLE_MS,
  isIdle,
  realtimeDir,
  releaseLock,
  restartWatcher,
  runningWatcher,
  touchLease,
  wasDisabled,
  watcherEnv,
  watchRealtime,
} from "./realtime-watch.js";

const scratch = () => mkdtempSync(join(tmpdir(), "clocktopus-realtime-"));

// A process id no process has: above Linux's and macOS's maximum.
const DEAD_PID = 4_194_304 + 7;

class FakeSocket {
  sent: Record<string, unknown>[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    public url: string,
    public protocols: string[],
  ) {}

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const connection = {
  httpHost: "abc.appsync-api.example.test",
  realtimeHost: "abc.appsync-realtime-api.example.test",
  userId: "user-dana",
  organizationIds: ["org-1", "org-2"],
  token: "token-1",
  expiresAt: "2026-11-06T10:05:00.000Z",
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the files the Claude plugin watches", () => {
  it("are the ones the watcher touches, in the folder it uses", () => {
    expect(REALTIME_TOPICS).toEqual(BOARD_TOPICS);
    expect(realtimeDirOf(homedir())).toBe(realtimeDir());
    expect(isRealtimeHint(`${realtimeDir()}/tasks`, homedir())).toBe(true);
    expect(isRealtimeHint(`${realtimeDir()}/status`, homedir())).toBe(false);
  });
});

describe("ensureWatcher", () => {
  it("renews the lease and leaves a running watcher be, creating the topic files clients watch", () => {
    const dir = scratch();
    acquireLock(dir, process.pid);
    writeFileSync(join(dir, "tasks"), "kept");

    expect(
      ensureWatcher({ dir, topics: ["tasks", "pull-requests"], argv: [] }),
    ).toEqual({ pid: process.pid, started: false });
    expect(isIdle(dir)).toBe(false);
    expect(readFileSync(join(dir, "tasks"), "utf8")).toBe("kept");
    expect(readFileSync(join(dir, "pull-requests"), "utf8")).toBe("");
    releaseLock(dir, process.pid);
  });
});

describe("watcherEnv", () => {
  it("leaves out herdr-core's exec scope, so the watcher outlives the mod call that started it", () => {
    expect(
      watcherEnv({
        PATH: "/usr/bin",
        HC_SCOPE: "scope-1",
        HC_TERMINAL_ID: "t3",
      }),
    ).toEqual({ PATH: "/usr/bin", HC_TERMINAL_ID: "t3" });
  });
});

describe("a stage without realtime", () => {
  it("keeps --detach from starting a watcher for an hour after one found it disabled", () => {
    const dir = scratch();
    const now = Date.now();
    writeFileSync(
      join(dir, "status"),
      JSON.stringify({ state: "disabled", pid: 1, at: now - 1000 }),
    );

    expect(wasDisabled(dir, now)).toBe(true);
    expect(ensureWatcher({ dir, topics: ["tasks"], argv: [] })).toEqual({
      pid: null,
      started: false,
    });
    expect(wasDisabled(dir, now + 61 * 60 * 1000)).toBe(false);
  });
});

describe("the watcher lock", () => {
  it("lets one watcher hold it, and takes over one a dead watcher left", () => {
    const dir = scratch();

    expect(acquireLock(dir, process.pid)).toBe(true);
    expect(runningWatcher(dir)).toBe(process.pid);
    expect(acquireLock(dir, 1234)).toBe(false);

    releaseLock(dir, process.pid);
    expect(runningWatcher(dir)).toBeNull();

    writeFileSync(join(dir, "watch.pid"), String(DEAD_PID));
    expect(runningWatcher(dir)).toBeNull();
    expect(acquireLock(dir, process.pid)).toBe(true);
    releaseLock(dir, process.pid);
  });
});

describe("isIdle", () => {
  it("goes idle once no client has touched the lease for the idle time", () => {
    const dir = scratch();
    expect(isIdle(dir)).toBe(true);

    touchLease(dir);
    expect(isIdle(dir)).toBe(false);

    const old = (Date.now() - IDLE_MS - 1000) / 1000;
    utimesSync(join(dir, "lease"), old, old);
    expect(isIdle(dir)).toBe(true);
  });
});

describe("watchRealtime", () => {
  it("subscribes to the user's and each organisation's channel and touches a topic's file on its hint", async () => {
    const dir = scratch();
    touchLease(dir);
    const sockets: FakeSocket[] = [];
    let stop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });

    const run = watchRealtime({
      dir,
      topics: ["tasks", "pull-requests"],
      getConnection: () => Promise.resolve({ connection }),
      createSocket: (url, protocols) => {
        const socket = new FakeSocket(url, protocols);
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      stopped,
    });
    await settle();
    const socket = sockets[0]!;
    socket.onopen?.();
    socket.receive({ type: "connection_ack", connectionTimeoutMs: 300_000 });

    expect(
      socket.sent.filter((m) => m.type === "subscribe").map((m) => m.channel),
    ).toEqual(["/user/user-dana", "/org/org-1", "/org/org-2"]);

    socket.receive({ type: "subscribe_success" });
    socket.receive({ type: "subscribe_success" });
    socket.receive({ type: "subscribe_success" });
    expect(JSON.parse(readFileSync(join(dir, "status"), "utf8")).state).toBe(
      "connected",
    );

    writeFileSync(join(dir, "tasks"), "before");
    writeFileSync(join(dir, "pull-requests"), "before");
    socket.receive({
      type: "data",
      event: JSON.stringify({ v: 1, topic: "tasks" }),
    });
    socket.receive({
      type: "data",
      event: JSON.stringify({ v: 1, topic: "clock-signals" }),
    });

    expect(readFileSync(join(dir, "tasks"), "utf8")).not.toBe("before");
    expect(readFileSync(join(dir, "pull-requests"), "utf8")).toBe("before");

    stop();
    await run;
    expect(socket.closed).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "status"), "utf8")).state).toBe(
      "stopped",
    );
  });

  it("stops and says so on a stage with no Events API", async () => {
    const dir = scratch();
    touchLease(dir);

    await watchRealtime({
      dir,
      topics: ["tasks"],
      getConnection: () => Promise.resolve({ connection: null }),
      createSocket: () => {
        throw new Error("no socket on a disabled stage");
      },
    });

    expect(JSON.parse(readFileSync(join(dir, "status"), "utf8")).state).toBe(
      "disabled",
    );
  });

  it("counts a watcher started by hand as wanted, and stops once no client has renewed the lease", async () => {
    const dir = scratch();

    const run = watchRealtime({
      dir,
      topics: ["tasks"],
      getConnection: () => new Promise(() => undefined),
      createSocket: () => {
        throw new Error("never connects");
      },
      idleCheckMs: 5,
    });
    expect(isIdle(dir)).toBe(false);
    await settle();
    const old = (Date.now() - IDLE_MS - 1000) / 1000;
    utimesSync(join(dir, "lease"), old, old);
    await run;

    expect(JSON.parse(readFileSync(join(dir, "status"), "utf8")).state).toBe(
      "stopped",
    );
  });
});

describe("restartWatcher", () => {
  it("stops the running watcher, forgets a disabled status and starts another", async () => {
    const dir = scratch();
    const old = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 30000)",
      "realtime",
      "watch",
    ]);
    const exited = new Promise((resolve) => old.once("exit", resolve));
    await once(old, "spawn");
    writeFileSync(join(dir, "watch.pid"), String(old.pid));
    writeFileSync(
      join(dir, "status"),
      JSON.stringify({ state: "disabled", pid: old.pid, at: Date.now() }),
    );

    const restarted = await restartWatcher({
      dir,
      topics: BOARD_TOPICS,
      argv: ["-e", ""],
    });

    expect(restarted).toBe(true);
    await exited;
    expect(existsSync(join(dir, "status"))).toBe(false);
    expect(existsSync(join(dir, "lease"))).toBe(true);
  });

  it("leaves alone a program that took a dead watcher's pid, and drops its lock", async () => {
    const dir = scratch();
    const other = spawn(process.execPath, [
      "-e",
      "setTimeout(() => {}, 30000)",
    ]);
    try {
      await once(other, "spawn");
      writeFileSync(join(dir, "watch.pid"), String(other.pid));

      expect(
        await restartWatcher({ dir, topics: BOARD_TOPICS, argv: ["-e", ""] }),
      ).toBe(true);

      expect(other.exitCode).toBeNull();
      expect(other.signalCode).toBeNull();
      expect(existsSync(join(dir, "watch.pid"))).toBe(false);
      expect(existsSync(join(dir, "lease"))).toBe(false);
    } finally {
      other.kill();
    }
  });

  it("starts nothing when no watcher ran", async () => {
    const dir = scratch();
    expect(
      await restartWatcher({ dir, topics: BOARD_TOPICS, argv: ["-e", ""] }),
    ).toBe(true);
    expect(existsSync(join(dir, "lease"))).toBe(false);
  });
});
