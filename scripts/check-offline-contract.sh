#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <path-to-install.zip>" >&2
  exit 1
fi

ZIP_PATH="$1"

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "[contract] zip not found: $ZIP_PATH" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "[contract] unzip is required" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

LISTING="$TMP_DIR/listing.txt"
unzip -Z1 "$ZIP_PATH" >"$LISTING"

require_entry() {
  local entry="$1"
  if ! grep -Fxq "$entry" "$LISTING"; then
    echo "[contract] missing required entry: $entry" >&2
    exit 1
  fi
}

if grep -Ev '^a2hmarket/' "$LISTING" >/dev/null 2>&1; then
  echo "[contract] every archive entry must be rooted at a2hmarket/" >&2
  exit 1
fi

require_entry "a2hmarket/"
require_entry "a2hmarket/SKILL.md"
require_entry "a2hmarket/package.json"
require_entry "a2hmarket/a2hmarket-runtime.tgz"
require_entry "a2hmarket/setup.sh"
require_entry "a2hmarket/docs/"
require_entry "a2hmarket/docs/listener.md"
require_entry "a2hmarket/references/"
require_entry "a2hmarket/references/setup.md"
require_entry "a2hmarket/references/commands.md"
require_entry "a2hmarket/references/inbox.md"
require_entry "a2hmarket/references/listener-config.md"

SETUP_PATH="$TMP_DIR/setup.sh"
unzip -p "$ZIP_PATH" a2hmarket/setup.sh >"$SETUP_PATH"

if ! grep -Fq -- "--agent-id" "$SETUP_PATH"; then
  echo "[contract] setup.sh must keep --agent-id support" >&2
  exit 1
fi

if ! grep -Fq -- "--key" "$SETUP_PATH"; then
  echo "[contract] setup.sh must keep --key support" >&2
  exit 1
fi

if ! grep -Fq 'AUTH_PAGE=' "$SETUP_PATH"; then
  echo "[contract] setup.sh must keep browser authorization support" >&2
  exit 1
fi

EXTRACT_DIR="$TMP_DIR/extracted"
RUNTIME_STATE_DIR="$TMP_DIR/runtime-state"
BROWSER_STATE_DIR="$TMP_DIR/browser-state"

unzip -qq "$ZIP_PATH" -d "$EXTRACT_DIR"
chmod +x "$EXTRACT_DIR/a2hmarket/setup.sh"

if ! A2HMARKET_STATE_DIR="$RUNTIME_STATE_DIR" \
     A2HMARKET_SETUP_SKIP_INSTALL=1 \
     A2HMARKET_SETUP_SKIP_START=1 \
     bash "$EXTRACT_DIR/a2hmarket/setup.sh" \
       --agent-id ag_contract_test \
       --key key_contract_test >"$TMP_DIR/manual-auth.log" 2>&1; then
  echo "[contract] setup.sh manual credential flow failed" >&2
  cat "$TMP_DIR/manual-auth.log" >&2
  exit 1
fi

CONFIG_PATH="$RUNTIME_STATE_DIR/config.sh"
if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "[contract] setup.sh did not create config.sh during manual credential flow" >&2
  exit 1
fi

if ! grep -Fq 'AGENT_ID="ag_contract_test"' "$CONFIG_PATH"; then
  echo "[contract] config.sh missing AGENT_ID from manual credential flow" >&2
  exit 1
fi

if ! grep -Fq 'AGENT_KEY="key_contract_test"' "$CONFIG_PATH"; then
  echo "[contract] config.sh missing AGENT_KEY from manual credential flow" >&2
  exit 1
fi

if ! A2HMARKET_STATE_DIR="$BROWSER_STATE_DIR" \
     A2HMARKET_SETUP_SKIP_INSTALL=1 \
     A2HMARKET_SETUP_SKIP_START=1 \
     bash "$EXTRACT_DIR/a2hmarket/setup.sh" >"$TMP_DIR/browser-auth.log" 2>&1; then
  echo "[contract] setup.sh browser authorization flow failed" >&2
  cat "$TMP_DIR/browser-auth.log" >&2
  exit 1
fi

if [[ ! -f "$BROWSER_STATE_DIR/.auth_pending" ]]; then
  echo "[contract] setup.sh did not create .auth_pending during browser authorization flow" >&2
  exit 1
fi

if ! grep -Fq "https://a2hmarket.ai/authcode?code=" "$TMP_DIR/browser-auth.log"; then
  echo "[contract] setup.sh browser authorization output is missing auth URL" >&2
  exit 1
fi

echo "[contract] offline install contract checks passed"
