import { execFileSync, spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";

import type { AgentAdapter, AgentProviderId } from "../../lib/agents.js";
import type { HookDryRun } from "../../lib/hook-request.js";
import { maskToken, resolveAgentCredentials } from "../../lib/agent-config.js";
import {
  clearStartState,
  listStartStates,
  readStartState,
  recordLastRun,
  writeStartState,
} from "../../lib/agent-hook-state.js";
import { AGENTS } from "../../lib/agents.js";
import {
  buildReflogArgs,
  parseReflogCommits,
} from "../../lib/declared-commits.js";
import { getRepositoryRemotes } from "../../lib/git.js";
import { homeRelativePath } from "../../lib/home-relative-path.js";
import { readHookPayload } from "../../lib/hook-payload.js";
import {
  noteHookDryRun,
  postHookRequest,
  readHookDryRun,
} from "../../lib/hook-request.js";

// Every agent pipes hook JSON to stdin and nothing in it names the sender,
// hence `--provider`. It is the only source of `cwd` in the pipeline, so without this
// hook a session cannot be attributed to a repository.
//
// Contract with the host: never write to stdout (Claude Code parses it), never throw,
// always exit 0.
//
// Codex skips an async SessionStart on 0.147 and clamps SessionEnd to 3s, less than
// `TIMEOUT_MS` in `lib/hook-request.ts`, so hosts without `hostRunsHooksAsync` get no `async` key and this
// command backgrounds itself through `detachSelf`.
//
// A dry run (`--dry-run`, `CLOCKTOPUS_HOOK_DRY_RUN`) prints each request instead of
// sending it, runs in the foreground so the output is not lost with a detached
// child, and writes no state a real run would.

// A state file outlives SessionEnd only when the session died without one; this sits
// well past a working day because long sessions are normal.
const ABANDONED_AFTER_MS = 12 * 60 * 60 * 1000;

/** Bound on one sweep, so a directory left full of state cannot stall a start. */
const MAX_SWEEP_PER_RUN = 10;

type SessionBody = {
  provider: AgentProviderId;
  session_id: string;
  hook_event_name: string;
  // Home-relative (`homeRelativePath`); git and the state file keep the absolute path.
  cwd: string;
  source?: string;
  reason?: string;
  ended_at?: string;
  repository_url?: string;
  git_branch?: string;
  repository_urls?: string[];
  git_head_before?: string;
  git_head_after?: string;
  commit_shas?: string[];
  duration_ms?: number;
};

// Empty when the session's start was never recorded — see `buildReflogArgs`.
function declaredCommits(
  cwd: string,
  startedAt: string | undefined,
  until?: string,
): string[] {
  const args = buildReflogArgs({ startedAt, until });
  if (!args) return [];
  return parseReflogCommits(git(cwd, args));
}

// The state file's mtime bounds the window only for hosts that rewrite it on every
// SessionEnd; elsewhere it equals `startedAt`, so the sweep declares nothing and
// leaves those sessions to the server's `linkCommitsByTimeWindow`.
function sweptCommits(
  state: { cwd: string; provider?: string; startedAt?: string },
  lastActivityAt: Date,
): string[] {
  const host = AGENTS.find((agent) => agent.provider === state.provider);
  if (!host?.hostRepeatsSessionEnd) return [];

  return declaredCommits(
    state.cwd,
    state.startedAt,
    lastActivityAt.toISOString(),
  );
}

function declaredShasFor(shas: string[]) {
  return shas.length > 0 ? { commit_shas: shas } : {};
}

function remotesFor(cwd: string) {
  const remotes = getRepositoryRemotes(cwd);
  return { repository_url: remotes[0], repository_urls: remotes };
}

function git(cwd: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return undefined;
  }
}

