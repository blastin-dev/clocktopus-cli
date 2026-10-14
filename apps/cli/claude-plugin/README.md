# Clocktopus plugin for Claude Code

`clocktopus agent setup` copies this folder into a local marketplace at
`~/.clocktopus/claude-marketplace` and installs it with `claude plugin install`
(`src/lib/claude-plugin.ts`). On the way it sets `version` in
`.claude-plugin/plugin.json` to the CLI's own version and writes `.mcp.json`,
which points the Clocktopus MCP server at the environment the CLI uses.

Claude Code loads a plugin from a local marketplace in place, so re-running
`agent setup` after upgrading the CLI updates the plugin at the next session.

The same `skills/` are installed for Codex CLI, OpenCode and Cursor in
`~/.agents/skills`, as `clocktopus-<name>` with the frontmatter `name` to
match (`src/lib/agent-skills.ts`), so write them for any agent: no Claude Code
commands, and nothing that needs the session-start line to work. A skill names
another by its short name (`the refine skill`) and never links to its files,
whose folder is named differently in each install; a link to a file in the
skill's own folder is fine.

Cost tracking does not live here: the telemetry settings and the SessionStart and
SessionEnd hooks stay in `~/.claude/settings.json`, written by `agent setup`.
