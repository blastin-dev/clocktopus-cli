// Commits come from the reflog rather than `rev-list before..head`, which also returns
// pulled and merged history. The reflog is per-worktree, so agents in separate
// worktrees cannot claim each other's commits; two agents in one worktree can.
//
// A `declared` link outranks the time-window rule and is permanent, so every choice
// here errs towards declaring less.

const MAX_DECLARED_COMMITS = 200;

// `null` when the session's start was never recorded: without a lower bound the reflog
// returns the checkout's whole history, so the session declares nothing.
export function buildReflogArgs(input: {
  /** ISO timestamp recorded at SessionStart. */
  startedAt?: string;
  until?: string;
}): string[] | null {
  // No grace before `startedAt`: both stamps share one clock, so a grace could only
  // admit a commit made before the session began.
  const since = asIso(input.startedAt);
  if (!since) return null;

  const args = [
    "reflog",
    "show",
    "HEAD",
    "--format=%H %gs",
    `--since=${since}`,
  ];

  const until = asIso(input.until);
  if (until) args.push(`--until=${until}`);

  // Without `--`, a file named `HEAD` in the working tree makes git reject the read.
  args.push("--");

  return args;
}

// Keeps only `commit`, `revert` and `cherry-pick` entries. `merge`, `pull` and
// `rebase (pick)` are excluded because the reflog cannot tell a commit authored here
// from one fast-forwarded onto or replayed; clean merges fall to the time-window rule.
export function parseReflogCommits(output: string | undefined): string[] {
  if (!output?.trim()) return [];

  const shas: string[] = [];
  const seen = new Set<string>();

  for (const line of output.split("\n")) {
    const separator = line.indexOf(" ");
    if (separator === -1) continue;

    const sha = line.slice(0, separator).trim();
    const subject = line.slice(separator + 1).trim();

    if (!/^[0-9a-f]{7,64}$/i.test(sha)) continue;
    if (!/^(commit|revert|cherry-pick)\b/.test(subject)) continue;
    if (seen.has(sha)) continue;

    seen.add(sha);
    shas.push(sha);
    if (shas.length === MAX_DECLARED_COMMITS) break;
  }

  return shas;
}

function asIso(value: string | undefined): string | null {
  return asDate(value)?.toISOString() ?? null;
}

function asDate(value: string | undefined): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}