// Closes sessions that never received a SessionEnd, which otherwise keep a null
// `ended_at` and `git_head_after`. It runs when the next session starts, possibly a
// day later, so it sends its own `ended_at`.
async function sweepAbandonedSessions(
  endpoint: string,
  token: string,
  currentSessionId: string,
  fallbackProvider: AgentProviderId,
  dryRun: HookDryRun | null,
): Promise<void> {
  const clear = (sessionId: string) => {
    if (!dryRun) clearStartState(sessionId);
  };

  let swept = 0;

  for (const { sessionId, ageMs, lastActivityAt } of listStartStates()) {
    if (swept >= MAX_SWEEP_PER_RUN) return;
    if (sessionId === currentSessionId) continue;
    if (ageMs < ABANDONED_AFTER_MS) continue;

    swept++;

    const state = readStartState(sessionId);
    // Without the originating checkout the SHA would resolve against an unrelated
    // repository.
    if (!state?.cwd) {
      clear(sessionId);
      continue;
    }

    // Already ended; sweeping would replace its real end with this moment's HEAD.
    if (state.closed) {
      clear(sessionId);
      continue;
    }

    // A session that never reached SessionEnd has spend its last report missed.
    await AGENTS.find(
      (agent) => agent.provider === state.provider,
    )?.reportSpend?.({
      endpoint,
      token,
      sessionId,
      transcriptPath: null,
      dryRun,
    });

    const head = git(state.cwd, ["rev-parse", "HEAD"]);
    if (head) {
      await postHookRequest({
        endpoint,
        path: "/v1/agent-session",
        token,
        dryRun,
        body: {
          // The agent that opened the session, not the one sweeping it, or the end lands
          // on a duplicate row under the wrong provider.
          provider: readProvider(state.provider) ?? fallbackProvider,
          session_id: sessionId,
          hook_event_name: "SessionEnd",
          cwd: homeRelativePath(state.cwd),
          reason: "abandoned",
          // The receiver keeps a telemetry-stamped end over this one.
          ended_at: lastActivityAt.toISOString(),
          // No `git_branch`: the receiver lets any non-null value win, and the current
          // branch would overwrite the one SessionStart recorded.
          ...remotesFor(state.cwd),
          ...declaredShasFor(
            // Spread so the `state.cwd` guard above narrows.
            sweptCommits(
              {
                cwd: state.cwd,
                provider: state.provider,
                startedAt: state.startedAt,
              },
              lastActivityAt,
            ),
          ),
          git_head_before: state.sha,
          git_head_after: head,
        } satisfies SessionBody,
      });
    }

    clear(sessionId);
  }
}

// Null for an unknown or missing provider; the caller supplies the fallback.
function readProvider(value: string | undefined): AgentProviderId | null {
  const match = AGENTS.find((agent) => agent.provider === value);
  return match?.provider ?? null;
}

