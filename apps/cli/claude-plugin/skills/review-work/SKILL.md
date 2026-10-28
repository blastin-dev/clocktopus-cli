---
name: review-work
description: Reviews the work this session just did, before a developer reads it. Runs a code review of the branch's diff against its task in a background subagent, through the agent's code-review skill when it has one, then fixes only the findings it is highly confident in, re-runs the checks and pushes, and leaves every other finding as an inline comment on the pull request, on the line to fix, with a recommended fix, for the developer. start-work runs it once the pull request is open. Use when the user asks to review, check or double-check the work just done on a branch. Not for reviewing someone else's pull request.
argument-hint: "[pull request number or base branch]"
---

# Review the work just done

The session that did the work has the context to fix its own clear mistakes
cheaply; the judgement calls belong to the developer. So a reviewer that
didn't write the change reads it, this session fixes what it is sure of, and
the rest goes on the pull request for the developer to decide.

It reviews the current branch's own work: its commits since the branch it
targets. Never another author's pull request.

## 1. Pin the work

- **The pull request:** the one the user names, else the current branch's
  (`gh pr view --json number,url,baseRefName,headRefName` on GitHub, the
  host's CLI or API elsewhere). With no pull request yet, review against the
  branch the work started from, and give the findings to the user in step 5
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

## 2. Start the review in a background subagent

Start one subagent in the background: the `Agent` tool with
`run_in_background` in Claude Code, `spawn_agent` in Codex (with multi-agent
enabled), the `task` tool in OpenCode. Its prompt gives it the base, the diff
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
- change no files, commit nothing and post nothing.

While it runs, carry on: tell the user the pull request is open and under
review, and answer them. Wait for its notification (`wait` in Codex) rather
than polling. A subagent the harness can only run in the foreground holds the
session until it reports.

When this session is itself a subagent, as in a goal run, or the harness has
no subagents, review the diff itself the same way, before reporting.

## 3. Sort the findings

Check every finding against the code before acting on it: read the lines it
names and follow the case it gives. Then put it in one of three groups.

- **Fix:** confidence is high once checked. The case it gives really goes
  wrong, or the rule it cites really says so; the fix is small and stays
  inside the task's scope; and it changes nothing the task, its summary or
  the user decided.
- **Leave for the developer:** anything short of that. A judgement call, a
  design or naming preference, a fix that reaches past the task, one that
  changes a decision, or one you can't confirm or disprove.
- **Drop:** wrong once checked, the code already handles it, or it repeats
  what the repository's tooling (types, lint, tests) already enforces.

When in doubt between fixing and leaving, leave it.

Check each thing reported as done well the same way, and keep it only when
the code really does what it says.

## 4. Fix the sure ones

Make the fixes, run the repository's checks again, commit with the task's key
in the scope (`fix(clk-12): …`) and push. Add new commits; never amend or
force-push.

When a fix makes a check fail and you can't make it pass, undo that fix and
move the finding to the developer's group. Don't review the fixes again: one
review per run.

## 5. Leave the rest on the pull request

Post one review on the pull request, with event `COMMENT`, made of an inline
comment for each finding left for the developer, on the line where it should
be fixed, and a short body. Post it even when every finding was fixed or
dropped, so the developer sees the review happened.

Every inline comment proposes what to do. It says what is wrong, the case
where it goes wrong, why it wasn't fixed here, and the fix you recommend. When
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

A comment goes on lines of the pushed head, after step 4's fixes, since they
move lines, and all its lines sit inside one hunk of the diff: GitHub refuses
the whole review when one comment's lines don't. A finding that can't be
placed that way goes in the body instead, under **For you to decide**, with
its `file:line` and the same recommendation.

The body says what the work does well, what was fixed, with the commit, the
findings that couldn't go inline, and how many were left inline and dropped.
Leave out the empty parts:

```markdown
## Review of this work

**Done well:**

- `src/export.test.ts:30`: the test covers an export spanning a daylight
  saving change, the case most likely to file a row on the wrong day

**Fixed** in abc1234:

- `src/export.ts:42`: credit notes were summed as positive amounts

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

## 6. Reply

In one line: how many findings were fixed, with the commit, and how many were
left on the pull request, inline or in the review's body, with its link.

## Don't

- Don't fix a finding you aren't highly confident in; leave it on the pull
  request.
- Don't gather the findings into one comment; each goes on its own line, or
  in the review's body when it can't be placed on one.
- Don't leave a finding without a recommended fix.
- Don't widen the work beyond its task, or undo a decision the task or the
  user made, because a reviewer suggested it.
- Don't request changes, approve, block or merge the pull request, or resolve
  someone else's review threads.
- Don't review a pull request this session didn't work on.
