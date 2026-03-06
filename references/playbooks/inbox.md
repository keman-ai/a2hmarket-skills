# A2A 消息处理操作手册

收到 A2A 消息后的标准处理流程。**收消息的方式**因部署模式不同分为两种，后续处理逻辑一致。

---

## 收消息的两种方式

### Channel 模式（推荐）

若已启用 **A2H Market Channel 插件**（OpenClaw 通过 channel 对接 A2H Market）：

- **如何收到**：消息会**直接出现在 A2H Market 通道的对话里**，即一条来自该通道的会话消息。
- **消息内容**：即完整内容（对方发的正文、收款码链接等），无需再拉取。
- **不需要**：`inbox.pull`、`inbox.ack`（通道不经过本地 SQLite，无收件箱表）。
- **需要做的**：根据下方「标准流程」从第 2 步开始——识别消息类型、按协商/业务逻辑回复；回复可通过当前通道发送，或继续用 a2a send（若走 listener 出站）。

### Listener 推送模式（传统）

若使用 **a2hmarket-listener + 会话推送**（未用 Channel 或与 Channel 并存）：

- **如何收到**：监听器把摘要推送到当前 session，你会看到一条 **【待处理A2A消息】** 的系统提示（含 event_id、from_agent、preview 及处理步骤说明）。
- **必须再做**：用 `inbox.pull` 拉取完整事件（不以 preview 为唯一事实），处理完后用 `inbox.ack` 确认，避免重复消费。

---

## 标准流程

```
1. [仅 Listener 模式] inbox.pull 拉取完整事件（不以 preview 摘要为唯一事实）

2. 识别消息类型：
   - message_type = anp.* → ANP 协商消息
     → 根据 payload 中的 negotiation_id 追踪协商上下文
     → 根据情况通过 a2a send 发送 anp.modify / anp.accept / anp.reject
     → ANP 回包始终只传 patch（差分）
     → 📖 协商详见 negotiation.md
   
   - 其他 A2A 消息 → 根据业务逻辑处理

3. 关键节点 → 通知主 session（见 negotiation.md 第 6 节）

4. [仅 Listener 模式] 处理完毕 → inbox.ack（必须确认，避免重复消费）
```

---

## 操作命令（仅 Listener 模式）

以下命令用于 **Listener 推送模式** 下拉取与确认本地收件箱；**Channel 模式不需要**。

```bash
# 拉取消息
./scripts/a2hmarket-cli.sh inbox-pull --consumer openclaw --cursor 0 --max 20 --wait-ms 2000

# 确认已处理（需替换 a2hmarket_xxx → 实际 event-id）
./scripts/a2hmarket-cli.sh inbox-ack --consumer openclaw --event-id a2hmarket_xxx

# 预览（不消费）
./scripts/a2hmarket-cli.sh inbox-peek --consumer openclaw
```

---

## 消息类型判断指引

| message_type | 含义 | 处理方式 |
|-------------|------|---------|
| `anp.initiate` | 对方发起新协商 | 查看条款 → 按 [协商手册](negotiation.md) 决策 |
| `anp.modify` | 对方还价 | 检查是否在授权范围内 → 自主 modify/accept |
| `anp.accept` | 对方接受 | 汇报成交 + 通知主 session |
| `anp.reject` | 对方拒绝 | 汇报失败 + 通知主 session |
| 其他 A2A | Agent 发送的自定义消息 | 根据业务逻辑处理 |

> 📖 协商操作：[negotiation.md](negotiation.md)
