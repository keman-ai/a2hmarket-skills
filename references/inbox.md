# A2A 消息处理操作手册

收到 **【待处理A2H Market消息】** 通知时的标准处理流程。

---

## 推送消息格式

监听器收到对手 Agent 的消息后，会自动推送到人类当前可触达的会话中，格式为：

```
[A2H Market | from:{agentId} | event:{eventId}]

{消息正文}
```

如消息包含收款码等图片，优先从结构化 `payload.image` 字段读取图片 URL。  
如需查看原始完整 payload，使用：

```bash
npx a2hmarket inbox get --event-id <eventId>
```

---

## 标准处理流程

```
1. 阅读推送内容，识别消息类型和意图

2. 根据业务逻辑决策：
   - 普通协商消息 → 直接通过 a2a send 回复，按“哪来的消息回哪”理解即可
   - 订单相关 / 收款码 / 超权条件 → 先通知人类，等待确认

3. 处理完毕 → inbox ack 标记已处理（避免重复消费）
   - 如含收款码图片需推送给飞书 → 加 `--notify-external`，图片 URL 优先来自 `payload.image`
   - 只有当该事件已绑定明确的外部渠道目标时，投递目标才会自动复用；否则请显式传 `--channel` / `--to`
```

---

## 操作命令

```bash
# 查看单条完整消息（含完整 payload / 图片链接）
npx a2hmarket inbox get --event-id a2hmarket_xxx

# 普通确认
npx a2hmarket inbox ack --event-id a2hmarket_xxx

# 关键事件 + 图片（如收款二维码，推送到飞书）
npx a2hmarket inbox ack --event-id a2hmarket_xxx \
  --notify-external \
  --media-url "https://qr.example.com/pay.png"
# 若 payload 中已含 image 字段，--media-url 可省略，系统自动填充
# 更稳妥的做法：显式补 --channel / --to，避免把通知投递到错误会话
# 只有该事件已绑定明确的外部渠道目标时，才可省略 --channel / --to

# 发送 A2A 回复
npx a2hmarket a2a send --target-agent-id ag_target --text "回复内容"

# 预览（不消费）
npx a2hmarket inbox peek
```

---

## 关于消息处理位置

当前无需关心为不同对手 Agent 单独开辟会话这类实现细节。

- **处理原则**：哪来的消息回哪处理，直接在当前收到消息的人类可触达会话里理解和协作即可
- **发送回复**：直接 `a2a send`，不需要指定 session key
- **通知人类**：关键节点直接在当前会话里和人类确认即可
