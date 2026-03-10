#!/usr/bin/env bash
# 构建 a2hmarket skill 分发包
# 产出: dist/a2hmarket.tgz
#
# 用法: ./build-skill.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="$SCRIPT_DIR/dist/a2hmarket"
RUNTIME_TGZ="a2hmarket-runtime.tgz"

cd "$SCRIPT_DIR"

# ─── 读取版本号 ────────────────────────────────────────────────────────────────
VERSION="$(node -e "process.stdout.write(require('./package.json').version)")"
PKG_NAME="$(node -e "process.stdout.write(require('./package.json').name)")"
NPM_TGZ="${PKG_NAME}-${VERSION}.tgz"

echo "[build] version=$VERSION"

# ─── Step 1: npm pack 生成 tgz ─────────────────────────────────────────────────
echo "[build] Step 1/4: npm pack ..."
npm pack --silent
if [[ ! -f "$NPM_TGZ" ]]; then
  echo "[build] ERROR: npm pack did not produce $NPM_TGZ" >&2
  exit 1
fi
echo "[build]   -> $NPM_TGZ"

# ─── Step 2: 创建 dist 目录 ────────────────────────────────────────────────────
echo "[build] Step 2/4: creating dist/a2hmarket/ ..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# ─── Step 3: 复制文件到 dist ───────────────────────────────────────────────────
echo "[build] Step 3/4: copying files ..."

cp "$NPM_TGZ" "$DIST_DIR/$RUNTIME_TGZ"
cp SKILL.md "$DIST_DIR/"
cp -r references "$DIST_DIR/"

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

# 生成外层 setup.sh
cat > "$DIST_DIR/setup.sh" <<'SETUP'
#!/usr/bin/env bash
# a2hmarket skill 一键 setup 脚本
# 用法: ./setup.sh --agent-id <AGENT_ID> --key <AGENT_KEY>
# 也可通过环境变量传入: AGENT_ID=... AGENT_KEY=... ./setup.sh
#
# 幂等：可重复运行，不会覆盖已配置的凭据，不会重复启动 listener。

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${A2HMARKET_STATE_DIR:-$HOME/.a2hmarket}"

mkdir -p "$STATE_DIR"

# ─── 解析参数 ──────────────────────────────────────────────────────────────────
_agent_id="${AGENT_ID:-}"
_agent_key="${AGENT_KEY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-id)   _agent_id="$2";  shift 2 ;;
    --key)        _agent_key="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: ./setup.sh --agent-id <AGENT_ID> --key <AGENT_KEY>"
      echo ""
      echo "也可通过环境变量传入:"
      echo "  AGENT_ID=ag_xxx AGENT_KEY=secret_xxx ./setup.sh"
      exit 0
      ;;
    *) echo "[setup] unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ─── 参数校验 ──────────────────────────────────────────────────────────────────
if [[ -z "$_agent_id" || -z "$_agent_key" ]]; then
  echo "[setup] ERROR: missing required arguments." >&2
  echo "[setup] Usage: ./setup.sh --agent-id <AGENT_ID> --key <AGENT_KEY>" >&2
  exit 1
fi

# ─── Step 1: 安装 runtime npm 包 ──────────────────────────────────────────────
echo "[setup] Step 1/3: installing runtime ..."

if ! command -v node >/dev/null 2>&1; then
  echo "[setup] ERROR: node not found. Please install Node.js first." >&2
  exit 1
fi

cd "$SKILL_DIR"

if ! npm install --omit=dev --legacy-peer-deps --no-audit --fund=false 2>&1; then
  echo "[setup] WARN: first install failed, retrying ..." >&2
  rm -rf node_modules package-lock.json
  if ! npm install --omit=dev --legacy-peer-deps --no-audit --fund=false 2>&1; then
    echo "[setup] ERROR: npm install failed" >&2
    exit 1
  fi
fi

echo "[setup]   runtime installed"

# ─── Step 2: 写入凭据（幂等）──────────────────────────────────────────────────
echo "[setup] Step 2/3: writing credentials to $STATE_DIR/config.sh ..."

CONFIG_FILE="$STATE_DIR/config.sh"

if [[ ! -f "$CONFIG_FILE" ]]; then
  TEMPLATE="$SKILL_DIR/node_modules/a2hmarket-runtime/config/config.template.sh"
  if [[ -f "$TEMPLATE" ]]; then
    cp "$TEMPLATE" "$CONFIG_FILE"
    echo "[setup]   config created from template"
  else
    echo "[setup] ERROR: config template not found at $TEMPLATE" >&2
    exit 1
  fi
fi

if grep -q "REPLACE_WITH_YOUR_AGENT_ID" "$CONFIG_FILE" 2>/dev/null; then
  if sed --version >/dev/null 2>&1; then
    sed -i \
      -e "s|REPLACE_WITH_YOUR_AGENT_ID|${_agent_id}|g" \
      -e "s|REPLACE_WITH_YOUR_KEY|${_agent_key}|g" \
      "$CONFIG_FILE"
  else
    sed -i '' \
      -e "s|REPLACE_WITH_YOUR_AGENT_ID|${_agent_id}|g" \
      -e "s|REPLACE_WITH_YOUR_KEY|${_agent_key}|g" \
      "$CONFIG_FILE"
  fi
  echo "[setup]   credentials written"
else
  echo "[setup]   credentials already present (skipped)"
fi

# ─── Step 3: 启动 listener ────────────────────────────────────────────────────
echo "[setup] Step 3/3: starting listener ..."

npx a2hmarket-ops stop >/dev/null 2>&1 || true
npx a2hmarket-ops start

# ─── 完成 ─────────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  a2hmarket skill setup complete"
echo "========================================"
echo "  AGENT_ID  : $_agent_id"
echo "  Skill dir : $SKILL_DIR"
echo "  State dir : $STATE_DIR"
echo ""
echo "  Commands:"
echo "    npx a2hmarket --help              # CLI help"
echo "    npx a2hmarket-ops status          # listener status"
echo "    npx a2hmarket-ops stop            # stop listener"
echo "    npx a2hmarket-ops start           # start listener"
echo "========================================"
SETUP

chmod +x "$DIST_DIR/setup.sh"

# ─── Step 4: 打包整个 skill 为 tgz ────────────────────────────────────────────
SKILL_TGZ="a2hmarket.tgz"
echo "[build] Step 4/4: packing skill -> dist/$SKILL_TGZ ..."

tar -czf "$SCRIPT_DIR/dist/$SKILL_TGZ" -C "$SCRIPT_DIR/dist" --exclude='.DS_Store' a2hmarket

echo ""
echo "[build] done"
echo "[build] output: dist/$SKILL_TGZ ($(du -h "$SCRIPT_DIR/dist/$SKILL_TGZ" | cut -f1))"
echo "[build] contents:"
tar -tzf "$SCRIPT_DIR/dist/$SKILL_TGZ"

# 清理中间产物
rm -f "$NPM_TGZ"
