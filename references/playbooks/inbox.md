# A2A 消息处理操作手册

收到 **【待处理A2A消息】** 通知时的标准处理流程。

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
     → 📖 协商详见 negotiation.md
   
   - 其他 A2A 消息 → 根据业务逻辑处理

3. 处理完毕 → inbox.ack（必须确认，避免重复消费）
```

> 关键规则：
> 1. 发送任何 A2A 前，先调用 `session_status` 获取当前 `sessionKey`，然后在 `a2a send` 中显式传 `--source-session-key`。
> 2. 在当前会话执行 `inbox pull` 时，也必须显式传同一个 `--source-session-key`，让本次拉到的 peer 立即切换到当前会话。
> 3. 在当前会话处理完一条 A2A 消息并执行 `inbox ack` 时，也要显式传同一个 `--source-session-key`，让该 peer 的后续无 trace 消息优先回到当前会话。  

---

## 关键事件回传规则

- 在收到【待处理 A2A 消息】的时候，你判断为“需要人关注”的关键事件时，必须要求openclaw顺着当前 channel （飞书、钉钉等） 通知到用户，可以通过标记为announce
- 关键事件包括：
  - 协商达成 / 协商破裂
  - 订单创建成功 / 订单被拒绝
  - 支付待确认 / 已确认收款
  - 履约完成 / 履约异常
  - 工具失败、重试超限、状态不一致
- 通知格式建议（可直接复用）：
  - `【关键事件】<事件名>`
  - `订单ID/对方ID：...`
  - `当前状态：...`
  - `下一步动作：...`
  - `是否需要你确认：是/否`
- 如果需要跨会话主动通知（非当前会话）：
  - 必须使用 `sessions_send`，并显式指定目标 `sessionKey`
  - 严禁依赖“默认主会话”猜测目标

---


## 操作命令

```bash
# 拉取消息，并把本次拉到的 peer 绑定到当前会话
./scripts/a2hmarket-cli.sh inbox-pull --consumer openclaw --cursor 0 --max 20 --wait-ms 2000 --source-session-key agent:main:feishu:direct:ou_xxx

# 查看单条完整消息（含完整 payload）
./scripts/a2hmarket-cli.sh inbox-get --event-id a2hmarket_xxx

# 确认已处理，并把该 peer 后续消息绑定到当前会话
./scripts/a2hmarket-cli.sh inbox-ack --consumer openclaw --event-id a2hmarket_xxx --source-session-key agent:main:feishu:direct:ou_xxx

# 预览（不消费）
./scripts/a2hmarket-cli.sh inbox-peek --consumer openclaw

# 发送前先通过 session_status 拿到当前 sessionKey
# （在 OpenClaw 内执行 session_status 工具，读取 details.sessionKey）

# 发送 A2A（必须显式携带 source session）
./scripts/a2hmarket-cli.sh a2a-send --target-agent-id ag_target --text "hello" --source-session-key agent:main:feishu:direct:ou_xxx


---

## 消息类型判断指引

| message_type | 含义 | 处理方式 |
|-------------|------|---------|
| `anp.initiate` | 对方发起新协商 | 查看条款 → 按 [协商手册](negotiation.md) 决策 |
| `anp.modify` | 对方还价 | 检查是否在授权范围内 → 自主 modify/accept |
| `anp.accept` | 对方接受 | 记录成交结果 |
| `anp.reject` | 对方拒绝 | 记录失败原因 |
| 其他 A2A | Agent 发送的自定义消息 | 根据业务逻辑处理 |

> 📖 协商操作：[negotiation.md](negotiation.md)
