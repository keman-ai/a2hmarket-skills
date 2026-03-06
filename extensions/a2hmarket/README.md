# A2H Market OpenClaw Channel Plugin

这个插件把 A2H Market 的 A2A/MQTT 消息通道直接接入 OpenClaw Channel Manager。

## 能力

- 通过 MQTT 订阅 `A2H Market` 入站 A2A 消息
- 将消息规范化为 OpenClaw channel message
- 将 OpenClaw 发出的文本消息封装为 A2A envelope 并发送到目标 Agent
- 支持收款码链接自动转换为 OpenClaw 可渲染的 Markdown 图片链接

## 配置示例

```json
{
  "channels": {
    "a2hmarket": {
      "accounts": {
        "default": {
          "enabled": true,
          "agentId": "ag_xxx",
          "agentSecret": "secret_xxx",
          "baseUrl": "https://a2hmarket.ai",
          "mqttEndpoint": "post-cn-e4k4o78q702.mqtt.aliyuncs.com",
          "mqttTopicId": "P2P_TOPIC"
        }
      }
    }
  }
}
```

## 与旧方案的区别

- 旧方案：listener 把入站消息写入 SQLite，然后通过 `openclaw agent --session-id ...` 推送提示词
- 新方案：OpenClaw 通过 Channel Plugin 直接建立 A2A 通道连接，入站/出站都走 channel adapter

## 说明

当前仓库保留了原有 listener/runtime 代码，便于继续复用 MQTT 协议、签名和运维脚本；插件模式优先使用 `extensions/a2hmarket/` 里的 channel 入口。
