---
name: review-work
description: Reviews the work this session just did, before a developer reads it. A council of reviewers from different providers (Claude Opus, GPT Sol, Gemini Neon, each at high effort, reached through the harness or their headless CLIs) reviews the branch's diff against its task in parallel, the session fixes the findings it confirms, and the council debates the rest and checks the fixes over a few rounds until a majority with evidence settles each one, so only decisions and the findings the debate couldn't settle reach the developer, each as an inline comment on the pull request, on the line to fix, with a recommended fix. start-work runs it once the pull request is open. Use when the user asks to review, check or double-check the work just done on a branch. Not for reviewing someone else's pull request.
argument-hint: "[pull request number or base branch]"
---

# Review the work just done

The session that did the work has the context to fix its own clear mistakes
cheaply, and the decisions belong to the developer. Between the two sits
everything a reviewer raised that nobody has checked yet, and none of that
should reach the developer. Reviewers from one provider share blind spots,
so a **council** reviews: one reviewer per provider reads the whole diff in
parallel, the session fixes what it confirms, and the council debates what
is still **open** and checks the fixes, until every finding is fixed,
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

## 2. Seat the council

Three seats, one per provider, each on its flagship at high effort: the
latest Claude Opus, the latest GPT Sol and the latest Gemini Neon. Each is a
fresh reviewer that has seen none of this session's reasoning, even the one
from this session's own provider. [`reviewers.md`](reviewers.md) gives the
routes to each, through this session's harness or a provider's headless CLI,
and how to probe a seat before using it.

A seat no route reaches stays **empty**: never fill it with another model.
The council needs reviewers from at least two providers. With fewer, review
the diff yourself as step 3 asks of a reviewer, skip step 6, and leave the
open findings to the developer in step 7, saying no council ran and which
seats were empty and why.

Note the model each reviewer actually ran on, the route that reached it, and
its effort only when the route confirms it. Tell the user in one line which
seats were filled and why any stayed empty.

## 3. Round 1, in parallel

Start every seated reviewer at once, in the background. Each gets the same
brief, and none sees another's answer. The brief gives it the base, the diff
and log commands, the spec, the goal's other tasks and the standards' paths,
and asks it to:

- review the diff through the agent's code-review skill when it has one
  (named `code-review` or close to it), with `origin/<base>` as the fixed
  point and the task as the spec; otherwise review it itself, against the
  spec (what is missing, wrong or not asked for), the standards (each breach
  citing its rule) and correctness (bugs, unhandled cases, broken callers);
- report nothing as missing that another task of the goal covers;
- read the code around each hunk, not only the diff, and drop any finding it
  can't tie to a line;
- report each finding with its file and line, what is wrong, a concrete case
  where it goes wrong, the fix it suggests, and its confidence (high, medium
  or low) with the reason;
- report up to three things the work does well, each tied to a file and line
  and saying what it gets right and why that matters here: a case handled
  that was easy to miss, a test that pins the behaviour, a simpler shape than
  the obvious one. None when nothing stands out; never generic praise;
- score the work out of 10, with the reason in one line;
- answer in the JSON `reviewers.md` gives;
- change no files, commit nothing, post nothing and start no reviewers
  beyond those its code-review skill starts.

While they run, carry on: tell the user the pull request is open and under
review, and answer them. Wait for each notification (`wait` in Codex) rather
than polling. When a reviewer reports, check its findings against the code
at once (step 4), but edit no file until every reviewer of the round has
reported: they read the same checkout. A reviewer that fails in round 1
moves to its seat's next route, as `reviewers.md` says. One that fails in a
later round leaves its seat empty from then on, with the reason, since a
fresh reviewer has none of the earlier rounds' reading.

Whenever fewer than two providers are left seated, the council stops: skip
what is left of step 6, and leave every finding still open to the developer
in step 7, naming the seat that dropped and why.

## 4. Merge the findings into a ledger

Keep a **ledger**, one line per finding: a stable id (`F1`, `F2`, …) the
session gives it as it enters the ledger, in any round,
`file:line`, group, which reviewers raised it, each reviewer's latest
position, and outcome (`fixed in <sha>`, `dropped: <reason>`, `decision:
<recommended fix>`). Two reviewers' findings are one when they name the same
lines and the same way of going wrong; keep the clearer case and fix. The
council reads the ledger each round, and the review's body counts from it.

Check every finding against the code before sorting it: read the lines it
names and follow the case it gives. A finding raised by every reviewer still
needs the check; one raised by a single reviewer is not weaker for it. Then:

- **Fix:** sure once checked. The case it gives really goes wrong, or the
  rule it cites really says so; the fix is small and stays inside the task's
  scope; and it changes nothing the task, its summary or the user decided.
- **Open:** a question of fact the check didn't settle: whether the case can
  happen, whether a caller breaks, whether the suggested fix is right; or two
  reviewers suggesting different fixes.
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
force-push. They are pushed at the start of step 7, once the debate ends.

