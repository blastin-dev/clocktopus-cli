import { z } from "zod";

import type { RealtimeConnection, RealtimeTopic } from "./realtime";
import { RealtimeMessageSchema } from "./realtime";

// The AppSync Events client the web app and the CLI's `realtime watch` share. It
// takes its socket factory, so it runs on a browser's `WebSocket` and Node's.

// `disabled`: the stage has no Events API, so nothing will ever connect.
export type RealtimeStatus =
  | "connecting"
  | "connected"
  | "offline"
  | "disabled";

const MAX_BACKOFF_MS = 30_000;
// AppSync sends it in `connection_ack`; this is its documented value.
const DEFAULT_CONNECTION_TIMEOUT_MS = 300_000;

// What AppSync sends on the socket, as far as this client reads it; other
// fields are dropped.
const ServerMessageSchema = z.object({
  type: z.string().optional(),
  connectionTimeoutMs: z.number().optional(),
  event: z.unknown().optional(),
});
type ServerMessage = z.infer<typeof ServerMessageSchema>;

// The AppSync Events handshake carries the authorization in a subprotocol,
// base64url-encoded, because a browser cannot set headers on a WebSocket.
function authorizationProtocol(connection: RealtimeConnection) {
  const header = JSON.stringify({
    host: connection.httpHost,
    Authorization: connection.token,
  });
  const encoded = btoa(header)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header-${encoded}`;
}

function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== "string") return null;
  try {
    const parsed = ServerMessageSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseTopic(event: unknown): RealtimeTopic | null {
  let value = event;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const message = RealtimeMessageSchema.safeParse(value);
  return message.success ? message.data.topic : null;
}

// Keeps one socket open to the given channels until `close()`: every attempt
// fetches a fresh token, a missed keep-alive counts as a dead socket, and
// failures retry with jittered exponential backoff.
export function openRealtime(options: {
  getConnection: () => Promise<RealtimeConnection | null>;
  channels: (connection: RealtimeConnection) => Array<string>;
  onTopic: (topic: RealtimeTopic) => void;
  // After a reconnect: whatever was published while the socket was down is
  // gone, so the caller refetches everything.
  onResync: () => void;
  onStatus: (status: RealtimeStatus) => void;
  createSocket?: (url: string, protocols: Array<string>) => WebSocket;
  random?: () => number;
}) {
  const createSocket =
    options.createSocket ??
    ((url: string, protocols: Array<string>) => new WebSocket(url, protocols));
  const random = options.random ?? Math.random;

  let closed = false;
  let socket: WebSocket | null = null;
  let attempt = 0;
  let connectedBefore = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
  let connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS;

  function clearKeepAlive() {
    if (keepAliveTimer) clearTimeout(keepAliveTimer);
    keepAliveTimer = null;
  }

  function armKeepAlive(ws: WebSocket) {
    clearKeepAlive();
    keepAliveTimer = setTimeout(() => ws.close(), connectionTimeoutMs);
  }

  function scheduleRetry() {
    if (closed || retryTimer) return;
    const ceiling = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
    attempt += 1;
    const delay = ceiling / 2 + random() * (ceiling / 2);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  }

  async function connect() {
    if (closed || socket) return;
    options.onStatus("connecting");

    let connection: RealtimeConnection | null;
    try {
      connection = await options.getConnection();
    } catch {
      options.onStatus("offline");
      scheduleRetry();
      return;
    }
    if (closed) return;
    if (!connection) {
      options.onStatus("disabled");
      return;
    }

    const channels = options.channels(connection);
    const authorization = {
      host: connection.httpHost,
      Authorization: connection.token,
    };
    const ws = createSocket(`wss://${connection.realtimeHost}/event/realtime`, [
      "aws-appsync-event-ws",
      authorizationProtocol(connection),
    ]);
    socket = ws;
    let subscribed = 0;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "connection_init" }));
    };

    ws.onmessage = (event: MessageEvent) => {
      const message = parseServerMessage(event.data);
      if (!message) return;

      switch (message.type) {
        case "connection_ack":
          connectionTimeoutMs =
            message.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS;
          armKeepAlive(ws);
          for (const channel of channels) {
            ws.send(
              JSON.stringify({
                type: "subscribe",
                id: crypto.randomUUID(),
                channel,
                authorization,
              }),
            );
          }
          break;
        case "ka":
          armKeepAlive(ws);
          break;
        case "subscribe_success":
          subscribed += 1;
          if (subscribed === channels.length) {
            attempt = 0;
            options.onStatus("connected");
            if (connectedBefore) options.onResync();
            connectedBefore = true;
          }
          break;
        case "data": {
          const topic = parseTopic(message.event);
          if (topic) options.onTopic(topic);
          break;
        }
        case "subscribe_error":
        case "connection_error":
        case "error":
          ws.close();
          break;
      }
    };

    ws.onerror = () => ws.close();

    ws.onclose = () => {
      clearKeepAlive();
      if (socket !== ws) return;
      socket = null;
      if (closed) return;
      options.onStatus("offline");
      scheduleRetry();
    };
  }

  void connect();

  return {
    // Skips the backoff wait, e.g. when the browser comes back online.
    reconnectNow() {
      if (closed || socket) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      attempt = 0;
      void connect();
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      clearKeepAlive();
      socket?.close();
      socket = null;
    },
  };
}
