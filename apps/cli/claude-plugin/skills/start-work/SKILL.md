---
name: start-work
description: Starts work on a task and carries it through to an open pull request, with the session tied to the task so its commits, pull requests and agent spend count towards it in Clocktopus. Takes the task the user names, the one the branch carries, an open task matching what they describe, or the goal's next one, and creates a task straight away for new work. Given a goal (`G-3`), works through its tasks unattended as stacked pull requests, each in a background subagent. Also ties a session to its task without taking over, when the session context says the branch names no task. Use when the user asks to start, pick up or work on a task or a goal. To note a task for later, use create-task.
argument-hint: "[task key, goal number (G-3), or what to do]"
---

# Start work on a task

Clocktopus attributes work to a task by the key in the branch name
(`dana/clk-12-export-invoices`), the scope of a commit (`feat(CLK-12): …`),
the pull request's source branch, and the session tied to it with
`link_session`. This skill gives the work its task and a branch carrying the
key. It never blocks a commit or a push.

## Run or tie

- **Run:** the user invoked this skill, or asked to start or work on a task or
  a goal. Carry the task through to an open pull request: steps 1 to 6.
  Invoking start-work is the user asking for that pull request.
- **Tie:** only the session-start line prompted this, while the user asked for
  something else. Pick up or create the task, tie the session and set up the
  branch (steps 1 to 4), then carry on with what the user asked. Commit and
  open a pull request only when they ask.

Do nothing when the session only asks a question, explores, reviews or
explains, and changes no code.

At session start, Claude Code, Codex and Cursor show a line from Clocktopus
saying whether the current branch carries a task, with the session id and
agent (`Session id: …, agent codex_cli.`). OpenCode shows no such line:
there, leave `agentSessionId` and `agent` out of every call below.

If the Clocktopus MCP tools aren't available, the server needs signing in.
Ask the user to sign in, then continue: `/mcp` in Claude Code,
`codex mcp login clocktopus` in Codex, `opencode mcp auth clocktopus` in
OpenCode.

## 1. Read the repository's context and its goal

Get the remote with `git remote get-url origin`, then call
`get_repository_context` and `next_task`, each with it as `repositoryUrl`;
give `get_repository_context` the current branch as `branch` too.
When the Clocktopus line at session start gives a resolved URL for an SSH
host alias, use that instead.
When the user named a goal by its number (`G-3`, shown on the goal's card in
Clocktopus), pass it to `next_task` as `goalId`.

`get_repository_context` returns the Clocktopus `project` the repository is
linked to, its `taskKeyPrefix` (`CLK`), the `trackers` the organisation has
connected, how many tasks are open, the ones in progress or in review
(`inFlight`), and `branchTask`: the task the branch names, with its `summary`,
stage, pull requests, `kind`, `refined` mark, and `native` for a task created
in Clocktopus. `search_tasks` finds the others and `get_task` reads one by
key. When `status` is:

- `no_project`: the repository is linked to no Clocktopus project the user can
  write to. Say so once, suggest linking it in Clocktopus, and carry on with
  the work: nothing else in this skill applies.
- `choose_organization`: several organisations link it. Ask which, then call
  both tools again with `orgId`.

`next_task` returns the project's active goal, its `next` list (every open
task in the goal's order, each with `claimed`: already started by a session,
a commit or a pull request) and `ticket`, the first unclaimed one, with a
suggested `branchName`. When `status` is:

- `ok`: the goal's next task is `ticket`.
- `next_empty`: nothing in the goal is open. Suggest the refine skill to line
  up what the goal still needs.
- `choose_goal`: several goals are active. When you need the goal's next task
  (step 2), ask which, listing each by its `ref` and title, then call again
  with its `ref` as `goalId`.
- `no_goal`: the project has no active goal.

When the user named a goal by its number, or asked to work through a goal or
several of its tasks, read [`goal.md`](goal.md) and follow it instead of the
steps below.

## 2. Choose the task

Take the first that applies:

1. The user named a key.
2. The branch carries one.
3. The user described work that an open task clearly matches: one in the
   goal's `next`, or one `search_tasks` finds with a few distinctive words of
   it as `query`.
4. The user described new work: create its task straight away, without a
   round of confirmation (below).
5. The user didn't say what to work on: offer the goal's `ticket`. When
   `ticket.claimed` is true, every open task in the goal is already started:
   list them with their stage and ask which to join. With no goal, ask what
   to work on.

When more than one task could fit, ask, listing the candidates by key and
title. Never guess between tasks.

