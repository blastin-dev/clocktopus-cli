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
| Codex CLI   | `codex`      | `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.agents/skills`              |
| OpenCode    | `opencode`   | `~/.config/opencode/plugin/clocktopus.js`, `opencode.json`, `~/.agents/skills` |
| Cursor      | `cursor`     | `~/.cursor/hooks.json`, `mcp.json`, `clocktopus.json`, `~/.agents/skills`      |

It mints **one** ingest token for the machine, writes each agent's exporter
configuration and `SessionStart` / `SessionEnd` hooks, then confirms the
receiver accepts the token before reporting success.

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

**Codex needs one extra step, once.** It will not run a `hooks.json` it has
not been shown, so the next Codex session asks — answer _Trust all and
continue_. Until you do, Codex reports what your sessions cost but not which
repository they were spent on. `clocktopus agent doctor` reports the state
until it is approved.

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

### `clocktopus agent doctor`

Checks every link in the chain, per agent, and names the first one that is
broken: the config file parses, the exporter is configured, every signal the
receiver reads is being sent, both hooks are installed, the hook command
actually executes, Codex has approved its hooks, the receiver accepts the
token, no other file is shadowing the configuration, and whether that agent
needs restarting.

The signals check is there for configurations written before a signal
existed. Those still hold a valid token and endpoint, so everything else
passes while one stream never leaves the machine — a Claude Code install
predating BLA-671 reports cost correctly and no sub-agent runtime at all.
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
