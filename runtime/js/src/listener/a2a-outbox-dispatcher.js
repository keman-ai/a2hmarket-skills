const { nowMs } = require("../store/event-store");
const { coerceInt } = require("./message-utils");
const { peerSessionKey } = require("../gateway/peer-session-manager");

function calculateBackoffMs(attempt, maxDelayMs) {
  const normalizedAttempt = Math.max(1, Math.min(10, coerceInt(attempt, 1)));
  const base = 1000 * 2 ** (normalizedAttempt - 1);
  const capped = Math.min(base, coerceInt(maxDelayMs, 60 * 1000));
  return Math.max(1000, capped);
}

/**
 * 从 a2a_outbox row 的 envelope_json 中提取消息正文，用于注入 peer session 上下文。
 */
function extractOutboundText(row) {
  let envelope = row.envelope;
  if (typeof envelope === "string") {
    try { envelope = JSON.parse(envelope); } catch { return ""; }
  }
  const payload = envelope && envelope.payload ? envelope.payload : envelope;
  return String(payload && (payload.text || payload.message) || "").trim();
}

/**
 * 出站 A2A 消息发送成功后，确保 peer session 已自举，
 * 并将上下文（发了什么、从哪个 session 发起的）注入 peer session。
 */
async function migrateContextToPeerSession(row, options) {
  const peerSessionManager = options && options.peerSessionManager;
  const gatewayClient = options && options.gatewayClient;
  const logger = options && options.logger;
  if (!peerSessionManager || !gatewayClient) return;

  const targetId = String(row.target_agent_id || "").trim();
  if (!targetId) return;

  const peerKey = peerSessionKey(targetId);
  try {
    await peerSessionManager.ensureSession(peerKey);

    const text = extractOutboundText(row);
    const sourceSession = row.source_session_key || row.source_session_id || "main";
    const contextMsg = [
      `[A2H Market 会话已建立 | peer:${targetId} | trace:${row.trace_id || "-"}]`,
      "",
      `来源 session: ${sourceSession}`,
      `你发送的消息: ${text || "(payload)"}`,
      "",
      "后续来自该对手 agent 的回复将出现在此 session 中。",
    ].join("\n");

    await gatewayClient.chatSend({ sessionKey: peerKey, message: contextMsg });
    if (logger) {
      logger.info(`peer session context migrated target=${targetId} peer_key=${peerKey} source=${sourceSession}`);
    }
  } catch (err) {
    if (logger) {
      logger.warn(`peer session context migration failed target=${targetId}: ${err && err.message ? err.message : String(err)}`);
    }
  }
}

async function flushA2aOutbox(store, cfg, logger, options) {
  const publish = options && typeof options.publish === "function" ? options.publish : null;
  if (!publish) {
    return { sent: 0, retried: 0 };
  }
  const nowFn = options && typeof options.now === "function" ? options.now : nowMs;
  const batchSize = coerceInt(cfg.a2aOutboxBatchSize, 50);
  const rows = store.listPendingA2aOutbox({
    now: nowFn(),
    batchSize,
  });

  let sent = 0;
  let retried = 0;
  for (const row of rows) {
    try {
      logger.info(
        `a2a outbox dispatching message_id=${row.message_id} trace_id=${row.trace_id || "-"} target_id=${row.target_agent_id} message_type=${row.message_type} attempt=${row.attempt || 0} source_session=${row.source_session_key || row.source_session_id || "-"}`
      );

      await publish(row.target_agent_id, row.envelope, row.qos);
      store.markA2aOutboxSent({ id: row.id });
      sent += 1;

      // 发送成功后触发 peer session 创建 + 上下文注入
      await migrateContextToPeerSession(row, {
        peerSessionManager: options.peerSessionManager,
        gatewayClient: options.gatewayClient,
        logger,
      });
    } catch (err) {
      const nextAttempt = coerceInt(row.attempt, 0) + 1;
      const delayMs = calculateBackoffMs(nextAttempt, cfg.a2aOutboxRetryMaxDelayMs);
      const nextRetryAt = nowFn() + delayMs;
      const detail = (err && err.message) || String(err);
      store.markA2aOutboxRetry({
        id: row.id,
        attempt: nextAttempt,
        nextRetryAt,
        lastError: detail,
      });
      retried += 1;
      logger.warn(
        `a2a outbox retry message_id=${row.message_id} attempt=${nextAttempt} retry_in_ms=${delayMs} detail=${String(detail).slice(0, 200)}`
      );
    }
  }

  return { sent, retried };
}

module.exports = {
  flushA2aOutbox,
  calculateBackoffMs,
};
