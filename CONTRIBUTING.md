# Contributing to the Clocktopus CLI

## How changes get in

This repository is a copy of the CLI's part of the private Clocktopus monorepo,
synced from it on every change, with the same folder layout. Pull requests are
welcome. Nothing is merged here: a maintainer applies an accepted pull request
to the monorepo as a patch, with you as the commit's author, and the next sync
brings it back here.

Changes to `packages/cli-contract` change what the CLI expects from the server,
so they may wait for a matching server change before they are applied.

## Setup

You need Node.js 22 and pnpm, at the version `packageManager` in `package.json`
names (`corepack enable` picks it up).

```bash
pnpm install
pnpm build    # bundles the CLI into apps/cli/dist/bin/clocktopus.js
```

`pnpm --filter @blastin-dev/clocktopus-cli dev` rebuilds on every change.

## Checks

The same checks run on every pull request:

```bash
pnpm check-types
pnpm lint
pnpm test
pnpm build
pnpm format       # Prettier; `pnpm --filter <package> format:fix` rewrites
```

## Running your build

```bash
# Against production (https://clocktopus.app), the default
node apps/cli/dist/bin/clocktopus.js whoami

# Against a Clocktopus server on http://localhost:3000
node apps/cli/dist/bin/clocktopus.js --env dev whoami

# Against any other URL
CLOCKTOPUS_API_URL=https://clocktopus.example.com node apps/cli/dist/bin/clocktopus.js whoami
```

`CLOCKTOPUS_API_URL` takes precedence over `--env`. Your build and an installed
CLI share one stored sign-in, so signing in against another server replaces the
installed CLI's.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org)
(`feat: …`, `fix: …`). The CLI's version and its public changelog come from
them, so write the subject for someone who uses the CLI.
