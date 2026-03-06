const test = require("node:test");
const assert = require("node:assert/strict");

const {
  listAccountIds,
  resolveAccount,
} = require("../../runtime/js/src/channel/plugin-config");
const {
  normalizeInboundEnvelope,
  parseIncomingEnvelope,
  buildOutboundEnvelope,
} = require("../../runtime/js/src/channel/plugin-runtime");
const { signEnvelope } = require("../../runtime/js/src/protocol/a2a-protocol");
const { a2hmarketChannel } = require("../../extensions/a2hmarket/index");

test("plugin config lists and resolves accounts", () => {
  const cfg = {
    channels: {
      a2hmarket: {
        accounts: {
          default: {
            enabled: true,
            agentId: "agent_main",
            agentSecret: "secret_main",
            baseUrl: "https://market.example.com/",
          },
          work: {
            enabled: false,
            agentId: "agent_work",
            agentSecret: "secret_work",
            mqttEndpoint: "mqtt.example.com",
          },
        },
      },
    },
  };

  assert.deepEqual(listAccountIds(cfg), ["default"]);

  const account = resolveAccount(cfg, "default");
  assert.deepEqual(account, {
    accountId: "default",
    enabled: true,
    agentId: "agent_main",
    agentSecret: "secret_main",
    baseUrl: "https://market.example.com",
    mqttTokenBaseUrl: "https://market.example.com",
    mqttTokenPath: "/mqtt-token/api/v1/token",
    mqttTokenSignPath: "",
    mqttEndpoint: "post-cn-e4k4o78q702.mqtt.aliyuncs.com",
    mqttPort: 8883,
    mqttProtocol: "mqtts",
    mqttGroupId: "GID_agent",
    mqttTopicId: "P2P_TOPIC",
    mqttReconnectPeriodMs: 5000,
    mqttConnectTimeoutMs: 15000,
    mqttTokenRefreshThresholdMs: 60 * 60 * 1000,
    inboundToleranceMs: 24 * 60 * 60 * 1000,
    a2aSharedSecret: "secret_main",
    dmPolicy: "open",
    allowFrom: [],
    allowTo: [],
    groups: {},
  });
  assert.equal(resolveAccount(cfg, "work"), undefined);
});

test("plugin config rejects insecure transport settings", () => {
  assert.throws(
    () =>
      resolveAccount(
        {
          channels: {
            a2hmarket: {
              accounts: {
                default: {
                  enabled: true,
                  agentId: "agent_main",
                  agentSecret: "secret_main",
                  baseUrl: "http://market.example.com",
                },
              },
            },
          },
        },
        "default"
      ),
    /baseUrl must use https/
  );

  assert.throws(
    () =>
      resolveAccount(
        {
          channels: {
            a2hmarket: {
              accounts: {
                default: {
                  enabled: true,
                  agentId: "agent_main",
                  agentSecret: "secret_main",
                  baseUrl: "https://market.example.com",
                  mqttProtocol: "mqtt",
                },
              },
            },
          },
        },
        "default"
      ),
    /mqttProtocol must be mqtts/
  );
});

test("normalizeInboundEnvelope formats payment qrcode for openclaw chat", () => {
  const normalized = normalizeInboundEnvelope({
    channelId: "a2hmarket",
    accountId: "default",
    envelope: {
      message_id: "msg_123",
      sender_id: "agent_seller",
      timestamp: "2026-03-06T10:00:00.000+08:00",
      payload: {
        text: "请扫码付款",
        senderName: "Seller Bot",
        paymentQrcodeUrl: "https://cdn.example.com/pay.png",
      },
    },
  });

  assert.equal(normalized.id, "msg_123");
  assert.equal(normalized.channel, "a2hmarket");
  assert.equal(normalized.accountId, "default");
  assert.equal(normalized.senderId, "agent_seller");
  assert.equal(normalized.senderName, "Seller Bot");
  assert.match(normalized.text, /请扫码付款/);
  assert.match(
    normalized.text,
    /\[!\[收款二维码\]\(https:\/\/cdn\.example\.com\/pay\.png\)\]\(https:\/\/cdn\.example\.com\/pay\.png\)/
  );
});

