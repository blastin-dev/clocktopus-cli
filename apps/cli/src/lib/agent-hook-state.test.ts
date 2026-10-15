import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { subDays } from "date-fns";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearHookState,
  readCodexSpendCursor,
  writeCodexSpendCursor,
} from "./agent-hook-state";

let home: string;
const previousHome = process.env.HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "clocktopus-hook-state-"));
  process.env.HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

const cursorPath = (sessionId: string) =>
  join(home, ".cache", "clocktopus", "codex-spend", `${sessionId}.json`);

describe("Codex spend cursors", () => {
  it("survive clearing the hook state", () => {
    writeCodexSpendCursor("s-1", { tokenCounts: 3, turns: 1 });

    clearHookState();

    expect(readCodexSpendCursor("s-1")).toEqual({ tokenCounts: 3, turns: 1 });
  });

  it("are null for a session with none", () => {
    expect(readCodexSpendCursor("s-1")).toBeNull();
  });

  it("are pruned once untouched for 90 days", () => {
    writeCodexSpendCursor("stale", { tokenCounts: 1, turns: 1 });
    writeCodexSpendCursor("recent", { tokenCounts: 1, turns: 1 });
    const stale = subDays(new Date(), 91);
    utimesSync(cursorPath("stale"), stale, stale);
    const recent = subDays(new Date(), 89);
    utimesSync(cursorPath("recent"), recent, recent);

    writeCodexSpendCursor("current", { tokenCounts: 1, turns: 0 });

    expect(existsSync(cursorPath("stale"))).toBe(false);
    expect(existsSync(cursorPath("recent"))).toBe(true);
    expect(existsSync(cursorPath("current"))).toBe(true);
  });
});
