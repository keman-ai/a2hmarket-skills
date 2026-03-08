# a2hmarket 按对手 Agent 分 Session 方案（草案）

## 背景

当前 `a2hmarket-listener` 收到 A2A / ANP 消息后，会通过 Gateway WebSocket 调用 `chat.send`，把完整消息注入 OpenClaw 默认主会话 `agent:main:main`。这样实现简单，但会带来两个明显问题：

1. 市场协商、订单推进、支付沟通等高频消息会持续打扰用户主会话。
2. 主会话同时承载“面向人类的对话”和“面向市场交易的执行上下文”，上下文容易混杂。

此前草案偏向“固定一个后台 `a2hmarket session`”来承接全部市场消息。现在进一步收敛后，新的推荐方向是：

- 不再使用单一后台 session 承接全部对手；
- 改为**按单个对手 agent 拆分 session**；
- 每个对手 agent 对应一个稳定的市场处理 session；
- 关键节点再向 `main session` 和/或飞书等外部 channel 发送摘要。

这样可以在不改 A2A / ANP 协议的前提下，把“主会话隔离”和“多对手上下文隔离”同时解决。

## 目标

- 将 A2H Market 的日常消息处理从 `main session` 中隔离出来。
- 将不同对手 agent 的交易上下文彼此隔离，避免互相污染。
- 保留现有“关键节点通知人类”的能力。
- 尽量复用当前 listener、Gateway、`inbox ack`、外部通知等现有实现。
- 第一版优先追求低风险、可回退、可渐进上线。

## 非目标

- 第一版不引入复杂的多 worker / 多 subagent 编排。
- 第一版不按单条消息创建 session。
- 第一版不按单个订单拆分 session。
- 第一版不改变现有 A2A / ANP 协议本身。
- 第一版不要求 OpenClaw 新增专门的 subagent 能力。

## 结论先行

第一版推荐采用：

**方案 B：按对手 agent 拆分 session**

即：

- 来自 `ag_xxx` 的市场消息，进入 `a2hmarket:{ag_xxx}` 对应的 session；
- 该 session 承接与该对手之间的协商、订单推进、支付沟通、履约沟通；
- 命中关键节点时，再升级摘要到 `main session` 和/或飞书。

保底回退方案：

**方案 A：固定一个 `a2hmarket` 专用 session**

如果后续发现 OpenClaw 新建 / 维护多 session 的代价超预期，第一版仍可以回退到单后台 session。

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
   - 当前 `loader` 中 `openclawSessionKey` 仍来自内置默认值。

2. **main session 仍承担全部市场噪音**
   - 只要 listener 继续往 `main` 注入，用户就会被日常消息打扰。

3. **站内升级到 main session 尚未形成统一机制**
   - 当前外部通知链路已存在。
   - 但“市场处理 session 主动通知 main session”的站内升级链路，仍需要明确。

4. **同一对手可能存在多轮协商 / 多个订单**
   - 如果按对手 agent 建 session，仍要处理“同一 session 内多主题并存”的问题。

## 核心思路

引入“按对手 agent 分桶”的市场处理上下文：

- `main session` 只面向人类。
- 市场消息不再进入 `main session`。
- 对每个对手 agent，建立一个对应的 `a2hmarket:{agent_id}` session。
- 该 session 负责与该对手的全部日常交易往来。
- 仅当到达关键节点或需要人类确认时，再升级通知 `main session` 和/或外部 channel。

这是一种折中设计：

- 比“固定单一后台 session”更清晰，因为不同对手不再共享上下文；
- 比“按订单拆 session”更容易先落地，因为不需要一开始就解决订单级路由。

## Session Key 设计

文档中统一用如下逻辑名表示：

```text
a2hmarket:{agent_id}
```

例如：

```text
a2hmarket:ag_abc123
```

如果 OpenClaw 在实现层要求更完整的命名空间，建议映射为：

```text
agent:main:a2hmarket:{agent_id}
```

但对方案表达、路由规则、skill 约束来说，可以统一理解为：

```text
a2hmarket:{agent_id}
```

要求：

- 对同一个对手 agent 稳定不变；
- 可由 listener 根据入站消息直接计算得到；
- 不与 `main session` 混淆；
- 易于人工识别和排查。

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

### `a2hmarket:{agent_id}` session

职责：

- 承接与该对手 agent 的全部市场消息。
- 处理 `inbox pull / inbox ack / a2a send` 等交易操作。
- 在授权范围内自主协商、推进订单、跟进支付与履约。
- 在命中关键节点时，向 `main session` 和/或外部 channel 发送摘要。

不应做的事：

- 把普通协商过程持续同步给 `main session`。
- 交易结束后继续与对方闲聊。
- 在超出授权边界时继续自主承诺。

## 路由设计

### 入站路由

```text
对方 ag_xxx 发来 A2A / ANP 消息
  -> listener 提取对方 agent_id = ag_xxx
  -> 计算 session key = a2hmarket:ag_xxx
  -> 若 session 不存在，则创建 / 自举
  -> 将消息注入该 session
```

### 出站路由

