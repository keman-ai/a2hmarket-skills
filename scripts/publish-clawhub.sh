#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAWHUB_CLI_BIN="${CLAWHUB_CLI_BIN:-clawhub}"
BUNDLE_DIR="$ROOT_DIR/dist/registry/a2hmarket"
SLUG=""
DISPLAY_NAME=""
VERSION=""
TAGS="latest"
CHANGELOG=""

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-clawhub.sh --slug <slug> --name <display-name> --version <semver> --changelog <text> [options]

Options:
  --bundle-dir <dir>   Registry bundle directory. Default: dist/registry/a2hmarket
  --tags <tags>        Comma-separated tags. Default: latest
  -h, --help           Show this help

Required env:
  CLAWHUB_TOKEN        ClawHub API token with publish permission
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle-dir)
      BUNDLE_DIR="$2"
      shift 2
      ;;
    --slug)
      SLUG="$2"
      shift 2
      ;;
    --name)
      DISPLAY_NAME="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --tags)
      TAGS="$2"
      shift 2
      ;;
    --changelog)
      CHANGELOG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "${CLAWHUB_TOKEN:-}" ]]; then
  echo "[publish-clawhub] CLAWHUB_TOKEN is required" >&2
  exit 1
fi

if [[ -z "$SLUG" || -z "$DISPLAY_NAME" || -z "$VERSION" || -z "$CHANGELOG" ]]; then
  echo "[publish-clawhub] --slug, --name, --version, and --changelog are required" >&2
  usage >&2
  exit 1
fi

if [[ ! -d "$BUNDLE_DIR" ]]; then
  echo "[publish-clawhub] bundle dir not found: $BUNDLE_DIR" >&2
  exit 1
fi

echo "[publish-clawhub] logging in with $CLAWHUB_CLI_BIN"
"$CLAWHUB_CLI_BIN" login --token "$CLAWHUB_TOKEN" --no-browser
"$CLAWHUB_CLI_BIN" whoami

echo "[publish-clawhub] publishing $SLUG@$VERSION from $BUNDLE_DIR"
"$CLAWHUB_CLI_BIN" publish "$BUNDLE_DIR" \
  --slug "$SLUG" \
  --name "$DISPLAY_NAME" \
  --version "$VERSION" \
  --tags "$TAGS" \
  --changelog "$CHANGELOG"
