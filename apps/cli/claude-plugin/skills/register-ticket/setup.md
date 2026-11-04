# Clocktopus setup

What every Clocktopus skill does the same way. The skill that links here says
what to do on `no_project`.

## Signing in

If the Clocktopus MCP tools aren't available, the server needs signing in.
Ask the user to sign in, then continue: `/mcp` in Claude Code,
`codex mcp login clocktopus` in Codex, `opencode mcp auth clocktopus` in
OpenCode.

## The session id

At session start, Claude Code, Codex and Cursor show a line from Clocktopus
saying whether the current branch carries a task, with the session id and
agent (`Session id: …, agent codex_cli.`). Pass them as `agentSessionId` and
`agent` where a skill ties the session to a task. OpenCode shows no such line:
there, leave both out of every call.

## Reading the repository's context

Get the remote with `git remote get-url origin` and call
`get_repository_context` with it as `repositoryUrl`. When the Clocktopus line
at session start gives a resolved URL for an SSH host alias, use that instead,
as `repositoryUrl` in every call. When `status` is:

- `no_project`: the repository is linked to no Clocktopus project the user can
  write to. Say so once and suggest linking it in Clocktopus.
- `choose_organization`: several organisations link it. Ask which, then call
  again with `orgId`, and pass it to every call after.

Pass the project's `organizationId` as `orgId` to the tools that take no
`repositoryUrl`, such as the goal tools and `get_ticket_flow`.

## Searching for a task

Call `search_tasks` with `repositoryUrl` and a few distinctive words of the
work as `query`, trying another wording when nothing comes back. An open task
that clearly covers the work is used instead of a new one.

## Creating a task

Choose where, first match wins:

1. **The repository's agent instructions** (`CLAUDE.md`, `AGENTS.md`, a
   contributing guide) name where tasks go: there.
2. **One prefix in `trackerKeyPrefixes` is `connected`:** in its `tracker`,
   through that tracker's MCP tools, in the team or project its tickets with
   that prefix live in, then register it straight away as below. When several
   prefixes are `connected`, ask the user which, listing each prefix and its
   tracker.
3. **Otherwise:** in Clocktopus. When `trackerKeyPrefixes` isn't empty, say in
   one line why its tracker wasn't used: for a prefix with a `tracker`, that
   tracker isn't connected to Clocktopus; for one whose `tracker` is null,
   Clocktopus hasn't received a ticket with it yet, so it can't tell which
   tracker the prefix belongs to.

When the chosen tracker's MCP tools aren't available, say so and offer to
create the task in Clocktopus instead; create nothing until the user answers.

In Clocktopus, call `create_task` with `repositoryUrl`, `title`, the
description as `summary` (Markdown, up to 5000 characters, with literal
newlines) and `kind`. In a tracker, the tracker gives its key and link.

- **Kind:** `bug`, `feature`, `improvement` or `tech`, as `create_task`
  describes them. In a tracker, give it as the matching label or issue type.
- **The session:** pass `agentSessionId` and `agent` to `create_task` only
  when this session is about to work on the task, which ties the session to
  it. Leave them out for a task noted for later: tying it would move the
  session's spend there.

## Registering a tracker ticket

A Linear or Jira ticket gets into Clocktopus under its own key, before or
without the tracker's webhook, through `register_ticket`. Register one right
after creating it in a tracker, and before working on a tracker key that
`get_task` returns as `null` or without a title. Read the ticket through the
tracker's MCP tools, then call `register_ticket` with:

- `repositoryUrl`, the ticket's `key`, and the tracker as `provider` (`linear`
  or `jira`);
- `externalId`: the tracker's own id for the issue (a Linear issue's `id`, a
  Jira issue's numeric `id`), never its key. Leave it out only when the
  tracker's tools return none;
- `title`, its description as `summary` (Markdown, up to 5000 characters, cut
  at a paragraph when longer), and its page as `url`;
- `kind`, from its issue type or labels (a Bug is `bug`); leave it out when
  none fits;
- `createdAt`: when the ticket was created in the tracker, as an ISO 8601
  date-time, so the task counts from then.

After changing a ticket in a tracker that isn't in `trackers`, register it
again: no webhook brings the change, and `update_task` edits only Clocktopus
tasks.

When the tracker's MCP tools aren't available, or `register_ticket` refuses
the key's prefix, say so in one line and carry on: the key still names the
work in branches and commits once the project declares its prefix.
