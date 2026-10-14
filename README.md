# Clocktopus CLI

The command-line interface for [Clocktopus](https://clocktopus.app), published
on npm as
[`@blastin-dev/clocktopus-cli`](https://www.npmjs.com/package/@blastin-dev/clocktopus-cli),
and the Claude Code plugin it installs.

```bash
npm install -g @blastin-dev/clocktopus-cli
clocktopus init
```

What each command does is in [`apps/cli/README.md`](apps/cli/README.md).

## Where this code comes from

The CLI is developed in the private Clocktopus monorepo, next to the server it
talks to, and this repository is a copy of the CLI's part of it, synced on every
change. Pull requests are welcome here: a maintainer applies an accepted one
upstream, and it comes back in the next sync with you as its author. See
[CONTRIBUTING.md](CONTRIBUTING.md).

| Path                         | What it is                                               |
| ---------------------------- | -------------------------------------------------------- |
| `apps/cli`                   | The CLI, with the Claude Code plugin in `claude-plugin/` |
| `packages/cli-contract`      | The request and response shapes the CLI and server share |
| `packages/eslint-config`     | Shared ESLint configuration                              |
| `packages/prettier-config`   | Shared Prettier configuration                            |
| `packages/typescript-config` | Shared TypeScript configuration                          |

## License

[MIT](LICENSE)
