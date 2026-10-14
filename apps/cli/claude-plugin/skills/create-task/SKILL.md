---
name: create-task
description: "Notes a task for later from the user's own words, written so an agent can pick it up without designing the implementation: a title, the problem, why it matters, what to do, what is out of scope, and a kind. Creates it straight away in Clocktopus (or in the tracker the repository's instructions name), without starting it, and adds it to a goal when one is named. Use when the user asks to create, add, note, log or park a task, a to-do or an idea for later. To start on the work now, use start-work instead."
argument-hint: '"<what to do>" [goal number (G-3)]'
---

# Create a task for later

The user wants something remembered, not worked on now. Turn their words into
a task straight away: invoking this skill is the ask, so there is no draft to
confirm. Write it so an agent can later pick it up and carry it to a pull
request. Refining it further, with the refine skill, is an extra pass for when
the user isn't sure the task covers everything, not a step every task needs.

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
  again with `orgId`.

Then call `search_tasks` with `repositoryUrl` and a few distinctive words
from what the user described as `query`, trying another wording when nothing
comes back. When an open task clearly covers it, say so with its key and
title, and create nothing unless the user insists.

## 2. Write it

Start from the user's own words, and keep their wording where it already
works. Say what needs to be done and why, clearly enough for someone with no
context; leave how to build it to whoever picks it up.

- **Title:** one line, sentence case, stating the problem or the outcome
  rather than the fix (_"Invoice export leaves out credit notes"_, not _"Fix
  export"_).
- **Description,** in Markdown:
  - the problem or the need, in a few sentences;
  - **Why it matters:** a sentence or two;
  - **What to do:** a few bullets on what has to change, naming the page,
    tool or part of the code it lands in when the user's words or a quick look
    make that clear;
  - **Out of scope:** what is deliberately left out, when anything is.
- **Kind:** `bug`, `feature`, `improvement` or `tech`, as `create_task`
  describes them.

```markdown
Exporting invoices to CSV leaves out credit notes, so the export doesn't add
up to the period's revenue.

**Why it matters:** finance reconciles from this export every month.

**What to do:**

- Include credit notes in the invoice export, as negative amounts
- Add a column saying which rows are credit notes

**Out of scope:** the PDF export.
```

Don't design the implementation or ask how to build it. Ask a question only
when the words are too vague to say what needs doing at all.

Create it where the `create_task` description says: with `create_task`,
unless the repository's agent instructions name another tracker. Call
`create_task` with `repositoryUrl`, `title`, the description as `summary` (up
to 2000 characters) and `kind`, and leave out `agentSessionId`: this session
isn't working on the task, and tying it would move the session's spend there.
In a tracker, give the kind as its matching label or issue type.

When the user named a goal (`G-3`), call `set_goal_tasks` with it as `goalId`,
the project's `organizationId` as `orgId`, and the new key in `add`, which puts
it at the end of the goal's list.

## 3. Reply

In one or two lines: the task's key and title (with its link, for a tracker
task), that `start-work <key>` starts it, and that `refine <key>` checks it
against the code first, when the user wants to be sure it covers
everything.

## Don't

- Don't create a branch, switch branch or tie this session to the task.
- Don't start the work, design its implementation or ask how to build it. A
  quick look at the code to name where the work lands is fine.
- Don't create a second task for work an open task already covers.
