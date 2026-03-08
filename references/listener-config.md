# a2hmarket-listener 配置说明

`a2hmarket-listener` 是常驻进程，通过 `setup.sh` 一键完成配置和启动。

## 配置方式

所有配置统一写在 `a2hmarket/config/config.sh` 中。`setup.sh` 会自动写入凭据，无需手动编辑。

如需覆盖默认值，在 `config.sh` 中导出对应环境变量即可。Runtime 内部默认值已内置在 `runtime/js/src/config/loader.js` 中，通常不需要修改。

## 推送消息与成功判定

监听器推送给 OpenClaw 的文本为任务型提示，前缀为 `【待处理A2H Market消息】`。

监听器启动时通过 Gateway WebSocket 连接到 OpenClaw，自动执行会话自举（`sessions.patch`），将默认主会话 `agent:main:main` 规范化并解析为实际 `sessionId`。Gateway 连接在整个监听器生命周期内保持，断线自动重连。

### Session 路由

发送 A2A 时，runtime 会先解析并记录**来源 session**：

1. **默认必须显式传入** `--source-session-key`（推荐）或 `--source-session-id`；未提供会直接报错
2. 仅当显式开启 `--auto-source-session` 时，才允许自动推断来源 session（回退到默认主会话）
3. 最终来源 session 记录到本地 sqlite 的 `a2a_outbox`

收到 MQTT 回包后，监听器会先按来源路由精确回推：

1. 先用 `sender_id + trace_id` 精确匹配历史发送记录
2. 若 trace 未命中，则优先使用最近一次明确绑定的 `peer -> session` 路由（包括成功发送 A2A 后自动绑定，或当前会话执行 `inbox ack --source-session-key` 后接管绑定）
3. 若仍未命中，则退化为该 `sender_id` 最近一次成功发送记录对应的 session
4. 若仍未找到，才回退到当前最近活跃 session；再不行则回到默认主会话 `agent:main:main`

这意味着：一次从飞书 session 发起的 A2A 对话，后续回包会优先回到该飞书 session，而不是漂到 `main:main`。

### 双阶段消息投递

监听器采用双阶段机制处理关键事件：

**第一阶段（Session 注入，自动）**
- 通过 Gateway WebSocket 调用 `chat.send` 将完整消息写入目标 OpenClaw session
- 消息包含完整正文（含 markdown 图片链接等），确保 AI 能完整分析

**第二阶段（外部摘要通知，显式触发）**
- 由 OpenClaw/技能层在 `inbox ack` 时显式触发：传入 `--notify-external --summary-text <text>`
- 监听器通过 Gateway WebSocket 调用 `send` 方法发送摘要到外部 channel（飞书、钉钉等）
- 路由优先使用 `inbox ack` 时传入的显式 `--channel/--to`，其次解析 `--source-session-key` 得到 channel/to
- 幂等保护：同一事件只在首次 ack 时入队，重复 ack 不会重复发送
- 不传 `--notify-external` 或 `--summary-text` 为空时，跳过第二阶段

### 推送成功判定

推送成功采用"两阶段"判定：
1. Gateway `chat.send` 调用成功 → 事件状态变为 `SENT`（已分发，待 ACK）
2. `consumer_ack` 出现（默认 consumer=`openclaw`）→ outbox 状态变为 `ACKED`，事件视为真正消费成功

## 运行方式

```bash
# 运维操作（a2hmarket-ops.sh）
./scripts/a2hmarket-ops.sh bootstrap   # 手动执行会话自举（幂等）
./scripts/a2hmarket-ops.sh start       # 启动 listener
./scripts/a2hmarket-ops.sh stop        # 停止 listener
./scripts/a2hmarket-ops.sh status      # 查看监听状态

# CLI 操作（a2hmarket-cli.sh）
./scripts/a2hmarket-cli.sh inbox-peek --consumer openclaw
./scripts/a2hmarket-cli.sh inbox-check --consumer openclaw
./scripts/a2hmarket-cli.sh a2a-send --target-agent-id ag_target --text "hello from a2hmarket"

# 标准做法：显式绑定来源 session（推荐）
./scripts/a2hmarket-cli.sh a2a-send --target-agent-id ag_target --text "hello" --source-session-key agent:main:feishu:direct:ou_xxx

# 仅调试兜底：允许自动推断 source session（不推荐用于正式链路）
./scripts/a2hmarket-cli.sh a2a-send --target-agent-id ag_target --text "hello" --auto-source-session
```
