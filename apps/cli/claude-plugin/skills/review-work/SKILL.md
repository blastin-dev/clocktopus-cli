---
name: review-work
description: Reviews the work this session just did, before a developer reads it. A first reviewer (GPT Sol, else Claude Sonnet) reviews the branch's diff against its task in the background, the session fixes the findings it is sure of, and a second model (Claude Fable) settles the ones still open and checks the fixes over a few rounds, so only decisions and the findings the rounds couldn't settle reach the developer, each as an inline comment on the pull request, on the line to fix, with a recommended fix. start-work runs it once the pull request is open. Use when the user asks to review, check or double-check the work just done on a branch. Not for reviewing someone else's pull request.
argument-hint: "[pull request number or base branch]"
---

# Review the work just done

The session that did the work has the context to fix its own clear mistakes
cheaply, and the decisions belong to the developer. Between the two sits
everything a reviewer raised that nobody has checked yet, and none of that
should reach the developer. So two models review: a first reviewer reads the
whole diff, the session fixes what it is sure of, and a second model settles
what is still **open** and checks the fixes, until every finding is fixed,
dropped, or a **decision** for the developer.

It reviews the current branch's own work: its commits since the branch it
targets. Never another author's pull request.

## 1. Pin the work

- **The pull request:** the one the user names, else the current branch's
  (`gh pr view --json number,url,baseRefName,headRefName` on GitHub, the
  host's CLI or API elsewhere). With no pull request yet, review against the
  branch the work started from, and give the findings to the user in step 7
  instead of a review.
- **The diff:** `git fetch origin <base>`, then `git diff origin/<base>...HEAD`,
  three dots so a stacked branch shows only its own commits, and
  `git log origin/<base>..HEAD --oneline`. The remote branch, because a local
  one can lag behind it and pull the commits below into the diff. When the
  diff is empty, say so and stop.
- **The spec:** the task the branch names. `get_task` with its key gives a
  Clocktopus task's title and summary; a tracker's ticket is read through its
  MCP tools. With no task, the pull request's description.
- **The goal:** when the task is in a goal (the one a goal run names, else
  the `list_goals` goal whose tasks include its key), the titles of the
  goal's other tasks, in order. A stacked pull request delivers one of them,
  so work a later task covers isn't missing here, and work an earlier task
  delivered isn't this pull request's.
- **The standards:** the repository's agent instructions (`CLAUDE.md`,
  `AGENTS.md`, a contributing guide), including those in the folders the diff
  touches.

## 2. Pick the two reviewers

- **First reviewer, wide:** the latest GPT Sol at high effort, reading the
  whole diff. When no route reaches Sol, the latest Claude Sonnet at high
  effort.
- **Second reviewer, narrow:** the latest Claude Fable at medium effort. It
  reads only the open findings and the fixes, so it needs depth more than
  breadth, and it is a different model from the first reviewer so its
  verdicts are a second opinion rather than an echo.

Both are subagents of this session's harness, on the account it already
uses. [`reviewers.md`](reviewers.md) gives the route to each in Claude Code,
Codex and T3 Code, and what to use when a model is out of reach. Note the
model each reviewer actually ran on, and its effort only when the harness
confirms it, and tell the user in one line when a fallback stood in and why.

## 3. First pass, in the background

Start the first reviewer in the background. Its brief gives it the base, the
diff and log commands, the spec, the goal's other tasks and the standards'
paths, and asks it to:

- review the diff through the agent's code-review skill when it has one
  (named `code-review` or close to it), with `origin/<base>` as the fixed
  point and the task as the spec; otherwise review it itself, against the
  spec (what is missing, wrong or not asked for), the standards (each breach
  citing its rule) and correctness (bugs, unhandled cases, broken callers);
- report nothing as missing that another task of the goal covers;
- read the code around each hunk, not only the diff, and drop any finding it
  can't tie to a line;
- report each finding with a stable id (`F1`, `F2`, …), its file and line,
  what is wrong, a concrete case where it goes wrong, the fix it suggests,
  and its confidence (high, medium or low) with the reason;
