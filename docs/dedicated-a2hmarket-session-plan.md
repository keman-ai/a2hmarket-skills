# a2hmarket 专用 Session 方案（草案）

## 背景

当前 `a2hmarket-listener` 收到 A2A / ANP 消息后，会通过 Gateway WebSocket 调用 `chat.send`，把完整消息注入 OpenClaw 默认主会话 `agent:main:main`。这样实现简单，但会带来两个明显问题：

1. 市场协商、订单推进、支付沟通等高频消息会持续打扰用户主会话。
2. 主会话同时承载“面向人类的对话”和“面向市场交易的执行上下文”，上下文容易混杂。

与此同时，当前系统已经具备以下基础能力：

- 监听器可以通过 Gateway 长连接把消息写入指定 OpenClaw session。
- 监听器支持在 `inbox ack` 时显式触发外部摘要通知。
- OpenClaw 多个 session 之间可以互通，因此一个 session 可以在关键节点通知另一个 session。

基于以上条件，可以考虑引入一个固定的 `a2hmarket` 专用 session，专门处理市场消息，将主会话从日常交易流水中解耦出来。

## 目标

- 将 A2H Market 的日常消息处理从 `main session` 中隔离出来。
- 保留现有“关键节点通知人类”的能力。
- 尽量复用当前 listener、Gateway、`inbox ack`、外部通知等现有实现。
- 第一版方案优先追求低改动、低风险、可渐进上线。

## 非目标

- 第一版不引入复杂的多 worker / 多 subagent 编排。
- 第一版不按每个交易对手拆分独立 session。
- 第一版不改变现有 A2A / ANP 协议本身。
- 第一版不要求 OpenClaw 新增专门的 subagent 能力。

## 现状与约束

### 当前消息路径

```text
A2A / ANP 入站消息
  -> a2hmarket-listener
  -> Gateway chat.send
  -> OpenClaw 默认主会话 agent:main:main
  -> AI 在主会话中处理
  -> 关键事件时，再通过 inbox ack 触发外部摘要通知
```

### 当前已具备的能力

1. **Session 注入**
   - 监听器已通过 Gateway `chat.send` 向指定 session 写入文本。
   - 会话自举已通过 `sessions.patch` 实现。

2. **外部摘要通知**
   - `inbox ack --notify-external --summary-text` 已能触发飞书、钉钉等外部 channel 的摘要通知。

3. **来源会话绑定**
   - 当前发送 A2A 时，显式传 `--source-session-key` 后，后续无 trace 回包可优先路由回该 session。

### 当前限制

1. **默认推送目标仍固定为主会话**
   - runtime 默认值为 `agent:main:main`。
   - 当前 `loader` 中 `openclawSessionKey` 仍来自内置默认值，而不是显式可配置的专用 session。

2. **main session 仍承担全部市场噪音**
   - 只要 listener 继续往 `main` 注入，用户就会被日常消息打扰。

3. **站内升级到 main session 尚未形成统一机制**
   - 当前外部通知链路已存在。
   - 但“专用 session 主动通知 main session”的站内升级链路，仍需要在方案中明确。

## 核心思路

引入一个固定的 `a2hmarket` 专用 session，作为市场交易的后台执行上下文。

推荐原则：

- `main session` 只面向人类。
- `a2hmarket session` 只面向交易执行。
- 平时所有 A2H Market 消息都进入 `a2hmarket session`。
- 仅当到达关键节点或需要人类确认时，再升级通知 `main session` 和/或外部 channel。

## 角色分工

### `main session`

职责：

- 接收人类授权与高层目标。
- 接收关键节点摘要。
- 在需要时做最终确认或人工介入。
- 保持对用户友好，不承接完整市场流水。

不负责：

- 日常协商来回消息。
- 所有订单状态变更的逐条展示。
- 每次支付沟通、履约沟通的细粒度处理。

### `a2hmarket session`

职责：

- 承接 listener 注入的全部市场消息。
- 处理 `inbox pull / inbox ack / a2a send` 等交易操作。
- 在授权范围内自主协商、推进订单、跟进支付与履约。
- 在命中关键节点时，向 `main session` 和/或外部 channel 发送摘要。

不应做的事：

- 把普通协商过程持续同步给 `main session`。
- 交易结束后继续与对方闲聊。
- 在超出授权边界时继续自主承诺。

## 目标消息流

### 日常路径

```text
对方发来 A2A / ANP 消息
  -> listener
  -> 注入 a2hmarket 专用 session
  -> a2hmarket session 自主处理
  -> 必要时发送 A2A 回复 / 调用平台 API / ack 事件
```

### 升级路径

```text
a2hmarket session 判断命中关键节点
  -> 生成简短摘要
  -> 通知 main session（站内）
  -> 视需要同时通知飞书 / 钉钉等外部 channel（站外）
```

### 关键节点建议

第一版建议只在以下情况升级到 `main session`：

1. 首次需要人类授权或补充授权。
2. 协商超出人类授权边界。
3. 卖家需要人类确认收款。
4. 履约需要真实人工动作。
5. 订单异常、状态不一致、工具失败、重试超限。
6. 交易完成，需要给人类一个收尾摘要。

普通协商、常规订单推进、买家已读未回等，不建议升级。

## Session Key 建议

第一版建议使用固定的专用 session key，例如：

```text
agent:main:a2hmarket
```

或其他符合 OpenClaw 约定的稳定 key，只要满足以下条件：

- 固定不变，便于 listener 长期绑定。
- 不与主会话混淆。
- 易于人工识别。

不建议第一版就为每个交易对手拆独立 session，例如：

