# Clocktopus CLI

The command-line interface for [Clocktopus](https://clocktopus.app), published
on npm as
[`@blastin-dev/clocktopus-cli`](https://www.npmjs.com/package/@blastin-dev/clocktopus-cli),
and the Claude Code plugin it installs.

```bash
npm install -g @blastin-dev/clocktopus-cli
clocktopus init
```

What each command does is in [`apps/cli/README.md`](apps/cli/README.md), and
what each agent sends to Clocktopus, field by field, is in its
[What leaves your machine](apps/cli/README.md#what-leaves-your-machine) section.

## Where this code comes from

The CLI is developed in the private Clocktopus monorepo, next to the server it
talks to, and this repository is a copy of the CLI's part of it:

- `main` is the code of the newest version on npm, and each version's code is
  tagged `v<version>`. `clocktopus --version` tells you which tag you run.
- `develop` is synced on every change, so it holds work not released yet. Its
  `package.json` keeps the last released version until the next release.

Pull requests are welcome here, against `develop`: a maintainer applies an
accepted one upstream, and it comes back in the next sync with you as its
author. See
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
