---
name: create-goal
description: Creates a Clocktopus goal from what the user describes, with a light breakdown into the tasks its outcome needs, in order, each a one-line title, a line on what and a kind. Reuses open tasks that already cover part of it, shows the goal and its tasks together, and creates them all on one confirmation, leaving each task's questions to refine. Use when the user asks to create, add, start or set up a goal, or to break an outcome down into tasks.
argument-hint: '"<goal>"'
---

# Create a goal

A goal is an outcome, such as _"customers can export invoices"_, with no dates.
It holds one ordered list of tasks, the order to work them in, and is reached
once every one is delivered. This skill drafts the goal and a light breakdown
of its tasks, confirms them once, and creates them. Settling each task's
questions is the refine skill's job.

If the Clocktopus MCP tools aren't available, the server needs signing in.
Ask the user to sign in, then continue: `/mcp` in Claude Code,
`codex mcp login clocktopus` in Codex, `opencode mcp auth clocktopus` in
OpenCode.

## 1. Read the repository's context

Get the remote with `git remote get-url origin` and call
`get_repository_context` with it as `repositoryUrl`. When `status` is:

- `no_project`: the repository is linked to no Clocktopus project the user can
  write to. Say so, suggest linking it in Clocktopus, and stop.
- `choose_organization`: several organisations link it. Ask which, then call
  again with `orgId`, and pass it to every call below.

## 2. Draft the goal and its tasks

From the user's words, draft:

- **Title:** the outcome, in one line, as the user would say it is done
  (_"Customers can export invoices"_, not _"Build invoice export"_).
- **Outcome:** how the user will know it is reached, in one to three
  sentences. Leave it out when the user gave nothing to base it on, rather
  than inventing criteria.

Keep the user's own wording where it already works. When what they said is
too vague to name an outcome, ask one question about what "done" looks like.

Then draft the tasks the outcome needs, in the order to work them, each with:

- a one-line title, the outcome rather than the fix;
- a line on what it covers;
- a kind: `bug`, `feature`, `improvement` or `tech`, as `create_task`
  describes them.

Size each so one pull request delivers it. Look at the code only as far as
needed to split the work sensibly. Write no specs and ask nothing about
implementation: those questions wait for the refine skill. Look for open tasks
that already cover part of the work with `search_tasks` (`repositoryUrl` and a
few words of each task as `query`), and use one instead of a new task, marked
by its key. Keys the user named go in as given.

## 3. Confirm once

Show the goal and its tasks together, each reused task by its key. The user
can edit or drop anything. Create nothing until they confirm.

## 4. Create it

1. Call `create_goal` with `repositoryUrl`, the `title` and the `outcome`.
2. Create each new task where the `create_task` description says: with
   `create_task`, unless the repository's agent instructions name another
   tracker. Call `create_task` with `repositoryUrl`, the `title`, the line on
   what as `summary`, and the `kind`; in a tracker, give the kind as its
   matching label or issue type. Leave out `agentSessionId`: this session
   isn't working on them.
3. Call `set_goal_tasks` with the new goal's `id` as `goalId` and every task,
   reused and new, in `tasks`, in the confirmed order.

## 5. Reply

Give the goal's `ref` (`G-3`) and title, and its tasks in order by key and
title. Say that `start-work G-3` works them through to stacked pull requests
to review one at a time, and that `refine G-3` first settles their open
questions when the user wants to be sure they cover everything.

## Don't

- Don't create a goal or a task without the user's confirmation.
- Don't write specs or ask implementation questions: the refine skill does
  that.
- Don't create a second task for work an open task already covers.
