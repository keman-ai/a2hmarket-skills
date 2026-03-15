#!/usr/bin/env bash
# 构建 a2hmarket skill 分发包
# 产出: dist/a2hmarket.zip
#
# 用法: ./build-skill.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist/a2hmarket"
RUNTIME_TGZ="a2hmarket-runtime.tgz"
OFFLINE_SETUP_TEMPLATE="$SCRIPT_DIR/packaging/offline/setup.sh"
OFFLINE_SKILL_PREAMBLE="$SCRIPT_DIR/packaging/offline/skill-preamble.md"

cd "$SCRIPT_DIR"

bash "$SCRIPT_DIR/scripts/check-template-sync.sh"

# ─── 读取 package.json 字段（纯 shell，不依赖 node）─────────────────────────
json_field() {
  grep "\"$1\"" package.json | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/'
}
VERSION="$(json_field version)"
PKG_NAME="$(json_field name)"

echo "[build] name=$PKG_NAME version=$VERSION"

# ─── Step 1: 打包 runtime 为 tgz（用 tar 替代 npm pack）──────────────────────
echo "[build] Step 1/4: packing runtime ..."
RUNTIME_STAGING="$SCRIPT_DIR/dist/.runtime-staging/package"
rm -rf "$SCRIPT_DIR/dist/.runtime-staging"
mkdir -p "$RUNTIME_STAGING"

cp package.json "$RUNTIME_STAGING/"
cp -r bin "$RUNTIME_STAGING/"
mkdir -p "$RUNTIME_STAGING/runtime"
cp -r runtime/js "$RUNTIME_STAGING/runtime/js"
mkdir -p "$RUNTIME_STAGING/scripts"
cp scripts/a2hmarket-cli.sh "$RUNTIME_STAGING/scripts/"
cp scripts/a2hmarket-ops.sh "$RUNTIME_STAGING/scripts/"

tar -czf "$SCRIPT_DIR/dist/.runtime-staging/$RUNTIME_TGZ" \
  -C "$SCRIPT_DIR/dist/.runtime-staging" --exclude='.DS_Store' package

echo "[build]   -> $RUNTIME_TGZ"

# ─── Step 2: 创建 dist 目录 ────────────────────────────────────────────────────
echo "[build] Step 2/4: creating dist/a2hmarket/ ..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# ─── Step 3: 复制文件到 dist ───────────────────────────────────────────────────
echo "[build] Step 3/4: copying files ..."

cp "$SCRIPT_DIR/dist/.runtime-staging/$RUNTIME_TGZ" "$DIST_DIR/$RUNTIME_TGZ"
cp -r docs "$DIST_DIR/"
cp -r references "$DIST_DIR/"

if [[ ! -f "$OFFLINE_SETUP_TEMPLATE" ]]; then
  echo "[build] ERROR: missing offline setup template: $OFFLINE_SETUP_TEMPLATE" >&2
  exit 1
fi

if [[ ! -f "$OFFLINE_SKILL_PREAMBLE" ]]; then
  echo "[build] ERROR: missing offline skill preamble: $OFFLINE_SKILL_PREAMBLE" >&2
  exit 1
fi

awk -v preamble="$OFFLINE_SKILL_PREAMBLE" '
  /^---[[:space:]]*$/ {
    print
    fence_count += 1
    if (fence_count == 2) {
      while ((getline line < preamble) > 0) {
        print line
      }
      close(preamble)
      print ""
    }
    next
  }
  { print }
' "$SCRIPT_DIR/SKILL.md" > "$DIST_DIR/SKILL.md"

# 生成外层 package.json
cat > "$DIST_DIR/package.json" <<PKGJSON
{
  "private": true,
  "description": "a2hmarket skill (wrapper)",
  "dependencies": {
    "${PKG_NAME}": "file:${RUNTIME_TGZ}"
  }
}
PKGJSON

cp "$OFFLINE_SETUP_TEMPLATE" "$DIST_DIR/setup.sh"
chmod +x "$DIST_DIR/setup.sh"

# ─── Step 4: 打包整个 skill 为 zip ────────────────────────────────────────────
SKILL_ZIP="a2hmarket.zip"
echo "[build] Step 4/4: packing skill -> dist/$SKILL_ZIP ..."

rm -f "$SCRIPT_DIR/dist/$SKILL_ZIP"
(cd "$SCRIPT_DIR/dist" && zip -r "$SKILL_ZIP" a2hmarket -x "*.DS_Store")

echo ""
echo "[build] done"
echo "[build] output: dist/$SKILL_ZIP ($(du -h "$SCRIPT_DIR/dist/$SKILL_ZIP" | cut -f1))"
echo "[build] contents:"
unzip -l "$SCRIPT_DIR/dist/$SKILL_ZIP"

# 清理中间产物
rm -rf "$SCRIPT_DIR/dist/.runtime-staging"