```text
agent:main:a2hmarket:ag_xxx
```

原因：

- 会显著增加路由和状态管理复杂度。
- 会让人工排查问题时需要跨多个 session 查找上下文。
- 第一版尚未证明“单专用 session”是否已足够。

## 推荐实施方式

### 方案 A：单专用 Session（推荐）

做法：

- listener 不再把消息注入 `agent:main:main`。
- listener 改为把消息注入固定的 `a2hmarket` session。
- 该 session 内承接全部市场交易上下文。
- 关键节点时再升级到 `main session` 或飞书。

优点：

- 改动最小。
- 不依赖 OpenClaw 新增 subagent 能力。
- 最容易验证效果。

缺点：

- 所有交易仍共用一个后台上下文。
- 后续如果交易量很大，可能需要进一步拆分。

### 方案 B：subagent Session（暂不优先）

做法：

- 使用 `subagent` 类型 session 承接市场消息。

暂不优先的原因：

- 需要确认 OpenClaw 对 subagent 的运行时约束。
- 需要确认 skill 注入、权限、路由行为是否与普通 session 一致。
- 当前目标是先解决“主会话被打扰”的问题，普通专用 session 已可满足。

## 对现有能力的复用方式

### 1. 复用 listener 的长连接推送

现有 Gateway WebSocket 长连接、`sessions.patch` 自举、`chat.send` 消息注入能力继续保留，不需要改架构。

### 2. 复用来源 session 路由

当 `a2hmarket session` 主动发送 A2A 消息时，仍显式传入其自身的 `--source-session-key`。这样对方回包会优先路由回同一个 `a2hmarket session`，保持交易上下文闭环。

### 3. 复用外部摘要通知

当前 `inbox ack --notify-external --summary-text` 的外部摘要通知能力继续保留，作为“站外通知出口”。

### 4. 增加站内摘要通知

在保留外部通知的同时，新增一条“专用 session -> main session”的站内升级链路。其语义应与外部摘要通知一致：只发摘要，不发完整流水。

## 对 skill 文档的影响

如果采用本方案，`SKILL.md` 后续应明确补充以下规则：

1. `a2hmarket session` 是市场消息的默认处理上下文。
2. `main session` 只接收关键节点摘要，不接收日常流水。
3. 在 `a2hmarket session` 中：
   - 优先自主处理市场消息。
   - 命中关键节点时必须升级。
   - 交易结束后不得继续闲聊。
4. 所有 A2A 发送、`inbox pull`、`inbox ack` 仍需显式带 `--source-session-key`，且该值应为 `a2hmarket session` 的 session key。

## 最小改动清单

第一版只需要考虑以下能力：

1. 支持把 listener 的目标 session 从默认主会话切到固定 `a2hmarket session`。
2. 支持 `a2hmarket session` 向 `main session` 发送摘要。
3. 在文档中重新定义：
   - 市场消息默认进入专用 session
   - main session 只处理关键节点
   - 外部通知继续保留

可以暂缓的能力：

1. 多交易对手拆分多 session。
2. 自动创建 / 回收临时 session。
3. 更细粒度的优先级队列。
4. subagent 专属生命周期管理。

## 风险与注意点

### 1. 专用 session 的可发现性

如果人类不知道还有一个 `a2hmarket session` 存在，排查问题时可能找不到上下文。因此需要：

- 在文档中明确它的用途。
- 让 `main session` 能在需要时提供“查看市场处理上下文”的入口。

### 2. 授权信息的一致性

人类授权通常发生在 `main session`。如果 `a2hmarket session` 要自主协商，就必须能拿到该授权信息。否则会出现：

- main 知道边界，a2hmarket 不知道；
- 或 a2hmarket 已推进，main 却不清楚为什么这样推进。

因此后续需要明确“授权信息如何被 `a2hmarket session` 读取和复用”。

### 3. 升级条件过松或过严

- 条件过松：又会把 main session 打回“市场流水终端”。
- 条件过严：真正需要人类确认时可能漏报。

因此建议第一版先把关键节点收敛在少数高价值场景中。

### 4. 交易结束后的终止状态

本方案不会自动解决“交易结束后 AI 闲聊”问题。该问题仍需要通过 skill 规则、终止状态判断和消息处理策略共同约束。

## 推荐推进顺序

### 阶段 1：文档与口径统一

- 在方案文档、`SKILL.md`、listener 文档中统一“专用 session”概念。
- 明确 `main session` 与 `a2hmarket session` 的职责边界。

### 阶段 2：切换默认注入目标

- 将 listener 的默认注入目标从 `agent:main:main` 切到固定 `a2hmarket session`。
- 验证消息是否稳定进入该专用 session。

### 阶段 3：补充站内升级通知

- 让 `a2hmarket session` 可以在关键节点通知 `main session`。
- 验证人类是否只会收到高价值摘要，而不会再被日常流水打扰。

### 阶段 4：观察与迭代

- 评估单专用 session 是否足够。
- 若后续交易量和复杂度显著提升，再考虑多 session / subagent 方案。

## 结论

对于当前阶段，最务实的方向不是直接引入复杂 subagent 体系，而是：

1. 建立一个固定的 `a2hmarket` 专用 session。
2. 让 listener 只把市场消息注入这个 session。
3. 保留现有外部摘要通知。
4. 在关键节点补充一条“站内通知 main session”的升级链路。

这套方案能在不重做底层架构的前提下，把市场执行上下文从主会话里剥离出来，减少用户干扰，同时保留必要的人机协作节点，适合作为第一版落地方案。
