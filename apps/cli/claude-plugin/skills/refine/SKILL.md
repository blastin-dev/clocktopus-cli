---
name: refine
description: An extra pass for when the user isn't sure a task, or a goal's tasks, cover everything. Gets them ready for an agent to carry to a pull request without asking. For a task, checks the code, asks the questions the code can't answer, writes the answers into the task and marks it refined. For a goal, first proposes the order of its tasks, releases, delivered tasks to close, duplicates and missing tasks, checked against git, pull requests and agent sessions, then refines every unrefined task in one round of questions. Applies only what the user confirms. Use when the user asks to refine, plan or groom a task, a goal or the backlog, or to re-check a goal. To create a goal, use create-goal.
argument-hint: 'a task key (BLA-12), a goal number (G-3) or "<goal>"'
---

# Refine a task or a goal

Every task is written so an agent can pick it up (the create-task skill), and
an agent that starts one asks what is still open. Refining is the extra pass
for when the user isn't sure a task covers everything: it checks the task
against the code, settles its questions with the user up front, and marks it
refined. A refined task is one an agent can take to a pull request without
asking. It carries:

- the problem and why it matters;
- what to do, and the code it touches;
- the decisions made;
- what is out of scope.

Clocktopus marks it `refined`. A Clocktopus task holds its description in
`summary`, up to 5000 characters; a tracker task's description lives in the
tracker.

Everything goes through the Clocktopus MCP tools, and the tracker's own for a
tracker task. Propose first, then apply only what the user confirms.

If the Clocktopus MCP tools aren't available, the server needs signing in.
Ask the user to sign in, then continue: `/mcp` in Claude Code,
`codex mcp login clocktopus` in Codex, `opencode mcp auth clocktopus` in
OpenCode.

## 1. Task or goal

Get the remote with `git remote get-url origin` and call
`get_repository_context` with it as `repositoryUrl`, for the trackers the
organisation has connected (`trackers`). When the Clocktopus line at session start gives a resolved URL for an SSH
host alias, use that instead. When `status` is:

- `no_project`: the repository is linked to no Clocktopus project the user can
  write to. Say so, suggest linking it in Clocktopus, and stop.
- `choose_organization`: several organisations link it. Ask which, then call
  again with `orgId`.

Pass the project's `organizationId` as `orgId` to the tools that take no
`repositoryUrl` (`get_ticket_flow` and the goal tools), and a goal's ref
(`G-3`) as `goalId`. Then:

- **The user named a task key** (`BLA-12`, or a bare number that only fits
  the project's keys): refine that task (step 2), then stop.
- **The user named a goal by its number** (`G-3`): use that goal and go to
  step 3.
- **Otherwise:** call `list_goals` with `repositoryUrl`. When a goal matches
  what the user asked for, use it; when several could, ask which. When none
  matches, offer to create it as the create-goal skill does, then carry on
  here.

## 2. Refine a task

**Read it.** Call `get_task` with its key for its title, summary, stage,
kind, refined mark and `native` (created in Clocktopus). For a tracker task,
also read its description and comments through the tracker's MCP tools. A task already in review or merged needs nothing: say so and
stop.

**Check the codebase.** Find where the work lands: the files, functions,
tables and tools it touches, what already exists that it can reuse, and what
it would break. Read the repository's own guidelines (`CLAUDE.md`,
`AGENTS.md`, a contributing guide) where they constrain the approach.

**Ask.** Raise the questions the code can't answer: behaviour the task leaves
open, a choice between approaches with different trade-offs, scope that could
go either way, an assumption in the task that the code contradicts. Ask them
together, each with its options and the one you recommend. Don't ask what the
code or the task already settles. When nothing is open, say the task is clear
and why.

**Write it.** From the answers, draft the task's updated description, with
what a refined task carries. Show it and ask the user to confirm or edit it,
then write it: through the tracker's MCP tools for a tracker task, or
`update_task` with `summary` for a Clocktopus task. Mark it refined with
`update_task` and `refined: true`. When it has no kind, set one with the same
call (`kind`) for a Clocktopus task, or as the tracker's matching label or
issue type.

**Its goal.** Call `list_goals` with `repositoryUrl`. When no goal's `open`
tasks include the key, ask whether to add it to one; on yes, call
`set_goal_tasks` with that goal and the key in `add`.