**Creating the task.** Write it from the user's words as the create-task
skill does: a title, a description (the problem, why it matters, what to do,
what is out of scope) and a kind. Create it where the `create_task` description says: with
`create_task`, unless the repository's agent instructions name another
tracker. Call `create_task` with `repositoryUrl`, `title`, `summary`, `kind`,
and the session id and agent from the Clocktopus line as `agentSessionId` and
`agent`, which ties this session to it. It returns the key and a suggested
`branchName`. In a tracker, give the kind as its matching label or issue type.

Once the task is chosen, and when the project has an active goal, tell the
user in one line where the task stands against it: its place in `next`
("BLA-12, 2 of 5 in _Customers export invoices_"), or that it is outside the
goal.

## 3. Tie the session to the task

Call `link_session` with `repositoryUrl`, the task's `key`, and the session id
and agent from the Clocktopus line as `agentSessionId` and `agent`. Its time
and spend then count toward the task from now on, whatever branch or directory
the session is in. Skip it for a task `create_task` just made with
`agentSessionId`, which is already tied.

Without a session id, Clocktopus looks for your live session in the
repository. When `status` is:

- `choose_session`: several are live. Call again with the `agentSessionId`
  and `agent` of the one whose `cwd` and `gitBranch` match yours (a `cwd`
  under your home directory reads `~/…`); ask the user if none clearly does.
- `no_session`: none has reported yet, so this session can't be tied. Say so
  once and carry on: the branch name still attributes the work.

## 4. Work on the task's branch

The branch name starts a path segment with the key, lowercase:
`clk-12-export-invoices`, or `dana/clk-12-export-invoices` where the repository
prefixes branches with a name. Follow the repository's convention: check its
`CLAUDE.md`, `AGENTS.md` or contributing guide, and the names of recent
branches (`git branch -r --sort=-committerdate | head`). Use `branchName`
from `create_task` or `next_task`, or a tracker's suggested branch name, when
it fits.

- **The current branch carries the task's key:** stay on it.
- **The branch exists:** switch to it.
- **The working tree is clean:** create the branch from the up-to-date
  default branch and switch to it. For a goal's task, when the user's own pull
  request for an earlier task of the same goal is still open, branch from the
  top of that stack instead, as [`goal.md`](goal.md) describes.
- **There are uncommitted changes that belong to other work:** don't carry
  them across. Create a worktree for the task on the new branch instead, and
  tell the user where it is.

When committing, put the key in the conventional-commit scope as well
(`feat(clk-12): …`) if the repository uses that format.

In tie mode, stop here and carry on with what the user asked.

## 5. Settle the task's questions

Read the task: in its tracker through the tracker's MCP tools, or its title
and summary from `get_task` for a Clocktopus task. Then check the code where
the work lands. A refined task (`refined`) usually needs no questions.

When the task leaves decisions open that the code doesn't settle, ask them
all in one round, each with its options and the one you recommend. Write the
answers into the task, in its tracker or as the `summary` of a Clocktopus
task through `update_task` (up to 2000 characters), and mark it refined with
`update_task` and `refined: true`, as the refine skill does.

## 6. Carry it to a pull request

Do the work following the repository's instructions, run its checks (types,
tests, lint, whatever it names), commit with the key in the scope, push, and
open the pull request. For a Clocktopus task (`native`), then update its
summary with `update_task` so it says what the pull request delivers. Tasks
from a tracker are edited in the tracker.

Then review the work with the review-work skill: it fixes what it is sure of
and leaves the rest inline on the pull request, each with a recommended fix.

When the repository's instructions forbid an agent committing or pushing,
stop before that step and say so.

Stop and ask the user when:

- a decision comes up that neither the task nor the code settles;
- checks fail and you can't make them pass;
- the next step goes beyond a pull request: merging, deploying, applying a
  migration, or closing a task in its tracker.

Finish with the pull request's link, a line on what it delivers, and what the
review fixed and left on it.

## Something else turns up

When something worth doing turns up mid-session but isn't the current task,
create a task for it as the create-task skill does, and stay where you are:
no new branch, no switch. Leave out `agentSessionId`: this session isn't
working on it, and tying it would move the session's spend there. Tell the
user its key.

## Don't

- Don't set a task's stage. It moves on its own, from commits, pull requests
  and delivery to the project's delivery branches.
- Don't create a second task for work that already has one.
- Don't block, delay or rewrite commits for want of a key.
- Don't cancel a task (`update_task` with `cancelled: true`) unless the user
  asks.
