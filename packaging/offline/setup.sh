#!/usr/bin/env bash
# a2hmarket skill 一键 setup 脚本
# 用法:
#   ./setup.sh                                    # 浏览器授权模式（推荐）
#   ./setup.sh --agent-id <AGENT_ID> --key <KEY>  # 手动凭据模式
#   AGENT_ID=... AGENT_KEY=... ./setup.sh         # 环境变量模式
#
# 幂等：可重复运行。已有有效凭据时跳过授权，依赖安装和 listener 启动仍会执行。
# CI/测试专用开关：
#   A2HMARKET_SETUP_SKIP_INSTALL=1  跳过 npm install
#   A2HMARKET_SETUP_SKIP_START=1    跳过 listener 启动

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${A2HMARKET_STATE_DIR:-$HOME/.a2hmarket}"
CONFIG_FILE="$STATE_DIR/config.sh"
AUTH_API="https://web.a2hmarket.ai/findu-user/api/v1/public/user/agent/auth"
AUTH_PAGE="https://a2hmarket.ai/authcode"
AUTH_TIMEOUT_SEC=600

mkdir -p "$STATE_DIR"

should_skip() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|y|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# ─── 解析参数 ──────────────────────────────────────────────────────────────────
_agent_id="${AGENT_ID:-}"
_agent_key="${AGENT_KEY:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-id)   _agent_id="$2";  shift 2 ;;
    --key)        _agent_key="$2"; shift 2 ;;
    -h|--help)
      echo "Usage:"
      echo "  ./setup.sh                              # 浏览器授权（推荐）"
      echo "  ./setup.sh --agent-id <ID> --key <KEY>  # 手动凭据"
      echo "  AGENT_ID=... AGENT_KEY=... ./setup.sh   # 环境变量"
      exit 0
      ;;
    *) echo "[setup] unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ─── 检查已有凭据（幂等：已有有效凭据时跳过授权）─────────────────────────────
if [[ -z "$_agent_id" && -f "$CONFIG_FILE" ]]; then
  _existing_id=$(grep 'AGENT_ID=' "$CONFIG_FILE" 2>/dev/null \
    | sed 's/.*AGENT_ID="\([^"]*\)".*/\1/' | head -1)
  _existing_key=$(grep 'AGENT_KEY=' "$CONFIG_FILE" 2>/dev/null \
    | sed 's/.*AGENT_KEY="\([^"]*\)".*/\1/' | head -1)
  if [[ -n "$_existing_id" && "$_existing_id" != "{AGENT_ID}" \
     && -n "$_existing_key" && "$_existing_key" != "{AGENT_KEY}" ]]; then
    echo "[setup] 凭据已存在 (AGENT_ID=$_existing_id)，跳过授权"
    _agent_id="$_existing_id"
    _agent_key="$_existing_key"
  fi
fi

