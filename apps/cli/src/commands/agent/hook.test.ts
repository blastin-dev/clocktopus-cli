import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hookCommand } from "./hook";

// The real ones would write the developer's own CLI config, and start
// `agent refresh` from the test runner's script.
const { refreshIfUpgraded, rememberLatestVersion } = vi.hoisted(() => ({
  refreshIfUpgraded: vi.fn(),
  rememberLatestVersion: vi.fn(),
}));
vi.mock("../../lib/agent-refresh.js", () => ({ refreshIfUpgraded }));
vi.mock("../../lib/config.js", () => ({ rememberLatestVersion }));

const ENDPOINT = "https://otel.example.com";
const TOKEN = "ctop_agt_testtoken";
const CODEX_SESSION = "0e5d7c1a-4b2f-7a90-9c3e-5f1b2d8a6e47";
const FIXTURE = join(
  import.meta.dirname,
  "..",
  "..",
  "lib",
  "__fixtures__",
  "codex-0.162.1-rollout.jsonl",
);

const ENV_KEYS = [
  "HOME",
  "CODEX_HOME",
  "CLOCKTOPUS_INGEST_TOKEN",
  "CLOCKTOPUS_OTEL_ENDPOINT",
  "CLOCKTOPUS_HOOK_DRY_RUN",
] as const;
const previous = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);
const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin")!;

let home: string;
let repo: string;
let fetch: ReturnType<typeof vi.fn>;
let stdout: ReturnType<typeof vi.spyOn>;
let stderr: string[];

const stateDir = () => join(home, ".cache", "clocktopus", "agent-sessions");

function pipe(payload: unknown) {
  Object.defineProperty(process, "stdin", {
    value: Readable.from([Buffer.from(JSON.stringify(payload))]),
    configurable: true,
  });
}

