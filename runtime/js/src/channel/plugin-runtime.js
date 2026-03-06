const { MqttTokenClient } = require("../adapters/mqtt-token-client");
const { MqttTransport } = require("../adapters/mqtt-transport");
const { buildEnvelope, signEnvelope, verifyEnvelope, verifyEnvelopeCore } = require("../protocol/a2a-protocol");

const replayCache = new Map();

function createRuntimeConfig(account) {
  return {
    baseUrl: account.baseUrl,
    mqttTokenBaseUrl: account.mqttTokenBaseUrl || account.baseUrl,
    mqttTokenPath: account.mqttTokenPath,
    mqttTokenSignPath: account.mqttTokenSignPath,
    mqttEndpoint: account.mqttEndpoint,
    mqttPort: account.mqttPort,
    mqttProtocol: account.mqttProtocol,
    mqttClientGroupId: account.mqttGroupId,
    mqttTopicId: account.mqttTopicId,
    mqttReconnectPeriodMs: account.mqttReconnectPeriodMs,
    mqttConnectTimeoutMs: account.mqttConnectTimeoutMs,
    mqttTokenRefreshThresholdMs: account.mqttTokenRefreshThresholdMs,
  };
}

function normalizeIdList(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function formatPaymentQrcode(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return "";
  }
  const normalizedUrl = parsed.toString()
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `[![收款二维码](${normalizedUrl})](${normalizedUrl})`;
}

function buildMessageText(payload) {
  const body = [];
  const text = String(
    payload && (payload.text || payload.message || payload.preview || payload.content || "")
  ).trim();
  if (text) {
    body.push(text);
  }

  const qrcodeText = formatPaymentQrcode(payload && payload.paymentQrcodeUrl);
  if (qrcodeText) {
    body.push(qrcodeText);
  }

  if (body.length > 0) {
    return body.join("\n\n");
  }

  try {
    return JSON.stringify(payload || {});
  } catch {
    return String(payload || "");
  }
}

function normalizeInboundEnvelope({ channelId, accountId, envelope }) {
  const payload = envelope && envelope.payload && typeof envelope.payload === "object"
    ? envelope.payload
    : {};
  const messageId = String(envelope && envelope.message_id ? envelope.message_id : "").trim();
  const senderId = String(envelope && envelope.sender_id ? envelope.sender_id : "").trim() || "unknown";
  const timestamp = String(envelope && envelope.timestamp ? envelope.timestamp : new Date().toISOString());
  const senderName = String(payload.senderName || payload.sender_name || senderId).trim() || senderId;

  return {
    id: messageId || `${channelId || "a2hmarket"}:${senderId}:${timestamp}`,
    channel: String(channelId || "a2hmarket"),
    accountId: String(accountId || "").trim(),
    senderId,
    senderName,
    text: buildMessageText(payload),
    timestamp,
    isGroup: false,
    raw: envelope,
  };
}

function getExpectedInboundTopic(account) {
  const tokenClient = new MqttTokenClient(createRuntimeConfig(account));
  return `${account.mqttTopicId}/p2p/${tokenClient.buildClientId(account.agentId)}`;
}

function isSenderAllowed(account, senderId) {
  const dmPolicy = String(account && account.dmPolicy ? account.dmPolicy : "open").trim();
  const allowedSenders = normalizeIdList(account && account.allowFrom);
  const normalizedSenderId = String(senderId || "").trim();

  if (dmPolicy === "closed") {
    return false;
  }
  if (dmPolicy === "pairing") {
    return allowedSenders.includes(normalizedSenderId);
  }
  if (allowedSenders.length > 0) {
    return allowedSenders.includes(normalizedSenderId);
  }
  return true;
}

function isOutboundTargetAllowed(account, targetAgentId) {
  const allowedTargets = normalizeIdList(account && account.allowTo);
  if (allowedTargets.length === 0) {
    return true;
  }
  return allowedTargets.includes(String(targetAgentId || "").trim());
}

function registerReplayGuard(envelope, toleranceMs) {
  const now = Date.now();
  const cacheTtlMs = Math.max(60 * 1000, Number(toleranceMs) || 0);
  for (const [key, expireAt] of replayCache.entries()) {
    if (expireAt <= now) {
      replayCache.delete(key);
    }
  }

  const replayKey = String(
    envelope && (envelope.message_id || envelope.nonce || envelope.signature || "")
  ).trim();
  if (!replayKey) {
    return true;
  }
  const existing = replayCache.get(replayKey);
  if (existing && existing > now) {
    return false;
  }
  replayCache.set(replayKey, now + cacheTtlMs);
  return true;
}

