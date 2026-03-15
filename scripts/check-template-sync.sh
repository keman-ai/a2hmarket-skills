#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_SETUP="$ROOT_DIR/setup.sh"
OFFLINE_TEMPLATE="$ROOT_DIR/packaging/offline/setup.sh"

if ! cmp -s "$ROOT_SETUP" "$OFFLINE_TEMPLATE"; then
  echo "[template-sync] setup.sh drift detected between root and packaging/offline/setup.sh" >&2
  exit 1
fi

echo "[template-sync] setup.sh is in sync with packaging/offline/setup.sh"