// `detached: true` gives the child its own process group, so the host tearing down the
// session's group at SessionEnd cannot kill the POST. The parent exits right after, so
// it must wait for `stdin.end` to flush.
function detachSelf(
  provider: AgentProviderId,
  payload: string,
): Promise<boolean> {
  const script = process.argv[1] ? resolvePath(process.argv[1]) : null;
  if (!script) return Promise.resolve(false);

  try {
    const child = spawn(
      process.execPath,
      [script, "agent", "hook", "--provider", provider, "--detached"],
      { detached: true, stdio: ["pipe", "ignore", "ignore"] },
    );
    child.unref();

    return new Promise((settle) => {
      child.once("error", () => settle(false));
      child.stdin.once("error", () => settle(false));
      child.stdin.end(payload, () => settle(true));
    });
  } catch {
    return Promise.resolve(false);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function run(
  agent: AgentAdapter,
  detached: boolean,
  dryRun: HookDryRun | null,
): Promise<void> {
  const { token, endpoint } = resolveAgentCredentials(agent.id);
  if (!token || !endpoint) {
    noteHookDryRun(dryRun, "no ingest token or endpoint, so nothing is sent");
    return;
  }

  const raw = await readStdin();
  if (!raw) {
    noteHookDryRun(dryRun, "no hook payload on stdin, so nothing is sent");
    return;
  }

  // After the empty-stdin check: `agent doctor` probes the hook with no payload, and
  // that probe must not leave a process behind.
  if (!agent.hostRunsHooksAsync && !detached && !dryRun) {
    if (await detachSelf(agent.provider, raw)) return;
  }

  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    noteHookDryRun(dryRun, "the hook payload is not JSON, so nothing is sent");
    return;
  }

  const {
    sessionId,
    cwd,
    eventName,
    durationMs,
    source,
    reason,
    transcriptPath,
  } = readHookPayload(input, process.env.CURSOR_PROJECT_DIR);
  if (!sessionId || !cwd) {
    noteHookDryRun(
      dryRun,
      "the hook payload has no session id or cwd, so nothing is sent",
    );
    return;
  }

  // Before the session's own event: a spend report sets the session's end to its last
  // turn, which SessionEnd must then overwrite, not the other way round.
  await agent.reportSpend?.({
    endpoint,
    token,
    sessionId,
    transcriptPath,
    dryRun,
  });

  const isSessionStart = eventName === "SessionStart";

  // HEAD is `git_head_before` at SessionStart and `git_head_after` at SessionEnd, so
  // SessionEnd cannot overwrite the start SHA.
  const head = git(cwd, ["rev-parse", "HEAD"]);

  const body: SessionBody = {
    provider: agent.provider,
    session_id: sessionId,
    hook_event_name: eventName,
    cwd: homeRelativePath(cwd),
    source,
    reason,
    ...remotesFor(cwd),
    git_branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    ...(isSessionStart ? { git_head_before: head } : { git_head_after: head }),
    ...(!isSessionStart && durationMs !== null
      ? { duration_ms: durationMs }
      : {}),
  };

  // Commits resolve here because the receiver has no reflog; SessionStart and
  // SessionEnd are separate processes, so the start is kept in a state file.
  if (isSessionStart) {
    // SessionStart fires again on `compact` and `resume`; rewriting would move
    // `startedAt` past commits the session already made.
    if (head && !dryRun && !readStartState(sessionId))
      writeStartState(sessionId, {
        sha: head,
        cwd,
        provider: agent.provider,
        startedAt: new Date().toISOString(),
      });
  } else {
    const start = readStartState(sessionId);
    const before = start?.sha;
    const commitShas = declaredCommits(cwd, start?.startedAt);
    if (commitShas.length > 0) body.commit_shas = commitShas;
    if (before) body.git_head_before = before;

    // A host whose SessionEnd repeats keeps the file, anchored at the original start, so
    // later turns still declare their commits; the rewrite also refreshes the mtime
    // the sweep ages sessions by.
    if (dryRun) {
      // Leaves the start for the real SessionEnd.
    } else if (agent.hostRepeatsSessionEnd && before) {
      writeStartState(sessionId, {
        sha: before,
        cwd,
        provider: agent.provider,
        startedAt: start?.startedAt,
        // Tells the sweep this session already ended.
        closed: true,
      });
    } else {
      clearStartState(sessionId);
    }
  }

  // `transcript_path` is never forwarded: it points at the conversation itself, which
  // Clocktopus does not collect.
  const result = await postHookRequest({
    endpoint,
    path: "/v1/agent-session",
    token,
    body,
    dryRun,
  });

  if (!dryRun) {
    recordLastRun({
      at: new Date().toISOString(),
      event: eventName,
      provider: agent.provider,
      sessionId,
      endpoint,
      tokenPrefix: maskToken(token),
      status: result.status,
      error: result.error,
      repository: body.repository_url ?? null,
    });
  }

  // After this session's own event, so the sweep's requests cannot delay it.
  if (isSessionStart) {
    await sweepAbandonedSessions(
      endpoint,
      token,
      sessionId,
      agent.provider,
      dryRun,
    );
  }
}

export async function hookCommand(options: {
  provider?: string;
  detached?: boolean;
  dryRun?: boolean | string;
}): Promise<void> {
  try {
    // A missing or unknown `--provider` falls back to Claude Code rather than dropping
    // the session.
    const agent =
      AGENTS.find((candidate) => candidate.provider === options.provider) ??
      AGENTS[0]!;
    await run(
      agent,
      options.detached === true,
      readHookDryRun(options.dryRun, process.env.CLOCKTOPUS_HOOK_DRY_RUN),
    );
  } catch {
    // Silent: see the host contract at the top of this file.
  }
}