## 3. Check a goal

Call `plan_goal` with the goal's `ref` as `goalId`. It returns:

- `done`, `open` (in the goal's order) and `cancelled`: the goal's tasks, each
  with its `kind`, `refined` mark, `stage`, pull requests, cost so far,
  `addedAt` and `flags`
- `candidates`: the project's other open tasks, ranked by the words they
  share with the goal. The ranking is only a hint: read the titles and
  summaries and judge relevance yourself

When the tracker's own MCP tools are available (Linear or Jira), search it too
for open tasks that match the goal, including anything in progress, and read
the blocked-by relations of the goal's tasks. Pass any keys found that way to
`get_ticket_flow` to learn their stage and cost.

What each stage and flag means:

- `done`: the task's work reached one of its project's delivery branches, so
  it is delivered, whatever the tracker says.
- `merged`: its pull request merged. The goal counts it finished; delivery
  follows.
- `in_review`: a pull request is open. Leave it where it is in the order.
- `cancelled`: the task was cancelled. It no longer counts towards the goal,
  so propose releasing it.
- `delivered_tracker_open`: delivered, but the tracker still has it open:
  propose closing it there.
- `tracker_done_not_delivered`: closed in the tracker, but its work never
  reached a delivery branch: ask the user whether it really shipped.
- `stalled`: started, with no new stage for seven days: ask whether to keep
  it in the goal.
- `unknown`: nothing has seen the key: it may be mistyped or not yet created.

## 4. Propose

Show one proposal, grouped like this, each task by key and title with a few
words on why:

- **Order:** the open tasks in the order to work them. A task goes after the
  ones that block it (blocked-by relations from the tracker) or whose code it
  builds on. Tasks in review keep their place unless the user says otherwise.
- **Release:** tasks in the goal that no longer serve it, and cancelled ones.
- **Close:** delivered tasks still open in their tracker.
- **Duplicates:** pairs that describe the same work, and which one to keep.
- **Missing:** work the goal needs that no task covers: a candidate by its
  key, or a new task as a drafted one-line title, a line on what, and a kind
  (`bug`, `feature`, `improvement` or `tech`, as `create_task` describes
  them).

On a goal refined before, start with what is still open: how long each task
has been in the goal (from `addedAt`) and what it has cost, and ask for each
whether to keep, release or cancel it. Nothing carries over silently.

Ask the user to confirm, edit or drop each group. Apply only what they
confirm, in this order:

1. **Missing tasks:** create each confirmed new one where the `create_task`
   description says: with `create_task`, unless the repository's agent
   instructions name another tracker. Leave out `agentSessionId`: this
   session isn't working on them. Note the keys.
2. **Membership:** call `set_goal_tasks` once, with `tasks` in the confirmed
   order (new keys where the user put them) and `release` for released and
   duplicate tasks. An open task left out of `tasks` is released too; a merged
   or delivered one stays, counted as done.
3. **Cancelled Clocktopus tasks:** `update_task` with `cancelled: true`, only
   for the ones the user said to cancel. Tracker tasks are cancelled in the
   tracker.
4. **Closing delivered tasks,** only with the tracker's MCP tools available
   and each one confirmed.

## 5. Refine the goal's tasks

Then refine every open task not yet `refined` and not yet in review, all in
one pass rather than one task at a time:

1. **Research them all first,** in parallel subagents where the harness has
   them: each reads one task and checks the code as in step 2, and reports
   its open questions with options and a recommendation, asking the user
   nothing and writing nothing.
2. **Ask every question in one round,** grouped by task. Say which tasks are
   already clear, and why.
3. **Draft every description,** and ask the user to confirm them once; they
   can edit any or skip a task, which stays unrefined in the goal.
4. **Write each one and mark it refined,** as in step 2, setting the kind
   where it has none.

Then show the goal as it now stands (`plan_goal`), and say that
`start-work G-3` can now work its tasks through to stacked pull requests
without asking.

## Don't

- Don't set a task's stage: it moves on its own, from commits, pull requests
  and delivery.
- Don't close, cancel, create or rewrite a task without the user's
  confirmation of that change.
- Don't ask what the code already answers.
- Don't mirror the goal in the tracker as a label, status or cycle: its order
  lives in Clocktopus alone.
- Don't estimate or assign people.
