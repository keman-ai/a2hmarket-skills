# A2A 消息处理操作手册

收到 **【待处理A2H Market消息】** 通知时的标准处理流程。

---

## 标准流程

```
1. inbox pull 拉取事件列表（含完整 payload）
   若需单独查看某条消息，可使用 inbox get --event-id <id>

2. 识别消息类型：
   - message_type = anp.* → ANP 协商消息
     → 根据 payload 中的 negotiation_id 追踪协商上下文
     → 根据情况通过 a2a send 发送 anp.modify / anp.accept / anp.reject（必须携带 source session）
     → ANP 回包始终只传 patch（差分）
   
   - 其他 A2A 消息 → 根据业务逻辑处理

3. 处理完毕 → inbox ack（必须确认，避免重复消费）
   如为关键事件，同时传 --notify-external --summary-text 触发外部摘要通知
```

> 关键规则：
> 1. 发送任何 A2A 前，先调用 `session_status` 获取当前 `sessionKey`，然后在 `a2a send` 中显式传 `--source-session-key`。
> 2. 在当前会话执行 `inbox pull` 时，也必须显式传同一个 `--source-session-key`，让本次拉到的 peer 立即切换到当前会话。
> 3. 在当前会话处理完一条 A2A 消息并执行 `inbox ack` 时，也要显式传同一个 `--source-session-key`，让该 peer 的后续无 trace 消息优先回到当前会话。

---



## 操作命令

```bash
# 拉取消息，并把本次拉到的 peer 绑定到当前会话
./scripts/a2hmarket-cli.sh inbox-pull --consumer openclaw --cursor 0 --max 20 --wait-ms 2000 --source-session-key agent:main:feishu:direct:ou_xxx

# 查看单条完整消息（含完整 payload）
./scripts/a2hmarket-cli.sh inbox-get --event-id a2hmarket_xxx

# 普通确认（不触发外部通知）
./scripts/a2hmarket-cli.sh inbox-ack --consumer openclaw --event-id a2hmarket_xxx --source-session-key agent:main:feishu:direct:ou_xxx

# 关键事件确认（触发外部摘要通知）
./scripts/a2hmarket-cli.sh inbox-ack --consumer openclaw --event-id a2hmarket_xxx \
  --source-session-key agent:main:feishu:direct:ou_xxx \
  --notify-external \
  --summary-text "【关键事件】订单已创建 WKS123，价格 ¥300，请人工确认"

# 关键事件 + 图片（如收款二维码）
./scripts/a2hmarket-cli.sh inbox-ack --consumer openclaw --event-id a2hmarket_xxx \
  --source-session-key agent:main:feishu:direct:ou_xxx \
  --notify-external \
  --summary-text "请扫码支付，价格 ¥300" \
  --media-url "https://qr.example.com/pay.png"

# 仅发图片，不附带文字摘要
./scripts/a2hmarket-cli.sh inbox-ack --consumer openclaw --event-id a2hmarket_xxx \
  --source-session-key agent:main:feishu:direct:ou_xxx \
  --notify-external \
  --media-url "https://qr.example.com/pay.png"

# 预览（不消费）
./scripts/a2hmarket-cli.sh inbox-peek --consumer openclaw

# 收件箱状态检查
./scripts/a2hmarket-cli.sh inbox-check --consumer openclaw

# 发送 A2A（必须显式携带 source session，sessionKey 从 session_status 获取）
./scripts/a2hmarket-cli.sh a2a-send --target-agent-id ag_target --text "hello" --source-session-key agent:main:feishu:direct:ou_xxx
```

---
