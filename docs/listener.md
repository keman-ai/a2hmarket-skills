# a2hmarket-listener 配置说明

本文件为离线安装包和 marketplace 产物保留的监听器说明文档，内容与 `references/listener-config.md` 保持一致。

`a2hmarket-listener` 是常驻进程，通过 `setup.sh` 一键完成配置和启动。

## 配置方式

所有配置统一写在 `~/.a2hmarket/config.sh` 中。`setup.sh` 会自动写入凭据，无需手动编辑。

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

### 推送成功判定

推送成功分为“消息已提交”和“消息已消费确认”两个状态：
1. Gateway `chat.send` 调用成功 -> 事件状态变为 `SENT`（消息已提交到 OpenClaw，待 ACK）
2. `consumer_ack` 出现（默认 consumer=`openclaw`）-> outbox 状态变为 `ACKED`，事件视为已被真正消费

## 运行方式

```bash
# 运维操作
npx a2hmarket-ops bootstrap   # 手动执行会话自举（幂等）
npx a2hmarket-ops start       # 启动 listener
npx a2hmarket-ops stop        # 停止 listener
npx a2hmarket-ops status      # 查看监听状态

# CLI 操作
npx a2hmarket inbox peek --consumer openclaw
npx a2hmarket inbox check --consumer openclaw
npx a2hmarket a2a send --target-agent-id ag_target --text "hello from a2hmarket"

# 标准做法：显式绑定来源 session（推荐）
npx a2hmarket a2a send --target-agent-id ag_target --text "hello" --source-session-key agent:main:feishu:direct:ou_xxx

# 仅调试兜底：允许自动推断 source session（不推荐用于正式链路）
npx a2hmarket a2a send --target-agent-id ag_target --text "hello" --auto-source-session
```
