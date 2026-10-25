# Clocktopus CLI

Command-line interface for [Clocktopus](https://clocktopus.app) time tracking.

## Installation

```bash
npm install -g @blastin-dev/clocktopus-cli
```

Or run directly with npx:

```bash
npx @blastin-dev/clocktopus-cli <command>
```

Every request sends the CLI's version in `X-Clocktopus-Cli-Version`. When the
server no longer supports that version it answers `426`, and the CLI prints the
server's message, which names the upgrade command, and exits with code `1`.
Device login, the agent hook and the telemetry agents export are never refused
for their version.

Its answers carry the latest published CLI version in `X-Clocktopus-Cli-Latest`,
which the server reads from the npm registry, caches for an hour, and leaves out
while it has never reached npm. When that is newer than the CLI's own, the CLI
prints one line to stderr, once per run, with the upgrade command. It stays
quiet when stderr is not a terminal, and the agent hook never prints it.

## Getting Started

From a checkout of the repository you work in:

```bash
clocktopus init
```

It signs you in first if needed, then sets up the account, the repository and
your agents, and checks the result. `clocktopus login` signs in on its own.

## Commands

### `clocktopus init`

Sets up this checkout, one confirmable step at a time:

1. **You** — timezone (this machine's by default) and working hours. Skipped
   when already confirmed, unless a flag changes them.
2. **Organisation and project** — when the `origin` remote already belongs to a
   project in one of your organisations, says which and creates nothing.
   Otherwise picks or creates the organisation, then attaches the repository
   to an existing project you manage or a new one.
3. **Repository** — for GitHub, installs the Clocktopus GitHub App through the
   browser and waits until it covers the repository (press `m` to switch to a
   webhook). With `gh` installed it can create the repository webhook itself;
   otherwise, and always for Bitbucket, it prints the URL and secret to add.
   For a GitHub webhook it then waits for GitHub's `ping` and says where the
   webhook was seen, which of its events are missing, or that the secret did
   not match. Bitbucket sends no ping; the verify step waits for a push.
4. **Git email** — compares `git config user.email` with your sign-in email and
   commit addresses, and offers to track it.
5. **Agents** — the `agent setup` survey for the agents installed here; says
   nothing when there are none.
6. **Verify** — project, author, commits, pull requests and agents, each from
   what Clocktopus has received. It says _all set_ only once a commit from this
   repository has been credited to you; otherwise it offers an empty commit and
   push, then watches for the delivery and prints the fix for whatever arrives.
   When the App and a repository webhook both deliver, it offers to delete your
   webhook with `gh`.

Finally it completes the first-run setup, so the web app opens on the
dashboard.

| Option                      | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| `-y, --yes`                 | Take every default without asking                                |
| `--skip <steps>`            | Skip `you`, `project`, `repository`, `email`, `agents`, `verify` |
| `--timezone <tz>`           | Your timezone, as an IANA name                                   |
| `--hours <start-end>`       | Your usual day: `9-17`, `08:30-17:00`                            |
| `--[no-]working-hours`      | Whether you work set hours                                       |
| `--organization <name>`     | Use this organisation (id, slug or name)                         |
| `--new-organization <name>` | Create an organisation                                           |
| `--project <name>`          | Attach the repository to this project (id or name)               |
| `--new-project <name>`      | Create a project with the repository                             |
| `--connect <how>`           | `app`, `gh`, `manual` or `skip`                                  |
| `--[no-]track-email`        | Track this checkout's git email when it is not yours yet         |
| `-a, --agent <ids>`         | Configure only these agents                                      |
| `-c, --component <names>`   | Install only these besides telemetry and hooks                   |
| `--test-push`               | Push an empty commit to the current branch to verify delivery    |
| `--delete-old-hook`         | Delete your repository webhook when the GitHub App also delivers |

Off a terminal, or with `--yes`, every question takes its default. Nothing is
installed, pushed or deleted without its flag: the repository is connected only
with `--connect`, and the test push and webhook removal need `--test-push` and
`--delete-old-hook`.

### `clocktopus login`

Authenticate using the device authorization flow. Opens a URL in your browser to approve access.

### `clocktopus logout`

Clear stored credentials.

### `clocktopus whoami`

Display the current authenticated user.

### `clocktopus clock (in|out)`

```
clocktopus clock (in|out) [--ago <duration> | --at <time>]
```

Record the start or end of a work session. Defaults to "now" when no
flag is passed.

| Option             | Description                                                                             |
| ------------------ | --------------------------------------------------------------------------------------- |
| `--ago <duration>` | Backdate by a duration from now (`15m`, `1h`, `1h30m`). Mutually exclusive with `--at`. |
| `--at <time>`      | Backdate to an absolute wall-clock time today (`HH:mm` or `HH:mm:ss`).                  |

### `clocktopus clock status`

```
clocktopus clock status [-d <YYYY-MM-DD>]
```

Show clock signals for a given date.

| Option              | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `-d, --date <date>` | Show signals for a specific date in `YYYY-MM-DD` format. Defaults to today. |

### `clocktopus agent setup`

```
clocktopus agent setup [--name <label>] [--force] [--agent <ids>] [--component <names>]
```

Configures this machine to report AI agent spend — token cost, active time,
and the repository each session worked in — so the true cost of a piece of
work can be measured as human time × rate **plus** agent spend.

One command, however many agents you have. It asks which agents to set up,
with the ones found on PATH already ticked, then which extras to install:

```
◆  Which agents should report to Clocktopus?
│  ◼ Claude Code (2.1.234, already configured)
│  ◼ Codex CLI (0.147.0)
│  ◻ OpenCode (not on PATH)
│  ◼ Cursor (1.7.52)
└

●  Telemetry and the session hooks are always installed. The hook tells
│  Clocktopus which repository a session worked in; without it, spend
│  cannot be counted towards a project or task.
│
◆  What else should setup install?
│  ◼ MCP server (lets the agent read and update Clocktopus tasks and goals)
│  ◼ Skills (create-task, start-work, refine and create-goal)
└
```

Telemetry and the `SessionStart` / `SessionEnd` hooks are always installed: the
hook is the only thing that tells Clocktopus which repository a session worked
in. An extra left unticked is left as it is in the agent's config. `--agent`
and `--component` answer the questions up front, and a non-interactive shell
skips both and installs everything into every agent found.

| Agent       | `--agent` id | Writes                                                                         |
| ----------- | ------------ | ------------------------------------------------------------------------------ |
| Claude Code | `claude`     | `~/.claude/settings.json`, the plugin                                          |
| Codex CLI   | `codex`      | `~/.codex/hooks.json`, `clocktopus.json`, `config.toml`, `~/.agents/skills`    |
| OpenCode    | `opencode`   | `~/.config/opencode/plugin/clocktopus.js`, `opencode.json`, `~/.agents/skills` |
| Cursor      | `cursor`     | `~/.cursor/hooks.json`, `mcp.json`, `clocktopus.json`, `~/.agents/skills`      |

It mints **one** ingest token for the machine, writes each agent's exporter
configuration and `SessionStart` / `SessionEnd` hooks, then confirms the
receiver accepts the token before reporting success.

For Claude Code it also writes Claude Code's content flags off
(`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
`OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT` and `OTEL_LOG_RAW_API_BODIES`,
each `0`), so prompts, responses, tool input and output and API bodies stay
redacted even when your shell exports one of them. Managed settings can still
turn them on; `agent doctor` and `agent status` warn when any is on in your
environment or `~/.claude/settings.json`.

For Claude Code it also installs the **Clocktopus plugin**, which carries the
skills and the Clocktopus MCP server. It is copied from this package into
`~/.clocktopus/claude-marketplace` and installed with `claude plugin install
clocktopus@clocktopus`. Claude Code loads it in place, so re-running `agent
setup` after upgrading the CLI updates it. Sign in to its MCP server once with
`/mcp` in Claude Code. Cost tracking does not depend on the plugin: disabling or
removing it leaves the telemetry and hooks reporting.

For Codex CLI, OpenCode and Cursor it copies the same skills into
`~/.agents/skills`, which all three load, as `clocktopus-create-task`,
`clocktopus-start-work`, `clocktopus-refine` and `clocktopus-create-goal`
(renamed so they cannot collide with skills of your own), and adds the MCP server to each
agent's own config: `[mcp_servers.clocktopus]` in `~/.codex/config.toml`,
`mcp.servers.clocktopus` in OpenCode 2's `opencode.json` (`mcp.clocktopus` in
OpenCode 1's), and `mcpServers.clocktopus` in
`~/.cursor/mcp.json`. Sign in to it once with `codex mcp login clocktopus`,
`opencode mcp auth clocktopus`, or from Cursor Settings → MCP.

The four skills keep you in flow: note an idea with `create-task` and take it
to a pull request with `start-work`, or set a goal with `create-goal` and have
`start-work` work it into stacked pull requests to review one at a time.
`refine` is the extra pass in between when you aren't sure a task covers
everything. They create tasks in
Clocktopus with `create_task`, unless the repository's agent instructions
(`CLAUDE.md`, `AGENTS.md`, a contributing guide) say to create them in another
tracker, and give each a kind (bug, feature, improvement or tech) from your
words.

The `create-task` skill (`/clocktopus:create-task "<what to do>"` in Claude
Code) notes a task for later from your words, written so an agent can pick it
up (the problem, why it matters, what to do, what is out of scope), straight
away, without starting it, and adds it to a goal you name.

The `start-work` skill carries a task through to an open pull request. It
picks up the task you name, the one the branch carries, an open task matching
what you describe or the goal's next one, creating a task for new work, ties
the session to it (`link_session`) and works on a branch whose name carries
the key. Before writing code it asks, in one round, the questions the task and
the code leave open and writes your answers into the task; then it does the
work, runs the repository's checks, commits with the key in the scope and
opens the pull request, stopping to ask when a decision is open, checks fail,
or the next step goes beyond a pull request. A synchronous `SessionStart`
hook, `clocktopus agent context`, tells each Claude Code, Codex and Cursor
session which task its branch carries, or that it carries none, with the
session's id and agent; for Cursor it prints that as the JSON
`additional_context` Cursor reads. When that line prompts `start-work` in a
session started for something else, it only ties the session and sets up the
branch. OpenCode has no hook whose output reaches the session, so there the
skill calls `link_session` without an id and Clocktopus ties the session live
in that repository. The hook reads only local git state and prints nothing
outside a repository. Given a goal's number (`G-3`, shown on its card),
`start-work` works through the goal's open tasks in order, unattended, each in
a background subagent that carries it to an open pull request stacked on the
one before (with `gh stack` on GitHub), while the session stays free to talk
to you.

The `refine` skill (`/clocktopus:refine BLA-12` or `/clocktopus:refine G-3` in
Claude Code) is the extra pass for when you aren't sure a task covers
everything: it gets tasks ready for an agent to take to a pull request without
asking. For a task, it checks the code, asks the questions the code can't
answer, writes the answers into the task and marks it refined. For a goal, it
first proposes the order of its tasks, releases, delivered tasks to close in
the tracker, duplicates and missing tasks, checked against git, pull requests
and agent sessions, then refines every task not yet refined in one round of
questions. It applies only what you confirm, and the goal's order lives in
Clocktopus: it isn't mirrored in the tracker.

The `create-goal` skill (`/clocktopus:create-goal "<goal>"` in Claude Code)
drafts a goal from what you describe and a light breakdown into the tasks its
outcome needs, in order, reusing open tasks that already cover part of it, and
creates them all once you confirm.

| Option            | Description                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `--name <label>`  | Label for this machine's token. Defaults to the hostname — keep it recognisable, since revocation is per token. |
| `--force`         | Mint a replacement token instead of reusing the one already installed.                                          |
| `-a, --agent`     | Configure only these agents. Repeatable, or comma-separated: `--agent claude,codex`.                            |
| `-c, --component` | Install only these besides telemetry and hooks: `mcp`, `skills`, or `none`. Repeatable, or comma-separated.     |

Re-running without `--force` is safe and idempotent: it repairs the hooks and
refreshes the endpoint while keeping the existing token. Installing a second
agent later and re-running costs nothing — the new one inherits the token the
first is already using rather than minting a second against the same machine.

**Restart the agent afterwards.** Every exporter and hook reads its
configuration once, at process start, so a session that is already open will
not pick any of it up. This is the most common reason a correct setup appears
to do nothing.

**OpenCode is a plugin, not a hook.** It has no hook system, so setup
writes one generated file into `~/.config/opencode/plugin/`, which OpenCode
auto-loads. The file is written for the OpenCode on your PATH: OpenCode 2
loads a different plugin shape from OpenCode 1 and refuses the other, so
after upgrading OpenCode across a major version `agent doctor` reports the
plugin as stale until setup runs again. In your `opencode.json` it adds only
the MCP server entry, since `opencode mcp auth` reads servers from there:
`mcp.servers.clocktopus` for OpenCode 2 and `mcp.clocktopus` for OpenCode 1,
moving an entry out of the other shape, and backs the file up first. OpenCode
2 still loads an `mcp.clocktopus` entry, so `agent doctor` accepts either
there. An `opencode.jsonc` with comments is left
alone: setup says so and prints the entry to add by hand. Uninstalling
telemetry is deleting the file.

OpenCode also has `experimental.openTelemetry`, which looks like an easier
route and is not one: its spans carry your prompts and the model's replies
verbatim, with no way to switch that off, and no cost or repository. The
plugin reads OpenCode's own usage totals instead (per message on OpenCode 1,
per model step on OpenCode 2) and sends counts and identifiers only.

**Cursor reports sessions, not spend.** Cursor exports usage only from its own
servers to a team admin, so setup installs `clocktopus agent hook` on Cursor's
`sessionStart` and `sessionEnd`, and `clocktopus agent context` on
`sessionStart`, in `~/.cursor/hooks.json`. Clocktopus records when each session
ran, its repository, branch, commits and task, and takes its runtime from the
`duration_ms` Cursor reports at `sessionEnd`, but no tokens or cost. That
duration is the session's length as Cursor measures it, which can include time
the agent sat waiting for you. Cursor passes a hook no
environment, so the token sits in `~/.cursor/clocktopus.json`, readable only by
you. It is detected by `cursor-agent` or the IDE's `cursor` command.

**Codex reports through its hook.** Codex's own OpenTelemetry log exporter
sends tool output (commands and the files they print) along with the token
counts, so setup does not turn it on, and removes the `[otel]` exporter an
older setup wrote into `~/.codex/config.toml`, leaving any `[otel]` keys of
your own. Instead `clocktopus agent hook`, on each `SessionStart` and
`SessionEnd`, reads the session's own record,
`~/.codex/sessions/YYYY/MM/DD/rollout-*-<session id>.jsonl` (under
`CODEX_HOME` when set), and sends only the token totals, the model, how long
each turn took and the session id. It parses no other line of that file:
prompts, replies and tool output stay on your machine. It sends only what was
added since its last report, so a resumed session is not counted twice, even
after `agent disable` and setup again: how far each session was reported is
kept in `~/.cache/clocktopus/codex-spend`, which `agent disable` leaves in
place. An entry untouched for 90 days is deleted, and a session with no entry
sends only turns from the last 90 days. The token sits in `~/.codex/clocktopus.json`, readable only by you, because Codex
passes a hook no environment from its config.

Until setup runs again with this CLI, an older install keeps reporting through
Codex's exporter, and `agent doctor` flags it.

**Codex needs one extra step, once.** It will not run a `hooks.json` it has
not been shown, so the next Codex session asks — answer _Trust all and
continue_. Until you do, Clocktopus records neither what Codex sessions cost
nor which repository they were spent on. `clocktopus agent doctor` reports
the state until it is approved.

Everything for an agent lands in that agent's own config rather than a shell
profile. That single source of truth per agent is what lets `agent doctor`
say which value is actually in force. Note the ingest token is stored there
in plaintext: if you keep `~/.claude` or `~/.codex` in a dotfiles repository,
ignore the file.

Setup then checks the repository you ran it in, because configuring the
machine is only half the job — sessions will arrive either way, but two
things decide whether they mean anything, and neither is visible locally:

| Check                            | If it fails                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Repository attached to a project | Spend is recorded, but lands in the unattributed row instead of against a client |
| Pushes delivering                | No human time entries, so there is nothing to compare the spend against          |

Both checks follow the remote a session from the checkout is attributed
through: every remote counts, not only `origin`, so on a fork whose upstream is
attached to the project they report the upstream.

The second does **not** stop agent→commit links — the SessionEnd hook reads
your checkout's own reflog locally and posts the commits it authored, so those
are created with no webhook involved. What is missing is the other side of
the comparison: true cost is human time × rate _plus_ agent spend, and one
term alone is not a smaller answer.

Both are reported separately, with the exact next step, because they send
you to two different places. Setup only tells you — it never changes your
GitHub settings.

One connection covers the whole team, so the commit lane looks at your
organisation's connections, not only yours: the GitHub App installed on the
repository's owner (on a personal account, with the repository in its
selection), or a webhook that has already delivered from the repository. When
a teammate's connection covers it, setup names it and waits for a push; it
explains how to connect one only when nothing in the organisation covers the
repository. A personal-account installation hooks only the repositories its
organisation's projects attach, so until one does, setup points you to the
Project check instead.

### `clocktopus agent status`

Shows what the receiver has actually received. Local configuration is a
claim; this is the evidence.

The two ingest lanes are reported separately because they fail separately:

| Lane  | Carries                          | If it alone goes quiet                                   |
| ----- | -------------------------------- | -------------------------------------------------------- |
| Hook  | repository, branch, commit range | spend is recorded but cannot be attributed to a project  |
| Spend | tokens, cost, active time        | sessions show `$0.00`, indistinguishable from cheap work |

It also lists every supported agent found on this machine, including any
that are installed but _not_ reporting — a state the server-side lanes
cannot show, because those sessions simply never arrive.

That second failure is why there is no single "connected" line — it is the
one that silently understates what work cost.

### See exactly what the hook sends

Set `CLOCKTOPUS_HOOK_DRY_RUN` and `clocktopus agent hook` prints every request
it would make — the session report to `/v1/agent-session`, Codex's spend to
`/v1/traces`, and the close of any abandoned session — as a `POST <url>` line
followed by the exact JSON body, and sends nothing. The token is never printed.
To try it by hand, pipe it the payload an agent would:

```bash
echo '{"hook_event_name":"SessionStart","session_id":"x","cwd":"'$PWD'"}' \
  | CLOCKTOPUS_HOOK_DRY_RUN=1 clocktopus agent hook
```

Add `--provider codex_cli` and a real Codex session id, with
`"hook_event_name":"SessionEnd"`, to see the spend report for that session.

| Value                    | Output                       |
| ------------------------ | ---------------------------- |
| `1`, `true`, `yes`, `on` | stderr                       |
| a file path              | appended to that file        |
| unset, `0`, `false`      | off: the hook sends as usual |

`--dry-run [file]` does the same from the command line. Lines starting with `#`
say why nothing was sent, such as a missing token. A dry run never writes to
stdout, always exits `0`, runs in the foreground rather than detaching, and
changes no state under `~/.cache/clocktopus`, so the next real run still sends
everything, Codex spend included.

To watch a live session, start the agent from a shell with
`CLOCKTOPUS_HOOK_DRY_RUN` set to a file path, since agents do not show a hook's
stderr. That session's reports are then not sent at all.

### `clocktopus agent doctor`

Checks every link in the chain, per agent, and names the first one that is
broken: the config file parses, the exporter is configured, every signal the
receiver reads is being sent, both hooks are installed, the hook command
actually executes, Codex has approved its hooks, the receiver accepts the
token, no other file is shadowing the configuration, Claude Code's content
flags are off, and whether that agent needs restarting.

The signals check is there for configurations written before a signal
existed. Those still hold a valid token and endpoint, so everything else
passes while one stream never leaves the machine — a Claude Code
configuration without the logs exporter reports cost correctly and no
sub-agent runtime at all.
Re-running `agent setup` merges the missing keys in; nothing needs removing
first. The repository
checks — attached to a project, delivering commits — run once at the end,
since they are facts about the repo rather than about any one agent.

The receiver check is the one that cannot be done locally — it crosses the
network to a different host than the dashboard, so a wrong endpoint and a
revoked token are otherwise indistinguishable from an idle afternoon.

### `clocktopus agent disable`

```
clocktopus agent disable [--revoke] [--agent <ids>]
```

Removes this machine's telemetry configuration from every agent, leaving any
hooks and settings you added yourself untouched. For Claude Code it also
uninstalls the Clocktopus plugin and removes its local marketplace; for Codex,
OpenCode and Cursor it removes the MCP server entry, and the skills in
`~/.agents/skills` once none of them still reports.

| Option        | Description                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `--revoke`    | Also revoke the ingest token, making it useless everywhere.                                       |
| `-a, --agent` | Remove only these agents (`claude`, `codex`, `opencode`, `cursor`), leaving the others reporting. |

`--revoke` is ignored when combined with `--agent`: the token is shared by
every agent on the machine, so killing it while another one still has it
written would leave that agent posting into a 401 forever — which looks
like an idle week rather than a broken install.

Stopping and revoking are separate on purpose: removing the local
configuration stops _this_ machine reporting, but does nothing about a token
that has already been copied elsewhere or committed.

## What leaves your machine

`clocktopus agent setup` points every agent at one host, the Clocktopus
receiver, and every request to it carries the machine's ingest token as a
bearer. This section lists each request, what is in it and the file that
builds it, so it can be checked from this repository alone. The receiver's
source is not in this repository; the files it names are in the Clocktopus
monorepo, under `packages/core/src/agent-telemetry/`.

### Who sends what

| Agent                | Sender                                | Endpoint            | Carries                                                                                                                                                                                                         | Built by                                                                                                        |
| -------------------- | ------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Claude Code          | Claude Code's own metrics exporter    | `/v1/metrics`       | Cost, tokens by type, active time, lines of code, commit and pull request counts, sessions; each with the session id, model, query source and terminal type, plus Claude Code's standard attributes (see below) | Claude Code, configured by [`src/lib/claude-settings.ts`](src/lib/claude-settings.ts) (`buildTelemetryEnv`)     |
| Claude Code          | Claude Code's own logs exporter       | `/v1/logs`          | Claude Code's event stream: prompt, API request, tool and sub-agent events, with their content redacted while the content flags are off                                                                         | Claude Code, configured by [`src/lib/claude-settings.ts`](src/lib/claude-settings.ts)                           |
| Codex CLI            | `clocktopus agent hook`               | `/v1/traces`        | Token totals per model, the duration of each completed turn, the session id and Codex's version                                                                                                                 | [`src/lib/codex-spend.ts`](src/lib/codex-spend.ts), from [`src/lib/codex-rollout.ts`](src/lib/codex-rollout.ts) |
| OpenCode             | The generated plugin                  | `/v1/traces`        | Per model call: its start and end, the session id, model, provider, token counts and OpenCode's own cost estimate, plus OpenCode's version                                                                      | [`src/lib/opencode-config.ts`](src/lib/opencode-config.ts) (`buildOpencodePlugin`)                              |
| All four             | `clocktopus agent hook`               | `/v1/agent-session` | The session report (next table)                                                                                                                                                                                 | [`src/commands/agent/hook.ts`](src/commands/agent/hook.ts)                                                      |
| None (setup, doctor) | `clocktopus agent setup` and `doctor` | `/v1/verify`        | `{}`, to check the token                                                                                                                                                                                        | [`src/lib/agent-receiver.ts`](src/lib/agent-receiver.ts)                                                        |

Cursor sends only the session report. OpenCode's plugin hands its session
start and end to `clocktopus agent hook` as a session id, event name and
directory. `clocktopus agent context` makes no request at all: it reads local
git state and prints to the session.

The session report, from every agent:

| Field                               | Value                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`                          | `claude_code`, `codex_cli`, `opencode` or `cursor`                                                                                            |
| `session_id`, `hook_event_name`     | The agent's session id; `SessionStart` or `SessionEnd`                                                                                        |
| `cwd`                               | The session's directory, as `~/…` when it is under your home directory ([`src/lib/home-relative-path.ts`](src/lib/home-relative-path.ts))     |
| `source`, `reason`                  | The start source and end reason the agent passes its hook, when it passes one                                                                 |
| `repository_url`, `repository_urls` | Every git remote URL of the checkout, `origin` first, as `git remote -v` prints it less any credential in it (below)                          |
| `git_branch`                        | The checked-out branch                                                                                                                        |
| `git_head_before`, `git_head_after` | The HEAD commit at the session's start and end                                                                                                |
| `commit_shas`                       | Up to 200 commit SHAs made in the checkout during the session, from its reflog ([`src/lib/declared-commits.ts`](src/lib/declared-commits.ts)) |
| `duration_ms`                       | Cursor only: the session length Cursor reports at its end                                                                                     |
| `ended_at`                          | Only when closing a session that never sent `SessionEnd`: the time it was last active                                                         |

No remote URL is sent with a credential in it. The CLI drops the user name,
password or token from an `https://` remote (`https://user:<token>@host/…` is
sent as `https://host/…`) and the password from an SSH one, keeping its user
(`git@host:…`), which the receiver needs to read the repository. `clocktopus
init` names the repository the same way. The rule is `stripRemoteCredentials`
in [`packages/cli-contract/src/remote-url.ts`](../../packages/cli-contract/src/remote-url.ts), applied in
[`src/lib/git-remotes.ts`](src/lib/git-remotes.ts) and
[`src/commands/init/checkout.ts`](src/commands/init/checkout.ts); the receiver
applies it too before it reads or stores a remote.

The hook reads only `session_id`, `cwd` (or Cursor's `workspace_roots`),
`hook_event_name`, `duration_ms`, `source`, `reason` and `transcript_path` from
what the agent pipes it, and ignores the rest
([`src/lib/hook-payload.ts`](src/lib/hook-payload.ts)). `transcript_path` is
never sent: for Codex it locates the session's rollout file, of which only the
`session_meta`, `turn_context`, `token_count` and `task_complete` lines are
parsed. To see the exact bytes, run the hook in
[dry-run mode](#see-exactly-what-the-hook-sends). A dry run covers every
request `agent hook` makes, and not what Claude Code's exporters or the
OpenCode plugin send directly.

### What Claude Code sends itself

Claude Code runs its own exporters, so what it sends follows its settings.
Setup writes `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`,
`OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT` and `OTEL_LOG_RAW_API_BODIES`
as `0` in the `env` of `~/.claude/settings.json`, which takes precedence over
your shell. Claude Code's managed settings take precedence over that file, so
an organisation's managed policy can still turn a flag on, and Claude Code then
sends that content to `/v1/logs`. The receiver reads only `subagent_completed`
records and the time of each `user_prompt` from that stream, and discards
everything else unread, but the content has left your machine by then.

`agent doctor` and `agent status` warn when a content flag is on in the
environment they run in, in `~/.claude/settings.json`, or in a managed settings
file, and name the file. They read the files Claude Code reads, in its order:
`managed-settings.json` and then each `*.json` in `managed-settings.d/`
alphabetically, in `/Library/Application Support/ClaudeCode/` on macOS,
`/etc/claude-code/` on Linux and WSL and `C:\Program Files\ClaudeCode\` on
Windows ([`src/lib/claude-settings.ts`](src/lib/claude-settings.ts),
`findContentFlagsOn`). A managed file that is not valid JSON is reported as
unreadable. Policy delivered as an MDM profile, a Windows registry value or
server-managed settings from the claude.ai console leaves no file, so neither
command sees a flag it turns on; Claude Code's `/status` names the managed
source in force. A repository's `.claude/settings.json` and
`.claude/settings.local.json` can't turn a flag on: Claude Code (v2.1.282 or
later) applies a content flag from them only when it turns the flag off.

Claude Code also attaches its standard attributes to every metric and event,
including the signed-in account's `user.account_uuid`, `user.email` and
`organization.id`. The receiver does not read them.

Codex's own OpenTelemetry exporter is not used: setup does not turn it on, and
removes the `[otel]` exporter an older setup wrote.

### What the receiver reads

Each normaliser reads attributes through an allowlist and ignores every other
key. OTLP log record bodies are never parsed, and the receiver never writes a
request body to its logs: on an error it logs the error's class, code and
stack frames, and for a failed query its SQL statement (placeholders, no
values) and the Postgres table, column, constraint and routine, never the
error's message, detail or params.

| Endpoint            | Normaliser                      | Reads                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/metrics`       | `normalize-claude-code.ts`      | Metrics `claude_code.session.count`, `cost.usage`, `token.usage`, `active_time.total`, `lines_of_code.count`, `commit.count`, `pull_request.count`; point attributes `session.id`, `model`, `query_source`, `type`, `start_type`, `terminal.type`; resource `service.version`                                                                                                                                        |
| `/v1/logs`          | `normalize-claude-code-logs.ts` | Scope `com.anthropic.claude_code.events`, `subagent_completed` and `user_prompt` records only: `event.name`, `event.timestamp`, `session.id`, `terminal.type`, `duration_ms`                                                                                                                                                                                                                                         |
| `/v1/logs`          | `normalize-codex-logs.ts`       | Scope `codex_otel.log_only`: `event.name`, `event.kind`, `event.timestamp`, `conversation.id`, `app.version`, `model`, `slug`, `terminal.type`, `duration_ms`, `input_token_count`, `output_token_count`, `cached_token_count`, `cache_write_token_count`                                                                                                                                                            |
| `/v1/traces`        | `normalize-genai-traces.ts`     | Span name, start and end; `gen_ai.client.session_id` (or `gen_ai.conversation.id`, `session.id`), `gen_ai.client.name` (or `gen_ai.provider.name`, resource `service.name`), `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `cost`, `vcs.repository.name`, `vcs.ref.head.name`; resource `service.version` |
| `/v1/agent-session` | `agent-session-hook.ts`         | The session report fields above. `transcript_path` is accepted and never read                                                                                                                                                                                                                                                                                                                                        |

### The ingest token

The ingest token (`ctop_agt_…`) is accepted only by the receiver. With it, a
request can write the token owner's agent sessions, their spend, the commits
and tasks linked to them, and a clock-in started from a session; `/v1/verify`
returns the owner's user id. It reads nothing else back, and the web app, its
API and the MCP server do not accept it. `clocktopus agent disable --revoke`
revokes it.

| Agent       | Stored in                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------- |
| Claude Code | `~/.claude/settings.json`, as `CLOCKTOPUS_INGEST_TOKEN` and in `OTEL_EXPORTER_OTLP_HEADERS` |
| Codex CLI   | `~/.codex/clocktopus.json`                                                                  |
| OpenCode    | `~/.config/opencode/plugin/clocktopus.js`                                                   |
| Cursor      | `~/.cursor/clocktopus.json`                                                                 |

Each is written to a new file at mode `0600` and renamed into place, so only
you can read it ([`src/lib/credentials-file.ts`](src/lib/credentials-file.ts)
for the two `clocktopus.json` files). The `.clocktopus-backup` copy setup keeps
of `settings.json` and of the plugin has the mode of the file it copies.

The MCP server and the skills are separate from all of the above: they send
Clocktopus what the agent writes into a task or goal, through the MCP server
you sign in to, not with the ingest token.

## Token Storage

Credentials are stored in a platform-specific config directory:

- **macOS**: `~/Library/Preferences/clocktopus-cli-nodejs/conf
ig.json`
- **Linux**: `~/.config/clocktopus-cli-nodejs/config.json`
- **Windows**: `%APPDATA%/clocktopus-cli-nodejs/config.json`

Run `clocktopus logout` to clear stored credentials.

The agent telemetry setup deliberately keeps **no** copy of the ingest token
here. It has to live in each agent's own config for that agent's exporter to
read it, and a second copy would be another thing to leak and another thing
to fall out of date. Only the token id (needed to revoke) and its display
prefix are kept.
