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

Create it where the `create_task` description says: with `create_task`,
unless the repository's agent instructions name another tracker. Call
`create_task` with `repositoryUrl`, `title`, the description as `summary`
(Markdown, up to 5000 characters, with literal newlines) and `kind`.

- **Kind:** `bug`, `feature`, `improvement` or `tech`, as `create_task`
  describes them. In a tracker, give it as the matching label or issue type.
- **The session:** pass `agentSessionId` and `agent` only when this session is
  about to work on the task, which ties the session to it. Leave them out for
  a task noted for later: tying it would move the session's spend there.