// Every file under the cache with its contents, to compare before and after a run.
function snapshotState(): Record<string, string> {
  const dir = join(home, ".cache", "clocktopus");
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [path, readFileSync(path, "utf8")];
      }),
  );
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "clocktopus-hook-"));
  process.env.HOME = home;
  process.env.CODEX_HOME = join(home, ".codex");
  process.env.CLOCKTOPUS_INGEST_TOKEN = TOKEN;
  process.env.CLOCKTOPUS_OTEL_ENDPOINT = ENDPOINT;
  process.env.CLOCKTOPUS_HOOK_DRY_RUN = "1";
  refreshIfUpgraded.mockClear();
  rememberLatestVersion.mockClear();

  repo = join(home, "code", "acme-portal");
  mkdirSync(repo, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git(
    "-c",
    "user.name=Dana Example",
    "-c",
    "user.email=dana@example.com",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );

  fetch = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(process, "stdin", originalStdin);
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

// Each printed request is a `POST <url>` line followed by its JSON body.
function printedRequests() {
  const lines = stderr.join("").split("\n");
  return lines.flatMap((line, index) =>
    line.startsWith("POST ")
      ? [{ url: line.slice(5), body: JSON.parse(lines[index + 1]!) }]
      : [],
  );
}

describe("agent hook dry run", () => {
  it("prints the session body instead of sending it, writes no state and nothing to stdout", async () => {
    pipe({ hook_event_name: "SessionStart", session_id: "s-1", cwd: repo });

    await hookCommand({ provider: "claude_code" });

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(snapshotState()).toEqual({});

    const [request, ...rest] = printedRequests();
    expect(rest).toEqual([]);
    expect(request!.url).toBe(`${ENDPOINT}/v1/agent-session`);
    expect(request!.body).toMatchObject({
      provider: "claude_code",
      session_id: "s-1",
      hook_event_name: "SessionStart",
      cwd: "~/code/acme-portal",
      git_branch: "main",
    });
    expect(stderr.join("")).not.toContain(TOKEN);
  });

  it("keeps the recorded start, and the sweep's abandoned sessions, for the real run", async () => {
    mkdirSync(stateDir(), { recursive: true });
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    writeFileSync(
      join(stateDir(), "s-1.sha"),
      JSON.stringify({ sha: head, cwd: repo, provider: "claude_code" }),
    );
    const abandoned = join(stateDir(), "s-0.sha");
    writeFileSync(
      abandoned,
      JSON.stringify({ sha: head, cwd: repo, provider: "claude_code" }),
    );
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    utimesSync(abandoned, dayAgo, dayAgo);
    const before = snapshotState();

    pipe({ hook_event_name: "SessionEnd", session_id: "s-1", cwd: repo });
    await hookCommand({ provider: "claude_code" });
    pipe({ hook_event_name: "SessionStart", session_id: "s-2", cwd: repo });
    await hookCommand({ provider: "claude_code" });

    expect(fetch).not.toHaveBeenCalled();
    expect(snapshotState()).toEqual(before);
    expect(
      printedRequests().map(({ body }) => [
        body.session_id,
        body.hook_event_name,
        body.reason,
      ]),
    ).toEqual([
      ["s-1", "SessionEnd", undefined],
      ["s-2", "SessionStart", undefined],
      ["s-0", "SessionEnd", "abandoned"],
    ]);
  });

  it("prints Codex's spend report in the foreground and leaves its cursor where it was", async () => {
    // A session with no cursor sends only recent rollout lines.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-10-14T12:00:00Z"),
    });
    const day = join(home, ".codex", "sessions", "2026", "10", "14");
    mkdirSync(day, { recursive: true });
    copyFileSync(
      FIXTURE,
      join(day, `rollout-2026-10-14T09-12-04-${CODEX_SESSION}.jsonl`),
    );
    const printed = join(home, "hook-dry-run.txt");
    process.env.CLOCKTOPUS_HOOK_DRY_RUN = printed;

    pipe({
      hook_event_name: "SessionEnd",
      session_id: CODEX_SESSION,
      cwd: repo,
    });
    await hookCommand({ provider: "codex_cli" });

    expect(fetch).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(snapshotState()).toEqual({});

    const lines = readFileSync(printed, "utf8").split("\n");
    expect(lines.filter((line) => line.startsWith("POST "))).toEqual([
      `POST ${ENDPOINT}/v1/traces`,
      `POST ${ENDPOINT}/v1/agent-session`,
    ]);
    expect(JSON.parse(lines[1]!).resourceSpans).toHaveLength(1);
  });

  it("says why nothing is sent when there is no token", async () => {
    delete process.env.CLOCKTOPUS_INGEST_TOKEN;
    pipe({ hook_event_name: "SessionStart", session_id: "s-1", cwd: repo });

    await hookCommand({ provider: "claude_code" });

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toMatch(/^# no ingest token/);
  });

  it("is on for the --dry-run flag without the variable", async () => {
    delete process.env.CLOCKTOPUS_HOOK_DRY_RUN;
    pipe({ hook_event_name: "SessionStart", session_id: "s-1", cwd: repo });

    await hookCommand({ provider: "claude_code", dryRun: true });

    expect(fetch).not.toHaveBeenCalled();
    expect(printedRequests()).toHaveLength(1);
  });

  it("sends, and records the start, when off", async () => {
    delete process.env.CLOCKTOPUS_HOOK_DRY_RUN;
    pipe({ hook_event_name: "SessionStart", session_id: "s-1", cwd: repo });

    await hookCommand({ provider: "claude_code" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(stderr).toEqual([]);
    expect(existsSync(join(stateDir(), "s-1.sha"))).toBe(true);
  });

  it("remembers the newest CLI the receiver names and refreshes after an upgrade", async () => {
    delete process.env.CLOCKTOPUS_HOOK_DRY_RUN;
    fetch.mockResolvedValue(
      new Response("{}", {
        status: 202,
        headers: { "X-Clocktopus-Cli-Latest": "0.10.0" },
      }),
    );
    pipe({ hook_event_name: "SessionStart", session_id: "s-1", cwd: repo });

    await hookCommand({ provider: "claude_code" });

    expect(rememberLatestVersion).toHaveBeenCalledWith("0.10.0");
    expect(refreshIfUpgraded).toHaveBeenCalledTimes(1);
  });

  it("neither remembers nor refreshes on a dry run", async () => {
    pipe({ hook_event_name: "SessionStart", session_id: "s-1", cwd: repo });

    await hookCommand({ provider: "claude_code" });

    expect(rememberLatestVersion).not.toHaveBeenCalled();
    expect(refreshIfUpgraded).not.toHaveBeenCalled();
  });
});