function parseIncomingEnvelope({ topic, payload, account }) {
  const expectedTopic = getExpectedInboundTopic(account);
  if (String(topic || "").trim() !== expectedTopic) {
    return { ok: false, reason: `unexpected_topic:${topic}` };
  }

  let envelope = null;
  try {
    envelope = typeof payload === "string" ? JSON.parse(payload) : payload;
  } catch (err) {
    return { ok: false, reason: `invalid_json:${err.message}` };
  }

  const toleranceMs = Number.isFinite(Number(account && account.inboundToleranceMs))
    ? Number(account.inboundToleranceMs)
    : 24 * 60 * 60 * 1000;
  const coreWithTolerance = verifyEnvelopeCore(envelope, {
    timestampToleranceMs: toleranceMs,
  });
  if (!coreWithTolerance.ok) {
    return { ok: false, reason: `invalid_envelope:${coreWithTolerance.reason}` };
  }
  if (account.a2aSharedSecret) {
    const verified = verifyEnvelope(account.a2aSharedSecret, envelope, {
      timestampToleranceMs: toleranceMs,
    });
    if (!verified.ok) {
      return { ok: false, reason: `signature_rejected:${verified.reason}` };
    }
  }
  if (String(envelope.target_id || "").trim() !== String(account.agentId || "").trim()) {
    return { ok: false, reason: `unexpected_target:${envelope.target_id || ""}` };
  }
  if (!isSenderAllowed(account, envelope.sender_id)) {
    return { ok: false, reason: `sender_not_allowed:${envelope.sender_id || ""}` };
  }
  if (!registerReplayGuard(envelope, toleranceMs)) {
    return { ok: false, reason: `replay_detected:${envelope.message_id || envelope.nonce || ""}` };
  }

  return { ok: true, envelope };
}

function buildOutboundEnvelope({ account, targetAgentId, text, replyTo, senderId }) {
  const payload = {
    text: String(text || ""),
  };
  if (replyTo && replyTo.messageId) {
    payload.reply_to_message_id = String(replyTo.messageId);
  }

  const envelope = buildEnvelope({
    senderId: String(senderId || account.agentId || "").trim(),
    targetId: String(targetAgentId || "").trim(),
    messageType: "chat.request",
    payload,
  });

  return signEnvelope(account.a2aSharedSecret || account.agentSecret, envelope);
}

async function startChannelConnection({ account, logger, clientFactory, onEnvelope }) {
  const runtimeCfg = createRuntimeConfig(account);
  const tokenClient = new MqttTokenClient(runtimeCfg);
  const transport = new MqttTransport({
    cfg: runtimeCfg,
    tokenClient,
    logger,
    clientFactory,
  });
  const subscribeCurrentAccount = () => transport.subscribeIncoming(account.agentId);

  const handleMessage = (message) => {
    const parsed = parseIncomingEnvelope({
      topic: message.topic,
      payload: message.payload,
      account,
    });
    if (!parsed.ok) {
      if (logger && typeof logger.warn === "function") {
        logger.warn(`a2hmarket channel ignored inbound message: ${parsed.reason}`);
      }
      return;
    }
    if (typeof onEnvelope === "function") {
      onEnvelope(parsed.envelope);
    }
  };

  const handleConnect = () => {
    subscribeCurrentAccount().catch((err) => {
      if (logger && typeof logger.warn === "function") {
        logger.warn(`a2hmarket channel resubscribe failed: ${err.message || String(err)}`);
      }
    });
  };

  transport.on("message", handleMessage);
  transport.on("connect", handleConnect);
  await transport.connect({
    agentId: account.agentId,
    agentSecret: account.agentSecret,
  });
  await subscribeCurrentAccount();

  return {
    transport,
    async publishText({ targetAgentId, text, replyTo }) {
      const envelope = buildOutboundEnvelope({
        account,
        targetAgentId,
        text,
        replyTo,
      });
      await transport.publishToAgent(targetAgentId, envelope, 1);
      return envelope;
    },
    async stop() {
      transport.off("message", handleMessage);
      transport.off("connect", handleConnect);
      transport.close();
    },
  };
}

module.exports = {
  buildOutboundEnvelope,
  createRuntimeConfig,
  formatPaymentQrcode,
  getExpectedInboundTopic,
  normalizeInboundEnvelope,
  parseIncomingEnvelope,
  isOutboundTargetAllowed,
  isSenderAllowed,
  registerReplayGuard,
  startChannelConnection,
};