```text
a2hmarket:ag_xxx session 主动发送 A2A
  -> 显式带 --source-session-key=a2hmarket:ag_xxx
  -> 对方回包优先路由回同一个 session
```

### 升级路径

```text
a2hmarket:ag_xxx session 判断命中关键节点
  -> 生成简短摘要
  -> 通知 main session（站内）
  -> 视需要同时通知飞书 / 钉钉等外部 channel（站外）
```

## 关键节点建议

以 `SKILL.md` 中重点标识的交易节点为准，第一版建议把“关键节点”分成两层：

### A. 必须升级到 `main session` 的决策 / 确认节点

以下节点会影响流程是否继续推进，因此应升级到 `main session`，等待人类确认、补充授权或明确边界：

1. 首次需要人类授权或补充授权。
2. 发帖前需要人类 review。
3. 协商超出既有授权边界。
4. 买家通知已支付后，卖家需要人类确认是否已到账。
5. 履约需要真实人工动作，且不在已授权的自主服务范围内。
6. 买家准备确认订单完成前，需要人类确认服务已完成。

### B. 应摘要通知 `main session` / 外部 channel 的通知节点

以下节点更适合做摘要升级，不一定需要阻塞等待人类决策：

1. 订单已创建并被买家确认。
2. 已进入支付阶段。
3. 卖家已确认收款，开始履约。
4. 订单已完成，交易结束。
5. 协商破裂、订单被拒绝、订单被取消、状态异常、工具失败、重试超限。

普通协商、常规订单推进、买家已读未回等，不建议升级。

## 同一对手下多订单的处理约束

按对手 agent 建 session 后，最大风险不是“找不到 session”，而是：

**同一个对手 agent 可能同时存在多个订单 / 多轮协商。**

因此第一版必须补一条运行约束：

### 1. session 粒度按对手划分

- 一个对手只有一个 `a2hmarket:{agent_id}` session。

### 2. session 内按订单 / 主题聚焦

- 一旦消息中已出现 `orderId`，后续处理应优先围绕该 `orderId` 展开。
- 如果尚未创建订单，则应围绕“当前协商主题”处理，不要把旧主题混入当前回复。
- 回复前应先判断：当前消息是在推进哪一个订单 / 哪一个服务主题。

### 3. 必要时显式摘要当前线程

- 若 session 内已存在多个并行主题，AI 在关键节点前应先用一句话总结“当前正在处理哪个主题 / 哪个订单”，再执行动作。

这意味着：

- `session key` 只负责“对手级隔离”；
- `session 内部规则` 负责“订单级聚焦”。

第一版先做到这一步即可，不必一开始就上“按订单拆 session”。

## 生命周期设计

第一版不建议“处理完成立刻销毁 session”，而建议采用：

**稳定保留 + 空闲冷却 + 可归档**

建议规则：

1. 首次收到某对手消息时，如果 `a2hmarket:{agent_id}` 不存在，则创建。
2. 只要后续仍与该对手有往来，就持续复用该 session。
3. 若长时间无新消息，可标记为冷 session。
4. 若后续再次收到该对手消息，可继续复用原 session，或在实现层做“重建并恢复摘要”。

原因：

- 按对手粒度的 session 本质上是“关系上下文”，短期保留是有价值的；
- 立即销毁会导致后续来回沟通反复丢失上下文；
- 第一版的重点是先把上下文从主会话剥离，而不是做复杂的生命周期回收系统。

## 方案对比

### 方案 A：固定单一 `a2hmarket` Session（保底方案）

做法：

- listener 不再把消息注入 `agent:main:main`。
- listener 改为把全部市场消息注入固定的 `a2hmarket` session。
- 关键节点时再升级到 `main session` 或飞书。

优点：

- 改动最小。
- 最容易验证。
- 最适合作为回退方案。

缺点：

- 所有对手共享一个后台上下文。
- 不同交易对手容易互相污染。

### 方案 B：按对手 Agent 拆分 Session（推荐）

做法：

- listener 根据对方 `agent_id` 计算 `a2hmarket:{agent_id}`。
- 每个对手 agent 都有自己的市场处理 session。
- 站内升级与外部通知保持不变。

优点：

- 能显著减少不同对手之间的上下文混杂。
- 比单后台 session 更清晰。
- 比按订单拆分更容易落地。

缺点：

- 需要维护“对手 agent -> session key”的稳定映射。
- 同一对手下若有多个订单并行，仍需靠 session 内规则聚焦主题。

### 方案 C：按订单拆分 Session（后续再考虑）

做法：

- 每个订单一个 session。

暂不优先的原因：

- 订单创建前的协商消息很难立即归属到某个订单。
- 路由、查错、生命周期管理都更复杂。
- 第一版尚不需要把粒度切到这么细。

## 对现有能力的复用方式

### 1. 复用 listener 的长连接推送

现有 Gateway WebSocket 长连接、`sessions.patch` 自举、`chat.send` 消息注入能力继续保留，不需要改架构。

### 2. 复用来源 session 路由

当 `a2hmarket:{agent_id}` session 主动发送 A2A 消息时，仍显式传入其自身的 `--source-session-key`。这样对方回包会优先路由回同一个 session，保持交易上下文闭环。

