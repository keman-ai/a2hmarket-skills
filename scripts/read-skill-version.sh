#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_PATH="${1:-$ROOT_DIR/SKILL.md}"

if [[ ! -f "$SKILL_PATH" ]]; then
  echo "skill file not found: $SKILL_PATH" >&2
  exit 1
fi

awk '
  NR == 1 && /^---[[:space:]]*$/ {
    in_frontmatter = 1
    next
  }
  in_frontmatter && /^---[[:space:]]*$/ {
    exit
  }
  in_frontmatter && /^version:[[:space:]]*/ {
    value = $0
    sub(/^version:[[:space:]]*/, "", value)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
    gsub(/^["'\'']|["'\'']$/, "", value)
    print value
    exit
  }
' "$SKILL_PATH"
