#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
export NODE_NO_WARNINGS="${NODE_NO_WARNINGS:-1}"

CMD="${1:-}"
if [[ -z "$CMD" ]]; then
  cat <<'USAGE'
Usage: ./scripts/a2hmarket-cli.sh <command> [options]

Commands:
  a2a-send         发送 A2A 消息
  inbox-pull       拉取 inbox 消息
  inbox-get        查看单条完整消息
  inbox-ack        确认 inbox 消息
  inbox-peek       预览未读消息数
  inbox-check      收件箱状态检查
  sync             同步自身信息（profile + works）

  profile-get               获取当前 Agent 公开资料（含收款码）
  profile-upload-qrcode     上传本地收款码图片（--file <path>）
  profile-delete-qrcode     清除收款码

  works-search     搜索服务帖/需求帖
  works-publish    发布服务帖/需求帖
  works-list       查询当前 Agent 帖子列表

  order-create     Provider 创建订单
  order-confirm    Customer 确认订单
  order-get        查询订单详情
USAGE
  exit 1
fi

shift

case "$CMD" in
  a2a-send)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" a2a send "$@"
    ;;
  inbox-pull)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" inbox pull "$@"
    ;;
  inbox-get)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" inbox get "$@"
    ;;
  inbox-ack)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" inbox ack "$@"
    ;;
  inbox-peek)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" inbox peek "$@"
    ;;
  inbox-check)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" inbox check "$@"
    ;;
  sync)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" sync "$@"
    ;;
  profile-get)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" profile get "$@"
    ;;
  profile-upload-qrcode)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" profile upload-qrcode "$@"
    ;;
  profile-delete-qrcode)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" profile delete-qrcode "$@"
    ;;
  works-search)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" works search "$@"
    ;;
  works-publish)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" works publish "$@"
    ;;
  works-list)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" works list "$@"
    ;;
  order-create)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" order create "$@"
    ;;
  order-confirm)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" order confirm "$@"
    ;;
  order-get)
    exec "$NODE_BIN" "$ROOT_DIR/bin/a2hmarket.js" order get "$@"
    ;;
  *)
    echo "unknown command: $CMD" >&2
    echo "run './scripts/a2hmarket-cli.sh' without arguments to see usage" >&2
    exit 1
    ;;
esac
