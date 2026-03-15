#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$ROOT_DIR/dist/registry/a2hmarket"
REGISTRY_SETUP_TEMPLATE="$ROOT_DIR/packaging/offline/setup.sh"
REGISTRY_FRONTMATTER_TEMPLATE="$ROOT_DIR/packaging/registry/frontmatter.yml"
REGISTRY_SKILL_PREAMBLE="$ROOT_DIR/packaging/registry/skill-preamble.md"

usage() {
  cat <<'EOF'
Usage: ./scripts/build-registry-bundle.sh [--output-dir <dir>]

Builds a text-only bundle intended for ClawHub publication.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

bash "$ROOT_DIR/scripts/check-template-sync.sh"

read_skill_version() {
  bash "$ROOT_DIR/scripts/read-skill-version.sh"
}

render_registry_skill() {
  if [[ ! -f "$REGISTRY_SETUP_TEMPLATE" ]]; then
    echo "[registry-build] missing setup template: $REGISTRY_SETUP_TEMPLATE" >&2
    exit 1
  fi

  if [[ ! -f "$REGISTRY_FRONTMATTER_TEMPLATE" ]]; then
    echo "[registry-build] missing frontmatter template: $REGISTRY_FRONTMATTER_TEMPLATE" >&2
    exit 1
  fi

  if [[ ! -f "$REGISTRY_SKILL_PREAMBLE" ]]; then
    echo "[registry-build] missing skill preamble: $REGISTRY_SKILL_PREAMBLE" >&2
    exit 1
  fi

  awk -v metadata_file="$REGISTRY_FRONTMATTER_TEMPLATE" \
      -v preamble_file="$REGISTRY_SKILL_PREAMBLE" '
    /^---[[:space:]]*$/ {
      fence_count += 1
      if (fence_count == 2) {
        while ((getline line < metadata_file) > 0) {
          print line
        }
        close(metadata_file)
        print
        while ((getline line < preamble_file) > 0) {
          print line
        }
        close(preamble_file)
        print ""
        next
      }
    }
    { print }
  ' "$ROOT_DIR/SKILL.md" >"$OUTPUT_DIR/SKILL.md"
}

copy_path() {
  local rel="$1"
  mkdir -p "$(dirname "$OUTPUT_DIR/$rel")"
  cp -R "$ROOT_DIR/$rel" "$OUTPUT_DIR/$rel"
}

SKILL_VERSION="$(read_skill_version)"

if [[ -z "$SKILL_VERSION" ]]; then
  echo "[registry-build] missing version in SKILL.md frontmatter" >&2
  exit 1
fi

render_registry_skill
cp "$REGISTRY_SETUP_TEMPLATE" "$OUTPUT_DIR/setup.sh"
chmod +x "$OUTPUT_DIR/setup.sh"
copy_path "package.json"
copy_path "package-lock.json"
copy_path "config/config.sh"
copy_path "docs"
copy_path "references"
copy_path "bin"
copy_path "runtime/js"
copy_path "scripts/a2hmarket-cli.sh"
copy_path "scripts/a2hmarket-ops.sh"

DISALLOWED="$(find "$OUTPUT_DIR" \( -name '*.zip' -o -name '*.tgz' \) -print)"
if [[ -n "$DISALLOWED" ]]; then
  echo "[registry-build] disallowed packaged files found:" >&2
  echo "$DISALLOWED" >&2
  exit 1
fi

NON_TEXT=()
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  if ! LC_ALL=C grep -Iq . "$file"; then
    NON_TEXT+=("$file")
  fi
done < <(find "$OUTPUT_DIR" -type f | sort)

if [[ ${#NON_TEXT[@]} -gt 0 ]]; then
  echo "[registry-build] non-text files detected:" >&2
  printf '%s\n' "${NON_TEXT[@]}" >&2
  exit 1
fi

if git -C "$ROOT_DIR" rev-parse HEAD >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
else
  SOURCE_COMMIT="unknown"
fi

cat >"$OUTPUT_DIR/.registry-build.json" <<EOF
{
  "channel": "registry",
  "version": "$SKILL_VERSION",
  "sourceCommit": "$SOURCE_COMMIT",
  "builtAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "[registry-build] bundle ready: $OUTPUT_DIR"