- report up to three things the work does well, each tied to a file and line
  and saying what it gets right and why that matters here: a case handled
  that was easy to miss, a test that pins the behaviour, a simpler shape than
  the obvious one. None when nothing stands out; never generic praise;
- change no files, commit nothing, post nothing and start no reviewers
  beyond those its code-review skill starts.

While it runs, carry on: tell the user the pull request is open and under
review, and answer them. Wait for its notification (`wait` in Codex) rather
than polling. A reviewer the harness can only run in the foreground holds the
session until it reports.

When no route in `reviewers.md` reaches a reviewer, review the diff itself
the same way, skip step 6, and leave the open findings to the developer in
step 7, saying no cross-check ran.

## 4. Sort the findings into a ledger

Keep a **ledger**, one line per finding: its id, `file:line`, group, and
outcome (`fixed in <sha>`, `dropped: <reason>`, `decision: <recommended
fix>`). The second reviewer reads it each round, and the review's body counts
from it.

Check every finding against the code before sorting it: read the lines it
names and follow the case it gives. Then:

- **Fix:** sure once checked. The case it gives really goes wrong, or the
  rule it cites really says so; the fix is small and stays inside the task's
  scope; and it changes nothing the task, its summary or the user decided.
- **Open:** a question of fact the check didn't settle: whether the case can
  happen, whether a caller breaks, whether the suggested fix is right.
- **Decision:** a choice only a person can make: scope, a design or naming
  preference, a fix reaching past the task, or one changing what the task or
  the user decided. Note the option you recommend.
- **Drop:** wrong once checked, the code already handles it, or it repeats
  what the repository's tooling (types, lint, tests) already enforces.

Between open and decision, ask whether more reading could settle it: when it
could, it is open. Between fix and open, it is open.

Check each thing reported as done well the same way, and keep it only when
the code really does what it says.

## 5. Fix the sure ones

Make the fixes, run the repository's checks again and commit with the task's
key in the scope (`fix(clk-12): …`). Add new commits; never amend or
force-push. They are pushed at the start of step 7, once the cross-check
ends.

When a fix makes a check fail and you can't make it pass, undo it and mark
the finding open, with the failing output.

## 6. Cross-check with the second reviewer

Skip this step when nothing is open and nothing was fixed. When no route in
`reviewers.md` reaches a second reviewer, skip it too, and leave the open
findings to the developer in step 7, saying the cross-check didn't run.

Each round, the second reviewer's brief gives it the spec and the standards'
paths, the base and the diff command, the ledger, each open finding with its
claim, its case and what your check found, and the fixes since the commit it
last saw (`git diff <sha>..HEAD`, everything since the base in round 1). It
asks it to change nothing, start no reviewers of its own, and answer each
open id with one of:

- `real`: the case it confirmed, and the fix;
- `not real`: the evidence (`file:line`, a test, a command's output);
- `decision`: why only a person can choose, and the option it recommends;

and to report each fix that is wrong or breaks a caller as a new finding with
a new id, or to say that it found nothing wrong in the fixes. From round 2
on, it reads only the open ids and the latest fixes.

Weigh its answers against the code as in step 4. A `real` one that passes
step 4's bar is fixed as in step 5; one whose fix would reach past the task
becomes a decision. A `not real` one whose evidence holds against the code is
dropped. A `decision` goes to the developer. An answer you still disagree
with after reading its evidence stays open, with your evidence, for the next
round. Agree with what the code shows, never to end the loop. A finding still
disputed once the reviewer has answered it twice becomes a decision, with
both sides in two or three lines each.

**Budget:** three rounds, five when an open finding concerns security,
permissions, data loss or concurrency. Stop early once nothing is open and
the reviewer found nothing wrong in the latest fixes. A finding still open
when the budget runs out goes to the developer as open, saying what the
rounds didn't settle: a spent budget is not agreement. Fixes made in answer
to the last round go out unchecked; the review's body lists them as not
cross-checked.

## 7. Leave the decisions on the pull request

Push the fixes, whichever way step 6 ended. Then post one review on the pull request, with event `COMMENT`, made of an inline
comment for each decision and each finding left open, on the line where it
should be fixed, and a short body. Post it even when every finding was fixed
or dropped, so the developer sees the review happened.

Every inline comment proposes what to do. It says what is wrong, the case
where it goes wrong, why it wasn't fixed here, and the fix you recommend. A
finding left open also says what would settle it; a disputed one gives both
sides, and the fix is the one you'd take if the finding holds. When
that fix replaces only the commented lines, give it as a `suggestion` block,
which the developer can apply in one click:

````markdown
The CSV header changes for existing exports: a consumer parsing by position
breaks. Kept, as the task asks for the new column.

Recommended: append the column last.

```suggestion
const header = [...LEGACY_COLUMNS, "credit_note"];
```
````

When the fix spans other lines or files, describe it in prose instead. A
recommendation names one fix; when it is a choice between options, say which
one you'd take and why.

A comment goes on lines of the pushed head, after the fixes, since they move
lines, and all its lines sit inside one hunk of the diff: GitHub refuses the
whole review when one comment's lines don't. A finding that can't be placed
that way goes in the body instead, under **For you to decide**, with its
`file:line` and the same recommendation.

The body names the reviewers, says what the work does well, what was fixed,
with the commit, what the cross-check settled, the fixes made after its last
round, as not cross-checked, the findings that couldn't go inline, and how
many were left inline and dropped. Leave out the empty parts:

```markdown
## Review of this work

Reviewed by GPT Sol (high), cross-checked by Claude Fable (medium) over 2
rounds.

**Done well:**

- `src/export.test.ts:30`: the test covers an export spanning a daylight
  saving change, the case most likely to file a row on the wrong day

**Fixed** in abc1234:

- `src/export.ts:42`: credit notes were summed as positive amounts

**Settled by the cross-check:** 3 open findings, 1 fixed in def5678 and 2
that didn't hold up.

**Fixed after the last round, not cross-checked,** in 0123abc:

- `src/export.ts:57`: the fix to line 42 skipped rows with a null amount

**For you to decide:**

- `src/db.ts:12`: the pool size stays at 5 while the export now runs in
  parallel, so a large export waits on connections. Recommended: raise it to
  match the export's concurrency.

2 findings left inline for you to decide. Dropped 1 that didn't hold up
against the code.
```

On GitHub, write the body to `body.md`, build the review with `jq` so the
body is escaped as JSON, and post it:

```sh
jq -n --rawfile body body.md --slurpfile comments comments.json \
  --arg sha "$(git rev-parse HEAD)" \
  '{commit_id: $sha, event: "COMMENT", body: $body, comments: $comments[0]}' \
  > review.json
gh api repos/{owner}/{repo}/pulls/<number>/reviews --input review.json
```

`comments.json` holds one object per inline comment; a range adds
`start_line`:

```json
[
  { "path": "src/export.ts", "line": 88, "side": "RIGHT", "body": "…" },
  {
    "path": "src/export.ts",
    "start_line": 90,
    "line": 94,
    "side": "RIGHT",
    "body": "…"
  }
]
```

Elsewhere, use the host's API for a review with inline comments, or post each
inline comment on its own where the host has no review object.

When the review can't be posted, give the findings and their recommendations
to the user instead.

## 8. Reply

In one line: the reviewers and rounds, how many findings were fixed, with the
commits, how many the cross-check settled, and how many were left on the pull
request, inline or in the review's body, with its link.

## Don't

- Don't fix a finding the code hasn't confirmed; send it to the second
  reviewer, and on to the developer only if it stays open.
- Don't gather the findings into one comment; each goes on its own line, or
  in the review's body when it can't be placed on one.
- Don't leave a finding without a recommended fix.
- Don't widen the work beyond its task, or undo a decision the task or the
  user made, because a reviewer suggested it.
- Don't request changes, approve, block or merge the pull request, or resolve
  someone else's review threads.
- Don't review a pull request this session didn't work on.
