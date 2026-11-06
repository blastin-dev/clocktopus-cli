import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RealtimeConnection } from "./realtime";
import { openRealtime } from "./realtime-client";

class FakeSocket {
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    public url: string,
    public protocols: Array<string>,
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

  subscribeIds() {
    return this.sent
      .filter((m) => m.type === "subscribe")
      .map((m) => m.id as string);
  }
}

const connection = (token: string): RealtimeConnection => ({
  httpHost: "abc.appsync-api.ap-southeast-2.amazonaws.com",
  realtimeHost: "abc.appsync-realtime-api.ap-southeast-2.amazonaws.com",
  userId: "user-maya",
  organizationIds: [],
  token,
  expiresAt: "2026-09-26T09:05:00.000Z",
});

let sockets: Array<FakeSocket>;

function start(
  overrides: Partial<Parameters<typeof openRealtime>[0]> = {},
  tokens = ["token-1", "token-2", "token-3"],
) {
  const handlers = {
    onTopic: vi.fn(),
    onResync: vi.fn(),
    onStatus: vi.fn(),
  };
  let call = 0;
  const realtime = openRealtime({
    getConnection: () =>
      Promise.resolve(connection(tokens[call++] ?? "token-x")),
    channels: (c) => [`/user/${c.userId}`, "/org/org-acme"],
    createSocket: (url, protocols) => {
      const socket = new FakeSocket(url, protocols);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    random: () => 0,
    ...handlers,
    ...overrides,
  });
  return { realtime, ...handlers };
}

function openAndSubscribe(socket: FakeSocket) {
  socket.onopen?.();
  socket.receive({ type: "connection_ack", connectionTimeoutMs: 300_000 });
  for (const id of socket.subscribeIds()) {
    socket.receive({ type: "subscribe_success", id });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("openRealtime", () => {
  it("connects with the token in the subprotocol and subscribes after the ack", async () => {
    const { onStatus } = start();
    await vi.runOnlyPendingTimersAsync();
    const socket = sockets[0]!;

    expect(socket.url).toBe(
      "wss://abc.appsync-realtime-api.ap-southeast-2.amazonaws.com/event/realtime",
    );
    expect(socket.protocols[0]).toBe("aws-appsync-event-ws");
    const header = socket.protocols[1]!.replace("header-", "");
    const decoded = JSON.parse(
      atob(header.replace(/-/g, "+").replace(/_/g, "/")),
    );
    expect(decoded).toEqual({
      host: "abc.appsync-api.ap-southeast-2.amazonaws.com",
      Authorization: "token-1",
    });

    openAndSubscribe(socket);
    expect(
      socket.sent.filter((m) => m.type === "subscribe").map((m) => m.channel),
    ).toEqual(["/user/user-maya", "/org/org-acme"]);
    expect(onStatus).toHaveBeenLastCalledWith("connected");
  });

  it("passes each topic it receives to onTopic and ignores anything else", async () => {
    const { onTopic } = start();
    await vi.runOnlyPendingTimersAsync();
    const socket = sockets[0]!;
    openAndSubscribe(socket);

    socket.receive({
      type: "data",
      event: JSON.stringify({ v: 1, topic: "time-entries" }),
    });
    socket.receive({
      type: "data",
      event: JSON.stringify({ v: 1, topic: "nope" }),
    });
    socket.receive({ type: "data", event: "not json" });

    expect(onTopic).toHaveBeenCalledTimes(1);
    expect(onTopic).toHaveBeenCalledWith("time-entries");
  });

  it("reconnects with a fresh token after a drop, and resyncs once back", async () => {
    const { onResync, onStatus } = start();
    await vi.runOnlyPendingTimersAsync();
    openAndSubscribe(sockets[0]!);
    expect(onResync).not.toHaveBeenCalled();

    sockets[0]!.close();
    expect(onStatus).toHaveBeenLastCalledWith("offline");

    await vi.advanceTimersByTimeAsync(1_000);
    const second = sockets[1]!;
    expect(second.protocols[1]).not.toBe(sockets[0]!.protocols[1]);

    openAndSubscribe(second);
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("stops trying when the stage has no Events API", async () => {
    const { onStatus } = start({
      getConnection: () => Promise.resolve(null),
    });
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets).toHaveLength(0);
    expect(onStatus).toHaveBeenLastCalledWith("disabled");
  });

  it("treats a missed keep-alive as a dead socket", async () => {
    start();
    await vi.runOnlyPendingTimersAsync();
    const socket = sockets[0]!;
    openAndSubscribe(socket);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(socket.closed).toBe(true);
  });

  it("closes the socket and never reconnects after close()", async () => {
    const { realtime } = start();
    await vi.runOnlyPendingTimersAsync();
    openAndSubscribe(sockets[0]!);

    realtime.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sockets[0]!.closed).toBe(true);
    expect(sockets).toHaveLength(1);
  });
});
