#!/bin/sh
# Copies skill-shared/setup.md into every skill folder whose SKILL.md links it,
# since each skill folder is installed on its own (src/lib/agent-skills.ts).
set -eu
cd "$(dirname "$0")/.."
for skill in claude-plugin/skills/*/; do
  if grep -q '](setup.md' "$skill/SKILL.md"; then
    cp skill-shared/setup.md "$skill/setup.md"
  else
    rm -f "$skill/setup.md"
  fi
done