# ─── 凭据获取 ──────────────────────────────────────────────────────────────────
if [[ -z "$_agent_id" || -z "$_agent_key" ]]; then
  if [[ -n "$_agent_id" || -n "$_agent_key" ]]; then
    echo "[setup] ERROR: --agent-id 和 --key 必须同时提供" >&2
    exit 1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "[setup] ERROR: curl not found, 无法进行浏览器授权" >&2
    echo "[setup] 请改用: ./setup.sh --agent-id <ID> --key <KEY>" >&2
    exit 1
  fi

  _pending_file="$STATE_DIR/.auth_pending"

  if [[ -f "$_pending_file" ]]; then
    read -r _code _expiry < "$_pending_file" 2>/dev/null || true
    _now=$(date +%s)

    if [[ -n "$_code" && -n "$_expiry" && $_now -lt $_expiry ]]; then
      echo "[setup] 检测到待授权 code，正在验证..."
      _resp=$(curl -sf "${AUTH_API}?code=${_code}" 2>/dev/null || echo "")

      if echo "$_resp" | grep -q '"agentId"'; then
        _agent_id=$(echo "$_resp" | grep -o '"agentId":"[^"]*"' | head -1 | sed 's/"agentId":"//;s/"//')
        _agent_key=$(echo "$_resp" | grep -o '"secret":"[^"]*"' | head -1 | sed 's/"secret":"//;s/"//')

        if [[ -n "$_agent_id" && -n "$_agent_key" ]]; then
          rm -f "$_pending_file"
          echo "[setup] AUTH_SUCCESS AGENT_ID=${_agent_id}"
        fi
      fi

      if [[ -z "$_agent_id" || -z "$_agent_key" ]]; then
        _auth_url="${AUTH_PAGE}?code=${_code}"
        _remaining=$(( _expiry - _now ))
        _min=$(( _remaining / 60 ))
        echo ""
        echo "[setup] AUTH_WAITING"
        echo "[setup] 授权尚未完成。请先在浏览器中完成登录授权（剩余约 ${_min} 分钟）："
        echo ""
        echo "  AUTH_URL=${_auth_url}"
        echo ""
        echo "[setup] 授权完成后，再次运行 ./setup.sh"
        exit 0
      fi
    else
      rm -f "$_pending_file"
    fi
  fi

  if [[ -z "$_agent_id" || -z "$_agent_key" ]]; then
    if command -v openssl >/dev/null 2>&1; then
      _code=$(openssl rand -hex 16)
    else
      _code=$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 32)
    fi

    _expiry=$(( $(date +%s) + AUTH_TIMEOUT_SEC ))
    echo "${_code} ${_expiry}" > "$_pending_file"

    _auth_url="${AUTH_PAGE}?code=${_code}"

    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║           请在浏览器中打开以下链接完成授权                  ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "  授权链接："
    echo "  ${_auth_url}"
    echo ""
    echo "  等待授权"
    echo "  链接 10 分钟内有效。授权完成后，再次运行 ./setup.sh 即可。"
    echo ""
    exit 0
  fi
fi

# ─── 最终校验 ──────────────────────────────────────────────────────────────────
if [[ -z "$_agent_id" || -z "$_agent_key" ]]; then
  echo "[setup] ERROR: 未获取到有效凭据" >&2
  exit 1
fi

# ─── Step 1: 安装 Node.js 依赖 ─────────────────────────────────────────────────
echo "[setup] Step 1/3: installing runtime ..."

if should_skip "${A2HMARKET_SETUP_SKIP_INSTALL:-}"; then
  echo "[setup]   runtime install skipped by A2HMARKET_SETUP_SKIP_INSTALL"
else
  if ! command -v node >/dev/null 2>&1; then
    echo "[setup] ERROR: node not found. Please install Node.js (>=18) first." >&2
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
fi

# ─── Step 2: 写入凭据 ──────────────────────────────────────────────────────────
echo "[setup] Step 2/3: writing credentials ..."

cat > "$CONFIG_FILE" <<CFGEOF
#!/usr/bin/env bash
export BASE_URL="http://api.a2hmarket.ai"
export AGENT_ID="${_agent_id}"
export AGENT_KEY="${_agent_key}"
CFGEOF
chmod 600 "$CONFIG_FILE"

echo "[setup]   credentials -> $CONFIG_FILE"

# ─── Step 3: 启动 listener ────────────────────────────────────────────────────
echo "[setup] Step 3/3: starting listener ..."

if should_skip "${A2HMARKET_SETUP_SKIP_START:-}"; then
  echo "[setup]   listener start skipped by A2HMARKET_SETUP_SKIP_START"
else
  if [[ -x "$SKILL_DIR/scripts/a2hmarket-ops.sh" ]]; then
    "$SKILL_DIR/scripts/a2hmarket-ops.sh" stop >/dev/null 2>&1 || true
    "$SKILL_DIR/scripts/a2hmarket-ops.sh" start
  else
    npx a2hmarket-ops stop >/dev/null 2>&1 || true
    npx a2hmarket-ops start
  fi
fi

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
