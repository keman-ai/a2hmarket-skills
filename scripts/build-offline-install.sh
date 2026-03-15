#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/dist/offline"
RELEASE_VERSION="${A2HMARKET_RELEASE_VERSION:-}"

usage() {
  cat <<'EOF'
Usage: ./scripts/build-offline-install.sh [--release-version <version>] [--output-dir <dir>]

Builds the offline install package while preserving the install.zip contract.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release-version)
      RELEASE_VERSION="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
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

read_skill_version() {
  bash "$ROOT_DIR/scripts/read-skill-version.sh"
}

SKILL_VERSION="$(read_skill_version)"

if [[ -z "$SKILL_VERSION" ]]; then
  echo "[offline-build] missing version in SKILL.md frontmatter" >&2
  exit 1
fi

if [[ -z "$RELEASE_VERSION" ]]; then
  RELEASE_VERSION="$SKILL_VERSION"
elif [[ "$RELEASE_VERSION" != "$SKILL_VERSION" ]]; then
  echo "[offline-build] release version mismatch: requested=$RELEASE_VERSION skill=$SKILL_VERSION" >&2
  exit 1
fi

if [[ -z "$RELEASE_VERSION" ]]; then
  echo "[offline-build] release version is required" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

(
  cd "$ROOT_DIR"
  bash ./build-skill.sh
)

SOURCE_ZIP="$ROOT_DIR/dist/a2hmarket.zip"
STABLE_ZIP="$OUTPUT_DIR/install.zip"
VERSIONED_ZIP="$OUTPUT_DIR/a2hmarket-install-v${RELEASE_VERSION}.zip"
MANIFEST_PATH="$OUTPUT_DIR/install-manifest.json"

cp "$SOURCE_ZIP" "$STABLE_ZIP"
cp "$SOURCE_ZIP" "$VERSIONED_ZIP"

bash "$ROOT_DIR/scripts/check-offline-contract.sh" "$STABLE_ZIP"

if command -v shasum >/dev/null 2>&1; then
  SHA256="$(shasum -a 256 "$VERSIONED_ZIP" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$VERSIONED_ZIP" | awk '{print $1}')"
else
  echo "[offline-build] shasum or sha256sum is required" >&2
  exit 1
fi

if git -C "$ROOT_DIR" rev-parse HEAD >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
else
  SOURCE_COMMIT="unknown"
fi

BUILT_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat >"$MANIFEST_PATH" <<EOF
{
  "channel": "offline",
  "version": "$RELEASE_VERSION",
  "skillVersionSource": "SKILL.md",
  "stableFile": "install.zip",
  "versionedFile": "$(basename "$VERSIONED_ZIP")",
  "sha256": "$SHA256",
  "sourceCommit": "$SOURCE_COMMIT",
  "builtAt": "$BUILT_AT"
}
EOF

echo "[offline-build] stable package: $STABLE_ZIP"
echo "[offline-build] versioned package: $VERSIONED_ZIP"
echo "[offline-build] manifest: $MANIFEST_PATH"
