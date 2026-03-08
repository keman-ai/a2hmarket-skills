const { parseOptions } = require("./arg-parser");
const { resolveListenerConfig } = require("../config/loader");
const { createLogger } = require("../listener/logger");
const { MqttTokenClient } = require("../adapters/mqtt-token-client");
const { buildEnvelope, signEnvelope } = require("../protocol/a2a-protocol");
const { getListenerProcess, enqueueOutboundEnvelope } = require("../a2a/outbound-queue");
const { formatSessionRef, scrubSessionRefs } = require("../utils/session-ref");

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  a2hmarket a2a send --target-agent-id <agent_id> (--text <message> | --payload-json <json>) [--message-type <type>] [--trace-id <id>] [--qos <0|1>] [--source-session-id <id>] [--source-session-key <key>] [--auto-source-session] [--verbose]",
      "",
      "Note:",
      "  - trade negotiation is handled primarily by the SKILL layer.",
      "  - 推荐先调用 session_status 获取当前 sessionKey，再传 --source-session-key。",
      "  - 默认要求显式 source session；仅调试场景可用 --auto-source-session 走自动推断。",
      "  - use this CLI only for debugging or manual testing of A2A messages.",
    ].join("\n") + "\n"
  );
}

function parsePayload(options) {
  const payloadJson = options["payload-json"];
  const text = options.text;

  if (payloadJson != null) {
    let parsed = null;
    try {
      parsed = JSON.parse(String(payloadJson));
    } catch (err) {
      throw new Error(`invalid --payload-json: ${(err && err.message) || String(err)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("--payload-json must be a JSON object");
    }
    if (text != null && parsed.text == null) {
      parsed.text = String(text);
    }
    return parsed;
  }

  if (text == null || String(text).trim() === "") {
    throw new Error("either --text or --payload-json is required");
  }
  return { text: String(text) };
}

function parseQos(raw) {
  if (raw == null) return 1;
  const qos = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(qos) || (qos !== 0 && qos !== 1)) {
    throw new Error("--qos must be 0 or 1");
  }
  return qos;
}

function parseBoolFlag(raw) {
  if (raw == null) return false;
  if (raw === true) return true;
  const text = String(raw).trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function isA2aSendEnabled() {
  const raw = String(process.env.A2HMARKET_ENABLE_A2A_SEND || "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function runA2aSend(options) {
  

  const targetAgentId = String(options["target-agent-id"] || options.target || "").trim();
  if (!targetAgentId) {
    throw new Error("--target-agent-id is required");
  }

  const payload = parsePayload(options);
  const messageType = String(options["message-type"] || "chat.request").trim() || "chat.request";
  const qos = parseQos(options.qos);
  const sourceSessionKey = String(options["source-session-key"] || "").trim();
  const sourceSessionId = String(options["source-session-id"] || "").trim();
  const autoSourceSession = parseBoolFlag(options["auto-source-session"]);
  if (!sourceSessionKey && !sourceSessionId && !autoSourceSession) {
    throw new Error(
      "missing --source-session-key. 请先调用 session_status 获取当前 sessionKey，再执行 a2a send；仅调试场景可用 --auto-source-session 兜底。"
    );
  }

  const originalPushEnabled = process.env.A2HMARKET_PUSH_ENABLED;
  if (originalPushEnabled == null) {
    process.env.A2HMARKET_PUSH_ENABLED = "false";
  }
  let cfg = null;
  try {
    cfg = resolveListenerConfig();
  } finally {
    if (originalPushEnabled == null) {
      delete process.env.A2HMARKET_PUSH_ENABLED;
    }
  }
  const logger = createLogger(Boolean(options.verbose));

  const signSecret = cfg.a2aSharedSecret || cfg.agentSecret;
  if (!signSecret) {
    throw new Error("missing signing secret: configure A2HMARKET_A2A_SHARED_SECRET or AGENT_SECRET");
  }

  const tokenClient = new MqttTokenClient(cfg);
  const envelope = signEnvelope(
    signSecret,
    buildEnvelope({
      senderId: cfg.agentId,
      targetId: targetAgentId,
      messageType,
      traceId: options["trace-id"] ? String(options["trace-id"]) : undefined,
      payload,
    })
  );
  const sentTopic = `${cfg.mqttTopicId}/p2p/${tokenClient.buildClientId(targetAgentId)}`;
  logger.info(
    `a2a send prepared target_id=${targetAgentId} topic=${sentTopic} message_type=${messageType} message_id=${envelope.message_id} trace_id=${envelope.trace_id}`
  );
  const listener = getListenerProcess(cfg.lockPath);
  if (listener.running) {
    const queued = enqueueOutboundEnvelope({
      cfg,
      targetAgentId,
      messageType,
      qos,
      envelope,
      sourceSessionId,
      sourceSessionKey,
    });
    logger.info(
      `a2a send queued target_id=${targetAgentId} message_type=${messageType} message_id=${envelope.message_id} trace_id=${envelope.trace_id} source_session=${queued.source_session_key || queued.source_session_id || "-"} source_session_source=${queued.source_session_source || "-"} duplicate=${queued.created ? "false" : "true"}`
    );
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          queued: true,
          duplicate: !queued.created,
          queue_mode: "listener",
          listener_pid: listener.pid,
          topic: sentTopic,
          sender_id: cfg.agentId,
          target_id: targetAgentId,
          message_type: messageType,
          message_id: envelope.message_id,
          trace_id: envelope.trace_id,
          source_session_ref: formatSessionRef(
            queued.source_session_key,
            queued.source_session_id
          ),
          source_session_source: queued.source_session_source,
          source_session_lookup_ok: queued.source_session_lookup_ok,
          source_session_lookup_detail: scrubSessionRefs(queued.source_session_lookup_detail),
        },
        null,
        2
      ) + "\n"
    );
    return 0;
  }
  logger.warn("a2a send rejected: listener is not running (strict listener-only mode)");
  throw new Error("listener is not running; send is listener-only. start listener first");
}

async function runA2aCli(args) {
  const command = args[0];
  const options = parseOptions(args.slice(1));
  if (!command || options.help || options.h) {
    printUsage();
    return 1;
  }
  if (command !== "send") {
    printUsage();
    return 1;
  }

  try {
    return await runA2aSend(options);
  } catch (err) {
    process.stderr.write(
      `[a2hmarket-a2a] ${scrubSessionRefs((err && err.message) || String(err))}\n`
    );
    return 1;
  }
}

module.exports = {
  runA2aCli,
  parsePayload,
  parseQos,
  isA2aSendEnabled,
};