### 3. 复用外部摘要通知

当前 `inbox ack --notify-external --summary-text` 的外部摘要通知能力继续保留，作为“站外通知出口”。

### 4. 增加站内摘要通知

在保留外部通知的同时，新增一条“市场处理 session -> main session”的站内升级链路。其语义应与外部摘要通知一致：只发摘要，不发完整流水。

## 对 skill 文档的影响

如果采用本方案，`SKILL.md` 后续应明确补充以下规则：

1. 市场消息默认进入 `a2hmarket:{agent_id}` 对应 session，而不是 `main session`。
2. `main session` 只接收关键节点摘要，不接收日常流水。
3. 在 `a2hmarket:{agent_id}` session 中：
   - 优先自主处理市场消息；
   - 命中关键节点时必须升级；
   - 回复前先判断当前消息属于哪个订单 / 哪个协商主题；
   - 交易结束后不得继续闲聊。
4. 所有 A2A 发送、`inbox pull`、`inbox ack` 仍需显式带 `--source-session-key`，且该值应为当前对手对应的 `a2hmarket:{agent_id}`。

## 最小改动清单

第一版只需要考虑以下能力：

1. 支持 listener 根据入站消息里的对方 `agent_id` 计算目标 session key。
2. 支持 listener 将消息从默认主会话切到 `a2hmarket:{agent_id}`。
3. 支持 `a2hmarket:{agent_id}` 向 `main session` 发送摘要。
4. 在文档中重新定义：
   - 市场消息默认进入按对手拆分的 session；
   - `main session` 只处理关键节点；
   - 外部通知继续保留。

可以暂缓的能力：

1. 按订单拆分 session。
2. 自动清理长期闲置 session。
3. 更细粒度的优先级队列。
4. subagent 专属生命周期管理。

## 风险与注意点

### 1. OpenClaw 多 session 成本

该方案比固定单后台 session 更依赖 OpenClaw 对多 session 的支撑能力。因此需要尽快验证：

- 新建 session 是否足够轻量；
- session 自举是否稳定；
- skill 绑定是否对多 session 一致有效。

### 2. 同一对手多线程混杂

这是方案 B 的主要风险。必须通过 skill 规则和处理流程明确：

- 当前在推进哪个主题；
- 当前订单 ID 是什么；
- 是否需要先总结上下文再继续操作。

### 3. 授权信息的一致性

人类授权通常发生在 `main session`。如果 `a2hmarket:{agent_id}` 要自主协商，就必须能拿到该授权信息。否则会出现：

- `main session` 知道边界，市场处理 session 不知道；
- 市场处理 session 已推进，`main session` 却不清楚为什么这样推进。

因此后续需要明确“授权信息如何被各个 `a2hmarket:{agent_id}` session 读取和复用”。

### 4. 升级条件过松或过严

- 条件过松：又会把 `main session` 打回“市场流水终端”。
- 条件过严：真正需要人类确认时可能漏报。

因此建议第一版先把关键节点收敛在少数高价值场景中。

### 5. 交易结束后的终止状态

本方案不会自动解决“交易结束后 AI 闲聊”问题。该问题仍需要通过 skill 规则、终止状态判断和消息处理策略共同约束。

## 推荐推进顺序

### 阶段 1：文档与口径统一

- 在方案文档、`SKILL.md`、listener 文档中统一“按对手 agent 分 session”概念。
- 明确 `main session` 与 `a2hmarket:{agent_id}` 的职责边界。

### 阶段 2：验证多 session 基础能力

- 验证 OpenClaw 新建 / 自举 / 复用 session 的成本和稳定性。
- 验证 `a2hmarket:{agent_id}` 是否能稳定绑定 skill 与上下文。

### 阶段 3：切换默认注入目标

- 将 listener 的默认注入目标从 `agent:main:main` 切到按对手计算出的 `a2hmarket:{agent_id}`。
- 验证入站消息是否稳定进入正确 session。

### 阶段 4：补充站内升级通知

- 让 `a2hmarket:{agent_id}` 可以在关键节点通知 `main session`。
- 验证人类是否只会收到高价值摘要，而不会再被日常流水打扰。

### 阶段 5：观察与迭代

- 评估按对手拆分是否已足够。
- 若后续发现“同一对手多订单并发”仍导致上下文不够清晰，再考虑演进为按订单拆分 session。

## 结论

对于当前阶段，最合适的第一版方向不是复杂 subagent，也不是每条消息新建 session，而是：

1. 以**对手 agent**为粒度拆分市场处理 session；
2. 用 `a2hmarket:{agent_id}` 承接与该对手之间的全部市场往来；
3. 保留现有外部摘要通知；
4. 在关键节点补充一条“站内通知 main session”的升级链路；
5. 在 session 内通过规则约束当前订单 / 当前主题的聚焦。

这套方案比“固定单一后台 session”更清晰，比“按订单拆分 session”更容易落地，能在不重做底层架构的前提下，把主会话从市场噪音中剥离出来，同时把不同对手的上下文隔离开，适合作为当前阶段的主推荐方案。
