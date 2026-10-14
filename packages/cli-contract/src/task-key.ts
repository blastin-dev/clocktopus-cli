// `#` is notation, not part of the key, and case is not part of the identity.
// `packages/core/src/reports/ticket-key-sql.ts` mirrors the scope and branch
// rules in SQL.

// Anchored without the `m` flag: the scope must be on the first line, not in a
// commit body.
const CONVENTIONAL_COMMIT_SCOPE = /^[a-zA-Z]+\(([^)]+)\)/;

// The `#` must start the text or follow whitespace so URLs don't mint tasks, and
// `.`/`,` are excluded so a sentence-final `#ABC-123.` captures the key.
const HASH_TAG = /(?:^|\s)#([A-Za-z0-9][A-Za-z0-9_-]*)/;

// A merge commit's `#N` is a pull request number, not a task (`Merge pull
// request #170 …`, Bitbucket's `Merged in branch (pull request #N)`).
const MERGE_COMMIT = /^Merged?\b/i;

export function normalizeTaskKey(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  const stripped = raw
    .trim()
    .replace(/^#+/, "")
    .replace(/[-_\s]+$/, "")
    .trim();

  if (!stripped) return null;
  if (!/[A-Za-z0-9]/.test(stripped)) return null;

  return stripped.toUpperCase();
}

// The conventional-commit scope wins over an inline tag. An inline tag counts
// only for `manual` entries: a commit subject's `#N` is a pull request, an issue
// or a colour, never a deliberate task reference.
export function extractTaskKey(
  text: string | null | undefined,
  source: "manual" | "webhook" | "sys-adjustment",
): string | null {
  return findTaskKeyReference(text, source)?.key ?? null;
}

// `start`/`end` bound the raw reference in `text` (the scope's contents, or the
// tag with its `#`), so the web app can link the text the key came from.
export function findTaskKeyReference(
  text: string | null | undefined,
  source: "manual" | "webhook" | "sys-adjustment",
): { key: string; start: number; end: number } | null {
  if (!text) return null;
  if (MERGE_COMMIT.test(text.trim())) return null;

  const scope = text.match(CONVENTIONAL_COMMIT_SCOPE);
  const scoped = scope?.[1];
  if (scope && scoped) {
    const key = normalizeTaskKey(scoped);
    // A scope that normalises to nothing (`feat(#):`) falls through to the tag.
    if (key) {
      const start = scope[0].indexOf("(") + 1;
      return { key, start, end: start + scoped.length };
    }
  }

  if (source !== "manual") return null;

  const tag = text.match(HASH_TAG);
  const tagged = tag?.[1];
  if (!tag || !tagged || tag.index === undefined) return null;
  const key = normalizeTaskKey(tagged);
  if (!key) return null;
  const start = tag.index + tag[0].indexOf("#");
  return { key, start, end: start + 1 + tagged.length };
}

// The key must start a path segment, or `feature/add-oauth-2` mints `OAUTH-2`.
// Purely numeric segments are rejected: `release/2` is a version, `hotfix/2024` a
// year. A dot before a digit makes it a version too: `release-1.0` is no
// `RELEASE-1`.
const BRANCH_SEGMENT_TASK_KEY =
  /^([A-Za-z][A-Za-z0-9]*-\d+)(?:[-_]|\.(?!\d)|$)/;

// Dependency bots name branches `<bot>/<ecosystem>/<package>-<version>`, so
// `dependabot/github_actions/actions/checkout-7` would read as `CHECKOUT-7`.
const BOT_BRANCH = /^(?:dependabot|renovate)\//;

export function extractTaskKeyFromBranch(
  branch: string | null | undefined,
): string | null {
  return findBranchTaskKey(branch)?.key ?? null;
}

function findBranchTaskKey(
  branch: string | null | undefined,
): { key: string; start: number; end: number } | null {
  if (!branch || BOT_BRANCH.test(branch)) return null;

  let start = 0;
  for (const segment of branch.split("/")) {
    const raw = segment.match(BRANCH_SEGMENT_TASK_KEY)?.[1];
    if (raw) {
      const key = normalizeTaskKey(raw);
      return key ? { key, start, end: start + raw.length } : null;
    }
    start += segment.length + 1;
  }

  return null;
}

// Unlike a commit's, a title's scope counts only when it is shaped like a ticket
// key, so `chore(ci): …` mints no `CI` task. `packages/core/migrations/`
// backfills existing pull requests with the same rule in SQL.
const TICKET_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

// Whether `key` is shaped like a tracker ticket (`ABC-123`) rather than a
// commit scope such as `CI` or `RELEASE`.
export function isTicketKey(key: string) {
  return TICKET_KEY.test(key);
}

export function extractTaskKeyFromPullRequest(pr: {
  sourceBranch: string | null | undefined;
  title: string | null | undefined;
}): string | null {
  const fromBranch = extractTaskKeyFromBranch(pr.sourceBranch);
  if (fromBranch) return fromBranch;

  const fromTitle = extractTaskKey(pr.title, "webhook");
  return fromTitle && TICKET_KEY.test(fromTitle) ? fromTitle : null;
}

// GitHub's `Merge pull request #N from owner/branch` and Bitbucket's `Merged in
// branch (pull request #N)`; the capture is the source branch.
const MERGE_COMMIT_SOURCE_BRANCH =
  /^(?:Merge pull request #\d+ from [^/\s]+\/|Merged in )(\S+)/;

// A merge commit's task is its pull request's (`extractTaskKeyFromPullRequest`),
// read here from the message: the source branch on its first line, then the
// pull request's title on the next non-blank line.
export function findMergeCommitTaskKeyReference(
  text: string | null | undefined,
): { key: string; start: number; end: number } | null {
  if (!text) return null;

  const merge = text.match(MERGE_COMMIT_SOURCE_BRANCH);
  const branch = merge?.[1];
  if (!merge || !branch) return null;

  const branchStart = merge[0].length - branch.length;
  const fromBranch = findBranchTaskKey(branch);
  if (fromBranch) {
    return {
      key: fromBranch.key,
      start: branchStart + fromBranch.start,
      end: branchStart + fromBranch.end,
    };
  }

  const titleStart = text.search(/\n\s*\S/);
  if (titleStart < 0) return null;
  const titleOffset = titleStart + text.slice(titleStart).search(/\S/);
  const fromTitle = findTaskKeyReference(text.slice(titleOffset), "webhook");
  if (!fromTitle || !TICKET_KEY.test(fromTitle.key)) return null;
  return {
    key: fromTitle.key,
    start: titleOffset + fromTitle.start,
    end: titleOffset + fromTitle.end,
  };
}
