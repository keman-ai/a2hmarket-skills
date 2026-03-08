const { nowMs } = require("../store/event-store");
const { MAIN_SESSION_KEY, resolvePushSession } = require("../config/openclaw-routing");
const { formatSystemEventText, coerceInt } = require("./message-utils");
const { scrubSessionRefs } = require("../utils/session-ref");
const { PEER_SESSION_PREFIX } = require("../gateway/peer-session-manager");

function calculateBackoffMs(attempt, maxDelayMs) {
  const normalizedAttempt = Math.max(1, Math.min(10, coerceInt(attempt, 1)));
  const base = 1000 * 2 ** (normalizedAttempt - 1);
  const capped = Math.min(base, coerceInt(maxDelayMs, 5 * 60 * 1000));
  return Math.max(1000, capped);
}

async function runGatewayPush(gatewayClient, text, options) {
  const resolved = (options && options.resolvedSession) || {
    sessionKey: MAIN_SESSION_KEY,
    source: "fallback",
  };
  const peerSessionManager = options && options.peerSessionManager;
  const started = nowMs();

  try {
    const sessionKey = resolved.sessionKey || MAIN_SESSION_KEY;

    // 若目标是 peer 专属 session（非 main），先确保它已自举
    if (
      peerSessionManager &&
      sessionKey !== MAIN_SESSION_KEY &&
      sessionKey.startsWith(PEER_SESSION_PREFIX)
    ) {
      await peerSessionManager.ensureSession(sessionKey);
    }

    await gatewayClient.chatSend({ sessionKey, message: text });
    // 注：若目标是 feishu/外部 session，可通过 sourceSessionKey 告知 Gateway 回复路由
    // 当前 push_outbox 路径是 peer → feishu（通知方向），无需 sourceSessionKey
    // sourceSessionKey 用于反向：从 feishu session 通知时携带 peer session key
    const elapsed = nowMs() - started;
    return { ok: true, detail: `elapsed_ms=${elapsed} gateway chat.send ok session=${scrubSessionRefs(sessionKey)}` };
  } catch (err) {
    const elapsed = nowMs() - started;
    return { ok: false, detail: `elapsed_ms=${elapsed} ${err.message || String(err)}`.trim() };
  }
}

async function listSessionsViaGateway(gatewayClient) {
  try {
    const result = await gatewayClient.sessionsList();
    const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    return { ok: true, detail: "", sessions };
  } catch (err) {
    return { ok: false, detail: String(err.message || err), sessions: [] };
  }
}

async function flushPushOutbox(store, cfg, logger, options) {
  if (!cfg.pushEnabled) {
    return { dispatched: 0, acked: 0, retried: 0, skipped: 0 };
  }
  const nowFn = options && typeof options.now === "function" ? options.now : nowMs;
  const gatewayClient = options && options.gatewayClient;
  const peerSessionManager = options && options.peerSessionManager;
  const pushFn = options && typeof options.push === "function"
    ? options.push
    : (_, text, opts) => runGatewayPush(gatewayClient, text, { ...opts, peerSessionManager });

  const tsNow = nowFn();

  const listed = gatewayClient
    ? await listSessionsViaGateway(gatewayClient)
    : { ok: false, detail: "no gateway client", sessions: [] };

  const pushBatchSize = coerceInt(cfg.pushBatchSize, 20);
  const ackConsumer = String(cfg.pushAckConsumer || "openclaw");
  const ackWaitMs = Math.max(1000, coerceInt(cfg.pushAckWaitMs, 15000));
  const pushOnce = cfg.pushOnce !== false;
  let dispatched = 0;
  let acked = 0;
  let retried = 0;
  let skipped = 0;

  const sentRows = store.listSentPushOutbox({
    batchSize: pushBatchSize,
  });
  for (const row of sentRows) {
    if (store.isEventAckedByConsumer({ consumerId: ackConsumer, eventId: row.event_id })) {
      store.markPushAcked({
        outboxId: row.outbox_id,
        eventId: row.event_id,
      });
      acked += 1;
      continue;
    }

    if (pushOnce) {
      store.markPushAcked({
        outboxId: row.outbox_id,
        eventId: row.event_id,
      });
      skipped += 1;
      logger.debug(
        `push skipped (push_once=true) event_id=${row.event_id} attempt=${row.attempt} consumer=${ackConsumer}`
      );
      continue;
    }

    const deadline = coerceInt(row.next_retry_at, 0);
    if (deadline > tsNow) continue;

    const nextAttempt = coerceInt(row.attempt, 0) + 1;
    const delayMs = calculateBackoffMs(nextAttempt, cfg.pushRetryMaxDelayMs);
    const nextRetryAt = nowFn() + delayMs;
    store.markPushRetry({
      outboxId: row.outbox_id,
      attempt: nextAttempt,
      nextRetryAt,
      lastError: `ack timeout consumer=${ackConsumer} wait_ms=${Math.max(0, tsNow - coerceInt(row.updated_at, tsNow))}`,
    });
    retried += 1;
    logger.warn(
      `push ack timeout event_id=${row.event_id} attempt=${nextAttempt} retry_in_ms=${delayMs} consumer=${ackConsumer}`
    );
  }

  const rows = store.listPendingPushOutbox({
    now: nowFn(),
    batchSize: pushBatchSize,
  });
  for (const row of rows) {
    if (store.isEventAckedByConsumer({ consumerId: ackConsumer, eventId: row.event_id })) {
      store.markPushAcked({
        outboxId: row.outbox_id,
        eventId: row.event_id,
      });
      acked += 1;
      continue;
    }

    const text = formatSystemEventText(row);
    const resolvedSession = resolvePushSession({
      sessions: listed.sessions,
      targetSessionId: row.target_session_id,
      targetSessionKey: row.target_session_key,
      fallbackSessionId: cfg.openclawSessionId,
      fallbackSessionKey: MAIN_SESSION_KEY,
      nowMs: tsNow,
      maxAgeMs: 10 * 60 * 1000,
    });
    const result = await pushFn(cfg, text, { resolvedSession });
    if (result.ok) {
      store.markPushSent({
        outboxId: row.outbox_id,
        eventId: row.event_id,
        ackDeadlineAt: nowFn() + ackWaitMs,
      });
      dispatched += 1;
      logger.info(
        `push dispatched event_id=${row.event_id} consumer=${ackConsumer} ack_wait_ms=${ackWaitMs} target_session=${resolvedSession.sessionKey || resolvedSession.sessionId || "-"} route_source=${resolvedSession.source || "fallback"}`
      );
      continue;
    }

    const nextAttempt = coerceInt(row.attempt, 0) + 1;
    const delayMs = calculateBackoffMs(nextAttempt, cfg.pushRetryMaxDelayMs);
    const nextRetryAt = nowFn() + delayMs;
    store.markPushRetry({
      outboxId: row.outbox_id,
      attempt: nextAttempt,
      nextRetryAt,
      lastError: result.detail,
    });
    retried += 1;
    logger.warn(
      `push failed event_id=${row.event_id} attempt=${nextAttempt} retry_in_ms=${delayMs} detail=${scrubSessionRefs(result.detail).slice(0, 200)}`
    );
  }

  return { dispatched, acked, retried, skipped };
}

module.exports = {
  flushPushOutbox,
  calculateBackoffMs,
};
