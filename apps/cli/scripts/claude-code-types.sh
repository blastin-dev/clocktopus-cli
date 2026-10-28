#!/usr/bin/env sh
#
# Copies the Claude Code engine's `claude-code` declarations, which the
# plugin's hooks module and its tests are type-checked against, to
# claude-plugin/types/claude-code/index.d.ts. `pnpm check-types` reads that
# copy, and CI runs `claude plugin test` on the version its first line names.
#
#   sh scripts/claude-code-types.sh [<declaration file>]
#
# The declaration file is either the one the engine lays beside a mod it loads
# from a folder of yours, `<mod>/.claude-plugin/types/claude-code/index.d.ts`,
# or the plugin-authoring skill's `types/claude-code.d.ts`, which Claude Code
# unpacks under `${TMPDIR:-/tmp}/claude-<uid>/bundled-skills/<version>/` once a
# session has started. Without an argument the script takes the skill's copy
# for the `claude` on PATH.
set -eu

cd "$(dirname "$0")/.."
TARGET=claude-plugin/types/claude-code/index.d.ts

if [ $# -gt 0 ]; then
  SOURCE=$1
else
  VERSION=$(claude --version | cut -d' ' -f1)
  SOURCE=$(ls -t "${TMPDIR:-/tmp}/claude-$(id -u)/bundled-skills/$VERSION"/*/plugin-authoring/types/claude-code.d.ts 2>/dev/null | head -n 1 || true)
  if [ -z "$SOURCE" ]; then
    echo "claude-code-types: no declarations for Claude Code $VERSION; start a session with it once, or pass the file" >&2
    exit 1
  fi
fi

if ! head -n 1 "$SOURCE" | grep -q '^// Written by Claude Code '; then
  echo "claude-code-types: $SOURCE is not the engine's declaration file" >&2
  exit 1
fi

# The skill's copy appends the inputs of the tools the session that unpacked it
# had, which differ between sessions; the engine's own file stops before them.
awk '/^\/\/ The inputs of the built-in tools this build has/ { exit } { print }' "$SOURCE" >"$TARGET"
echo "claude-code-types: $(head -n 1 "$TARGET" | sed 's|^// ||') -> $TARGET"