When a fix makes a check fail and you can't make it pass, undo it and mark
the finding open, with the failing output.

## 6. Debate what is open

Skip this step when nothing is open and nothing was fixed.

The debate continues the numbering: its first round is round 2. Each round,
send every seated reviewer the same brief, in parallel, as a follow-up to
its own round-1 session so it keeps what it read. The brief gives the
ledger, and for each open finding its claim, its case, what your check found
and every reviewer's position with its evidence, by reviewer name; and the
fixes since the commit the council last reviewed (`git diff <sha>..HEAD`).
It asks the
reviewer to read the others' evidence against the code rather than defer to
it, change nothing, start no reviewers of its own, score the work again out
of 10, and answer each open id with one of:

- `real`: the case it confirmed, and the fix;
- `not real`: the evidence (`file:line`, a test, a command's output);
- `decision`: why only a person can choose, and the option it recommends;

and to report each fix that is wrong or breaks a caller as a new finding,
or to say that it found nothing wrong in the fixes. From round 3 on, the
brief carries only the open ids and the latest fixes.

**Settling a finding:** a majority of the seated reviewers (both, when two
sit) giving the same answer settles it, once the evidence they give holds
when you check it against the code. A settled `real` that passes step 4's
bar is fixed as in step 5; one whose fix would reach past the task becomes a
decision. A settled `not real` is dropped. A settled `decision` goes to the
developer. A `decision` from a minority overrides the majority only when its
reason is one of step 4's grounds for a decision (scope, a design or naming
preference, a fix reaching past the task, or a change to what the task or
the user decided) and holds against the task. A majority whose
evidence doesn't hold settles nothing: the finding stays open, with what
your check found, for the next round. Agree with what the code shows, never
to end the debate.

**Budget:** three debate rounds (rounds 2 to 4), five when an open finding concerns security,
permissions, data loss or concurrency. Stop early once nothing is open and
no reviewer found anything wrong in the latest fixes. A finding still split
when the budget runs out goes to the developer as a deadlock, with each
side in two or three lines and who took it: a spent budget is not
agreement. Fixes made in answer to the last round go out unchecked; the
review's body lists them as not cross-checked.

## 7. Leave the decisions on the pull request

Push the fixes, whichever way step 6 ended. Then post one review on the pull request, with event `COMMENT`, made of an inline
comment for each decision and each finding left open, on the line where it
should be fixed, and a short body. Post it even when every finding was fixed
or dropped, so the developer sees the review happened.

Every inline comment proposes what to do. It says what is wrong, the case
where it goes wrong, why it wasn't fixed here, and the fix you recommend. A
finding left open also says what would settle it; a deadlocked one gives
each side and who took it, and the fix is the one you'd take if the finding
holds. When that fix replaces only the commented lines, give it as a
`suggestion` block, which the developer can apply in one click:

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

The body names the council and any empty seat with its reason, gives each
reviewer's score per round, says what the work does well, what was fixed,
with the commit, what the debate settled, the fixes made after its last
round, as not cross-checked, the findings that couldn't go inline, and how
many were left inline and dropped. A reviewer that gave no score in a round
shows `no score`; never invent one. Leave out the empty parts:

```markdown
## Review of this work

Council: Claude Opus (high), Gemini Neon (high), over 2 rounds. GPT Sol's
seat was empty: Codex reported a usage limit.

| Reviewer    | Round 1 | Round 2 |
| ----------- | ------- | ------- |
| Claude Opus | 7/10    | 9/10    |
| Gemini Neon | 6/10    | 9/10    |

**Done well:**

- `src/export.test.ts:30`: the test covers an export spanning a daylight
  saving change, the case most likely to file a row on the wrong day

**Fixed** in abc1234:

- `src/export.ts:42`: credit notes were summed as positive amounts

**Settled by the debate:** 3 open findings, 1 fixed in def5678 and 2 that
didn't hold up.

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

In one line: the council and any empty seat, the rounds and the latest
scores, how many findings were fixed, with the commits, how many the debate
settled, and how many were left on the pull request, inline or in the
review's body, with its link.

## Don't

- Don't fix a finding the code hasn't confirmed, however many reviewers
  raised it; send it to the debate, and on to the developer only if it stays
  open.
- Don't fill an empty seat with another model, or count one reviewer twice.
- Don't edit the checkout while a reviewer is still reading it.
- Don't gather the findings into one comment; each goes on its own line, or
  in the review's body when it can't be placed on one.
- Don't leave a finding without a recommended fix.
- Don't widen the work beyond its task, or undo a decision the task or the
  user made, because a reviewer suggested it.
- Don't request changes, approve, block or merge the pull request, or resolve
  someone else's review threads.
- Don't review a pull request this session didn't work on.
