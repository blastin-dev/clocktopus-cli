# Clocktopus plugin for Claude Code

`clocktopus agent setup` copies this folder into a local marketplace at
`~/.clocktopus/claude-marketplace` and installs it with `claude plugin install`
(`src/lib/claude-plugin.ts`). On the way it sets `version` in
`.claude-plugin/plugin.json` to the CLI's own version and writes `.mcp.json`,
which points the Clocktopus MCP server at the environment the CLI uses.

Claude Code loads a plugin from a local marketplace in place. After an upgrade,
`clocktopus agent refresh` rebuilds the folder with the parts it already
carries, and the next session loads it.

The same `skills/` are installed for Codex CLI, OpenCode and Cursor in
`~/.agents/skills`, as `clocktopus-<name>` with the frontmatter `name` to
match (`src/lib/agent-skills.ts`), so write them for any agent: no Claude Code
commands, and nothing that needs the session-start line to work. A skill names
another by its short name (`the refine skill`) and never links to its files,
whose folder is named differently in each install; a link to a file in the
skill's own folder is fine.

Each skill folder is installed on its own, so what every skill does the same
way (signing in, the session id, the repository's context, creating a task)
lives once in `../skill-shared/setup.md`, and each skill that needs it links a
copy in its own folder as `[setup.md](setup.md)`. Edit the source, then run
`pnpm --filter @blastin-dev/clocktopus-cli skills:sync`;
`src/lib/skill-shared.test.ts` fails while a copy differs.

Cost tracking does not live here: the telemetry settings and the SessionStart and
SessionEnd hooks stay in `~/.claude/settings.json`, written by `agent setup`.

## Session panel

In Claude Code only, the plugin shows which task the session counts toward. A
host that runs Claude Code through the SDK runs the hooks but draws none of it.

`agent setup` installs it with the MCP server, on Claude Code
`PANEL_MIN_CLAUDE_VERSION` (`src/lib/claude-plugin.ts`, 2.1.310, the version
that wrote `types/claude-code/index.d.ts`) or later. Left out, or on an older
Claude Code, the marketplace it builds has no `hooks/`, `tests/` or `types/`,
and `plugin.json` no `types`.

- **Footer:** `CLK-12 · in progress · G-3 2/5 · attributed` among the mode
  labels under the prompt, with `· branch CLK-9` when the session is tied to a
  task other than the one its branch names, and `· CLI upgrade required` when
  the server no longer serves the CLI.
- **Pane:** the task with its stage in the web app's colours and an **Open**
  button for its page, the human and agent time on it, then this session: its
  id (**Copy id** copies it whole), whether it is attributed and to which task,
  the branch, the worktree, its spend and when it last reported, and the goal's
  open tasks in order (▶ this session's, ● started, ○ not started), and the
  CLI: its version (`clocktopus --version`, else the plugin's own), the one
  available and `clocktopus upgrade` when it is behind, and the plugin version
  this session loaded when the CLI was upgraded under it. In the
  fullscreen layout it docks as a sidebar and opens by itself once a session;
  elsewhere it opens inline, only when asked.
- **Band** above the prompt: the task, its attribution, its title and the
  goal's progress. Off until `/clocktopus-panel band`.

| Command                     | Does                                                 |
| --------------------------- | ---------------------------------------------------- |
| `/clocktopus-panel`         | Opens the pane, or closes it when it is up           |
| `/clocktopus-panel refresh` | Reads the session again and prints the footer's line |
| `/clocktopus-panel band`    | Shows or hides the band                              |

Everything comes from one call to the MCP server's `get_session_panel`, with
the `origin` remote (an SSH host alias resolved through `ssh -G`), the branch
and the session id. It needs the plugin's MCP server connected and signed in
(`/mcp`). In a repository Clocktopus doesn't know, outside a git repository,
or with the server turned off or signed out, the footer and band show nothing
and the pane doesn't open by itself.

It reads again at session start, when the checkout's `.git/HEAD` changes, when
the session changes directory, after `git checkout`, `git switch` or
`git worktree` in Bash and `EnterWorktree` or `ExitWorktree`, after any
Clocktopus MCP tool call, and every two minutes. A session Clocktopus doesn't
list yet is read again three times, ten seconds apart, since the SessionStart
hook reports it in the background.

## Developing the hooks module

`hooks/register.tsx` is the hooks module, `hooks/panel.ts` the logic it draws
from (reading `get_session_panel`'s answer, the footer line, the session's
rows, stages, amounts and remotes), `types/index.d.ts` the state it keeps and
`tests/` its tests under the engine. A hooks module imports nothing but its
plugin's own files and `claude-code` (the CLI's lint enforces it), so
`panel.ts` stays free of Node and npm packages: it checks `get_session_panel`'s
answer by hand rather than with Zod, formats times without date-fns, and keeps
its own copies of the CLI's remote rules and the web app's stage labels. The
CLI's tests hold each copy to its source: the answer to `SessionPanelSchema`,
the remote rules to `stripRemoteCredentials` and `resolveSshHostAlias`, the
stages to `TaskStageSchema`.

| Check                                                   | Runs                                                                                                                            | In `pr-checks` |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `pnpm --filter @blastin-dev/clocktopus-cli check-types` | `tsc` with `tsconfig.json` here, against `types/claude-code/index.d.ts`                                                         | yes            |
| `pnpm --filter @blastin-dev/clocktopus-cli lint`        | ESLint, as for the rest of the CLI                                                                                              | yes            |
| `pnpm --filter @blastin-dev/clocktopus-cli test`        | Vitest on `panel.ts` (`src/lib/claude-plugin-panel.test.ts`; a `*.test.ts` in this folder would run under `claude plugin test`) | yes            |
| `pnpm --filter @blastin-dev/clocktopus-cli test:plugin` | `claude plugin validate` and `claude plugin test` on this folder; needs `claude` on PATH but no sign-in                         | yes            |

`types/claude-code/index.d.ts` is a pinned copy of the engine's declarations;
its first line names the Claude Code version that wrote it, and CI installs
that version for `test:plugin`. To move to a newer Claude Code, start a session
with it once, then run `pnpm --filter @blastin-dev/clocktopus-cli
claude-code-types`, or pass it the declaration file the engine wrote
(`scripts/claude-code-types.sh` says where it finds one). The copy and
`tsconfig.json` stay out of the npm package and out of the marketplace
`agent setup` builds, since only these checks read them.