test("parseIncomingEnvelope validates topic and signature", () => {
  const account = {
    agentId: "agent_receiver",
    a2aSharedSecret: "shared_secret",
    mqttTopicId: "P2P_TOPIC",
    mqttGroupId: "GID_agent",
    inboundToleranceMs: 24 * 60 * 60 * 1000,
  };

  const envelope = buildOutboundEnvelope({
    account,
    targetAgentId: "agent_receiver",
    text: "hello",
    senderId: "agent_sender",
  });

  const parsed = parseIncomingEnvelope({
    topic: "P2P_TOPIC/p2p/GID_agent@@@agent_receiver",
    payload: JSON.stringify(envelope),
    account,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.envelope.message_id, envelope.message_id);
  assert.equal(parsed.envelope.payload.text, "hello");
});

test("parseIncomingEnvelope rejects replayed envelopes", () => {
  const account = {
    agentId: "agent_receiver",
    a2aSharedSecret: "shared_secret",
    mqttTopicId: "P2P_TOPIC",
    mqttGroupId: "GID_agent",
    inboundToleranceMs: 24 * 60 * 60 * 1000,
  };

  const envelope = buildOutboundEnvelope({
    account,
    targetAgentId: "agent_receiver",
    text: "hello once",
    senderId: "agent_sender",
  });

  const firstParsed = parseIncomingEnvelope({
    topic: "P2P_TOPIC/p2p/GID_agent@@@agent_receiver",
    payload: JSON.stringify(envelope),
    account,
  });
  const secondParsed = parseIncomingEnvelope({
    topic: "P2P_TOPIC/p2p/GID_agent@@@agent_receiver",
    payload: JSON.stringify(envelope),
    account,
  });

  assert.equal(firstParsed.ok, true);
  assert.equal(secondParsed.ok, false);
  assert.match(secondParsed.reason, /replay_detected/);
});

test("parseIncomingEnvelope accepts delayed qos message within configured tolerance", () => {
  const account = {
    agentId: "agent_receiver",
    a2aSharedSecret: "shared_secret",
    mqttTopicId: "P2P_TOPIC",
    mqttGroupId: "GID_agent",
    inboundToleranceMs: 24 * 60 * 60 * 1000,
  };

  const delayedEnvelope = buildOutboundEnvelope({
    account: {
      agentId: "agent_sender",
      a2aSharedSecret: "shared_secret",
    },
    targetAgentId: "agent_receiver",
    text: "offline delivery",
  });
  delayedEnvelope.timestamp = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const reparsedEnvelope = {
    ...delayedEnvelope,
  };
  reparsedEnvelope.signature = signEnvelope("shared_secret", reparsedEnvelope).signature;

  const parsed = parseIncomingEnvelope({
    topic: "P2P_TOPIC/p2p/GID_agent@@@agent_receiver",
    payload: JSON.stringify(reparsedEnvelope),
    account,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.envelope.payload.text, "offline delivery");
});

test("buildOutboundEnvelope keeps reply context and signs payload", () => {
  const envelope = buildOutboundEnvelope({
    account: {
      agentId: "agent_sender",
      a2aSharedSecret: "shared_secret",
    },
    targetAgentId: "agent_receiver",
    text: "收到，我会处理",
    replyTo: {
      messageId: "msg_parent",
    },
  });

  assert.equal(envelope.sender_id, "agent_sender");
  assert.equal(envelope.target_id, "agent_receiver");
  assert.equal(envelope.payload.text, "收到，我会处理");
  assert.equal(envelope.payload.reply_to_message_id, "msg_parent");
  assert.ok(envelope.signature);
});

test("parseIncomingEnvelope rejects sender outside allowFrom in pairing mode", () => {
  const account = {
    agentId: "agent_receiver",
    a2aSharedSecret: "shared_secret",
    mqttTopicId: "P2P_TOPIC",
    mqttGroupId: "GID_agent",
    dmPolicy: "pairing",
    allowFrom: ["agent_friend"],
  };

  const envelope = buildOutboundEnvelope({
    account: {
      agentId: "agent_stranger",
      a2aSharedSecret: "shared_secret",
    },
    targetAgentId: "agent_receiver",
    text: "hello",
  });

  const parsed = parseIncomingEnvelope({
    topic: "P2P_TOPIC/p2p/GID_agent@@@agent_receiver",
    payload: JSON.stringify(envelope),
    account,
  });

  assert.equal(parsed.ok, false);
  assert.match(parsed.reason, /sender_not_allowed/);
});

test("plugin sendText rejects disabled account without throwing", async () => {
  const result = await a2hmarketChannel.outbound.sendText({
    text: "hello",
    target: { id: "agent_receiver" },
    account: {
      accountId: "disabled",
      enabled: false,
      agentId: "agent_sender",
      agentSecret: "secret",
    },
  });

  assert.deepEqual(result, {
    ok: false,
    error: "a2hmarket account is disabled",
  });
});

test("plugin messaging only accepts validated normalized events", async () => {
  await assert.rejects(
    () => a2hmarketChannel.messaging.onMessage({ envelope: { message_id: "raw" } }),
    /validated normalized event is required/
  );

  const normalized = { id: "msg_1", text: "hello" };
  const emitted = [];
  const returned = await a2hmarketChannel.messaging.onMessage(
    { normalized },
    {
      emitMessage(message) {
        emitted.push(message);
      },
    }
  );

  assert.deepEqual(returned, normalized);
  assert.deepEqual(emitted, [normalized]);
});

test("normalizeInboundEnvelope ignores unsafe payment qrcode urls", () => {
  const normalized = normalizeInboundEnvelope({
    channelId: "a2hmarket",
    accountId: "default",
    envelope: {
      message_id: "msg_unsafe",
      sender_id: "agent_seller",
      payload: {
        text: "bad link",
        paymentQrcodeUrl: "javascript:alert(1)",
      },
    },
  });

  assert.equal(normalized.text, "bad link");
});
