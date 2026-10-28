import { execFileSync } from "node:child_process";
import { isCliVersionBelow } from "@repo/cli-contract/cli-version";
import { stripRemoteCredentials } from "@repo/cli-contract/remote-url";
import { extractTaskKeyFromBranch } from "@repo/cli-contract/task-key";

import type { AgentProviderId } from "../../lib/agents.js";
import { skillNameFor } from "../../lib/agent-skills.js";
import { AGENTS } from "../../lib/agents.js";
import { cliVersion } from "../../lib/claude-plugin.js";
import { getLatestVersion } from "../../lib/config.js";
import { readSshConfig } from "../../lib/git.js";
import { readHookPayload } from "../../lib/hook-payload.js";
import { resolveSshHostAlias } from "../../lib/ssh-host-alias.js";

// A synchronous SessionStart hook: Claude Code and Codex add what it prints to
// the session's context, and Cursor adds the `additional_context` of the JSON it
// prints. It reads only local git state and the CLI's own config, prints
// nothing outside a repository unless the CLI is behind, never throws and
// always exits 0, so it can't slow or break a session. Without
// `--provider` it is Claude Code's, which installed it first.

export async function contextCommand(options: {
  provider?: string;
}): Promise<void> {
  try {
    const provider =
      AGENTS.find((agent) => agent.provider === options.provider)?.provider ??
      "claude_code";
    const raw = await readStdin();
    const payload = readHookPayload(
      raw ? JSON.parse(raw) : {},
      process.env.CURSOR_PROJECT_DIR,
    );
    const cwd = payload.cwd ?? process.cwd();
    const lines = [
      sessionContext({
        provider,
        sessionId: payload.sessionId ?? undefined,
        branch: currentBranch(cwd),
        resolvedOrigin: resolvedOrigin(cwd),
      }),
      upgradeNote(cliVersion(), readLatestVersion()),
    ].filter((line) => line !== null);
    if (lines.length === 0) return;
    const line = lines.join("\n");
    process.stdout.write(
      provider === "cursor"
        ? `${JSON.stringify({ additional_context: line })}\n`
        : `${line}\n`,
    );
  } catch {
    // Context is a convenience; a session must start without it.
  }
}

// Null outside a git repository. A detached HEAD reads as a branch naming no
// task. `resolvedOrigin` is set only when `origin` goes through an SSH host
// alias, whose remote the Clocktopus MCP tools can't match.
export function sessionContext(input: {
  provider: AgentProviderId;
  sessionId: string | undefined;
  branch: string | null | undefined;
  resolvedOrigin?: string;
}) {
  if (input.branch === null) return null;
  const repository = input.resolvedOrigin
    ? ` Its origin goes through an SSH host alias: pass ${input.resolvedOrigin} as \`repositoryUrl\` to Clocktopus tools, not \`git remote get-url origin\`.`
    : "";
  const session = `${repository}${
    input.sessionId
      ? ` Session id: ${input.sessionId}, agent ${input.provider}.`
      : ""
  }`;
  const key = extractTaskKeyFromBranch(input.branch);
  if (key) {
    return `Clocktopus: branch ${input.branch} carries task ${key}, so this session's commits, pull requests and agent spend count towards it.${session}`;
  }
  const where =
    input.branch === undefined
      ? "HEAD is detached"
      : `branch ${input.branch} names no task`;
  return `Clocktopus: ${where}, so this session's work counts towards no task. Before changing code, use the ${skillNameFor(input.provider, "start-work")} skill to pick up or create the task.${session}`;
}

// For a machine nobody runs the CLI on by hand, where this is the only place
// a new version shows. `latest` is what the hook last heard from the receiver.
export function upgradeNote(current: string, latest: string | null) {
  if (!latest || !isCliVersionBelow(current, latest)) return null;
  return `Clocktopus: this machine's Clocktopus CLI is ${current} and ${latest} is out. Tell the user; if they want it, run \`clocktopus upgrade --yes\`, which upgrades it with whatever installed it. Hooks use the new version at once; sessions started after it load its plugin and skills.`;
}

function readLatestVersion() {
  try {
    return getLatestVersion() ?? null;
  } catch {
    return null;
  }
}

function resolvedOrigin(cwd: string) {
  const origin = git(cwd, ["remote", "get-url", "origin"]);
  if (!origin) return undefined;
  const remote = stripRemoteCredentials(origin);
  const resolved = resolveSshHostAlias(remote, readSshConfig);
  return resolved === remote ? undefined : resolved;
}

// Undefined on a detached HEAD, null outside a repository. `symbolic-ref`
// also names the branch of a repository with no commits yet.
function currentBranch(cwd: string) {
  const branch = git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (branch) return branch;
  return git(cwd, ["rev-parse", "--git-dir"]) === null ? null : undefined;
}

function git(cwd: string, args: string[]) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return null;
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
