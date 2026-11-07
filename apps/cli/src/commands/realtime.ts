import { get } from "../lib/api.js";
import { isLoggedIn } from "../lib/config.js";
import {
  acquireLock,
  BOARD_TOPICS,
  ensureWatcher,
  realtimeDir,
  releaseLock,
  runningWatcher,
  watchRealtime,
} from "../lib/realtime-watch.js";

export type RealtimeWatchOptions = { detach?: boolean };

export async function realtimeWatchCommand(
  options: RealtimeWatchOptions,
): Promise<void> {
  const dir = realtimeDir();
  if (!isLoggedIn()) {
    console.error("Not logged in. Run 'clocktopus login' first.");
    process.exit(1);
  }

  if (options.detach) {
    const argv = process.argv.slice(1).filter((arg) => arg !== "--detach");
    const { pid, started } = ensureWatcher({
      dir,
      topics: BOARD_TOPICS,
      argv,
    });
    console.log(JSON.stringify({ pid, started, dir }));
    return;
  }

  if (typeof WebSocket === "undefined") {
    console.error("clocktopus realtime watch needs Node 22 or newer.");
    process.exit(1);
  }
  if (!acquireLock(dir)) {
    console.log(`A watcher already runs (pid ${runningWatcher(dir)}).`);
    return;
  }

  const stopped = new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  try {
    await watchRealtime({
      dir,
      topics: BOARD_TOPICS,
      getConnection: () => get("/api/realtime/connection"),
      createSocket: (url, protocols) => new WebSocket(url, protocols),
      stopped,
    });
  } finally {
    releaseLock(dir);
  }
}
