const fs = require("node:fs");
const { resolveDbPath, DEFAULT_PID_PATH } = require("../config/paths");
const { EventStore, nowMs } = require("../store/event-store");
const { parseDeliveryHintsFromSessionKey } = require("../config/openclaw-routing");

/**
 * 在外部摘要通知末尾追加路由回执块，使接收端（如飞书 session AI）知道
 * 将人类决策通过 chat.send 路由回正确的 peer session。
 *
 * 只有当 sourceSessionKey 是 a2hmarket peer session（以 agent:main:a2hmarket: 开头）时追加，
 * 避免 main session 自引用。
 */
function appendReplyRoute(summaryText, sourceSessionKey, eventId) {
  const PEER_PREFIX = "agent:main:a2hmarket:";
  if (!sourceSessionKey || !sourceSessionKey.startsWith(PEER_PREFIX)) {
    return summaryText;
  }
  const body = String(summaryText || "").trimEnd();
  const routeBlock = [
    "",
    "---",
    "【a2hmarket 回复路由】",
    `source_session_key: ${sourceSessionKey}`,
    `event_id: ${eventId || "-"}`,
    "收到人类决策后，请将决策转发回 peer session（选一种方式）：",
    `  方式一（推荐）：openclaw acp --session "${sourceSessionKey}"`,
    `    然后在交互中输入决策内容`,
    `  方式二（单次）：向 peer session 发送 chat.send 消息`,
  ].join("\n");
  return body + routeBlock;
}

function coerceInt(value, fallback, min, max) {
  const n = Number.parseInt(String(value), 10);
  let out = Number.isFinite(n) ? n : fallback;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function eventBindingTs(event) {
  const msgTs = coerceInt(event && event.msg_ts, 0);
  if (msgTs > 0) return msgTs;
  return coerceInt(event && event.created_at, 0);
}

async function pull({
  dbPath,
  consumerId,
  cursor,
  maxEvents,
  waitMs,
  pollIntervalMs,
  sourceSessionId,
  sourceSessionKey,
}) {
  const store = new EventStore(resolveDbPath(dbPath)).open();
  try {
    const normalizedConsumer = String(consumerId || "default");
    const normalizedCursor = coerceInt(cursor, 0, 0);
    const normalizedLimit = coerceInt(maxEvents, 20, 1, 200);
    const normalizedWait = coerceInt(waitMs, 0, 0, 300000);
    const normalizedPollInterval = coerceInt(pollIntervalMs, 300, 50, 10000);
    const normalizedSourceSessionId = String(sourceSessionId || "").trim();
    const normalizedSourceSessionKey = String(sourceSessionKey || "").trim();
    if (
      normalizedConsumer === "openclaw" &&
      !normalizedSourceSessionKey
    ) {
      throw new Error("source_session_key is required for openclaw inbox pull");
    }
    const deadline = nowMs() + normalizedWait;

    while (true) {
      const events = store.pullEvents({
        consumerId: normalizedConsumer,
        cursor: normalizedCursor,
        limit: normalizedLimit,
      });

      if (events.length > 0) {
        let routeBoundCount = 0;
        if (
          normalizedConsumer === "openclaw" &&
          (normalizedSourceSessionId || normalizedSourceSessionKey)
        ) {
          const peerBindings = new Map();
          for (const event of events) {
            const peerId = String(event.peer_id || "").trim();
            if (!peerId) continue;
            const bindingTs = eventBindingTs(event);
            const current = peerBindings.get(peerId) || 0;
            if (bindingTs > current) {
              peerBindings.set(peerId, bindingTs);
            }
          }
          for (const [peerId, bindingTs] of peerBindings.entries()) {
            const bound = store.bindPeerSession({
              peerId,
              sessionId: normalizedSourceSessionId,
              sessionKey: normalizedSourceSessionKey,
              source: "inbox-pull",
              updatedAt: bindingTs,
            });
            if (bound.updated === true) {
              routeBoundCount += 1;
            }
          }
        }
        return {
          ok: true,
          consumer_id: normalizedConsumer,
          cursor: events[events.length - 1].seq,
          events,
          route_bound_count: routeBoundCount,
        };
      }

      if (nowMs() >= deadline) {
        return {
          ok: true,
          consumer_id: normalizedConsumer,
          cursor: normalizedCursor,
          events: [],
          route_bound_count: 0,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, normalizedPollInterval));
    }
  } finally {
    store.close();
  }
}

async function ack({
  dbPath,
  consumerId,
  eventId,
  sourceSessionId,
  sourceSessionKey,
  notifyExternal,
  summaryText,
  mediaUrl,
  channel,
  to,
  accountId,
  threadId,
}) {
  const store = new EventStore(resolveDbPath(dbPath)).open();
  try {
    const normalizedConsumer = String(consumerId || "default");
    const normalizedEventId = String(eventId || "").trim();
    const normalizedSourceSessionId = String(sourceSessionId || "").trim();
    const normalizedSourceSessionKey = String(sourceSessionKey || "").trim();
    const normalizedSummaryText = String(summaryText || "").trim();
    const normalizedChannel = String(channel || "").trim();
    const normalizedTo = String(to || "").trim();
    const normalizedAccountId = String(accountId || "").trim();
    const normalizedThreadId = String(threadId || "").trim();

    // 若调用方未显式指定 --media-url，自动从事件 payload.image 兜底填充（收款二维码）
    let normalizedMediaUrl = String(mediaUrl || "").trim();
    if (!normalizedMediaUrl && Boolean(notifyExternal)) {
      const eventForImage = store.getEvent(normalizedEventId);
      const innerPayload =
        eventForImage &&
        eventForImage.payload &&
        (eventForImage.payload.payload || eventForImage.payload);
      const autoImage = String(innerPayload && innerPayload.image || "").trim();
      if (autoImage) {
        normalizedMediaUrl = autoImage;
      }
    }

    // Allow notify when summary text or media_url is present
    const doNotify = Boolean(notifyExternal) && (normalizedSummaryText.length > 0 || normalizedMediaUrl.length > 0);

    if (!normalizedEventId) {
      throw new Error("event_id is required");
    }
    if (
      normalizedConsumer === "openclaw" &&
      !normalizedSourceSessionKey
    ) {
      throw new Error("source_session_key is required for openclaw inbox ack");
    }

    const ackResult = store.ackEvent({
      consumerId: normalizedConsumer,
      eventId: normalizedEventId,
      routeBinding:
        normalizedConsumer === "openclaw" &&
        (normalizedSourceSessionId || normalizedSourceSessionKey)
          ? {
              sessionId: normalizedSourceSessionId,
              sessionKey: normalizedSourceSessionKey,
              source: "inbox-ack",
            }
          : null,
    });
    const ackedAt = ackResult.ackedAt;
    let routeBindReason = "";
    if (ackResult.routeBound !== true) {
      if (ackResult.inserted !== true) {
        routeBindReason = "already_acked";
      } else if (!normalizedSourceSessionId && !normalizedSourceSessionKey) {
        routeBindReason = "missing_session_ref";
      } else if (normalizedConsumer !== "openclaw") {
        routeBindReason = "non_authoritative_consumer";
      } else {
        routeBindReason = ackResult.routeBindReason || "";
      }
    }

    // Enqueue external summary notification on first ACK only.
    let summaryEnqueued = false;
    let summarySkipReason = "";
    if (doNotify && ackResult.inserted === true) {
      // Resolve delivery target: explicit params > parse from source_session_key.
      let resolvedChannel = normalizedChannel;
      let resolvedTo = normalizedTo;
      if (!resolvedChannel || !resolvedTo) {
        const hints = parseDeliveryHintsFromSessionKey(normalizedSourceSessionKey);
        if (hints) {
          resolvedChannel = resolvedChannel || hints.channel;
          resolvedTo = resolvedTo || hints.to;
        }
      }
      if (resolvedChannel && resolvedTo) {
        // 自动在消息文末追加路由回执块，使飞书 session AI 知道将人类决策路由回哪个 peer session
        const messageTextWithRoute = appendReplyRoute(
          normalizedSummaryText,
          normalizedSourceSessionKey,
          normalizedEventId
        );
        const enqueueResult = store.enqueueMediaOutbox({
          eventId: normalizedEventId,
          sessionKey: normalizedSourceSessionKey || null,
          channel: resolvedChannel,
          to: resolvedTo,
          accountId: normalizedAccountId || null,
          threadId: normalizedThreadId || null,
          messageText: messageTextWithRoute,
          mediaUrl: normalizedMediaUrl || null,
        });
        summaryEnqueued = enqueueResult.inserted === true;
        if (!summaryEnqueued) {
          summarySkipReason = enqueueResult.reason || "unknown";
        }
      } else {
        summarySkipReason = "no_delivery_target";
      }
    } else if (doNotify && ackResult.inserted !== true) {
      summarySkipReason = "already_acked";
    } else if (Boolean(notifyExternal) && !normalizedSummaryText && !normalizedMediaUrl) {
      summarySkipReason = "no_notify_content";
    }

    return {
      ok: true,
      consumer_id: normalizedConsumer,
      event_id: normalizedEventId,
      acked_at: ackedAt,
      route_bound: ackResult.routeBound === true,
      route_bind_reason: routeBindReason,
      summary_enqueued: summaryEnqueued,
      summary_skip_reason: summarySkipReason || undefined,
      media_url_auto_filled: !String(mediaUrl || "").trim() && Boolean(normalizedMediaUrl),
    };
  } finally {
    store.close();
  }
}

async function peek({ dbPath, consumerId }) {
  const store = new EventStore(resolveDbPath(dbPath)).open();
  try {
    const normalizedConsumer = String(consumerId || "default");
    const result = store.peekUnread({ consumerId: normalizedConsumer });
    return {
      ok: true,
      consumer_id: normalizedConsumer,
      unread: result.unread,
      pending_push: result.pending_push,
    };
  } finally {
    store.close();
  }
}

async function get({ dbPath, eventId }) {
  const store = new EventStore(resolveDbPath(dbPath)).open();
  try {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) {
      throw new Error("event_id is required");
    }
    const event = store.getEvent(normalizedEventId);
    if (!event) {
      return { ok: false, error: "event_not_found", event_id: normalizedEventId };
    }
    return { ok: true, event };
  } finally {
    store.close();
  }
}

function isListenerAlive(pidPath) {
  const resolvedPidPath = String(pidPath || process.env.A2HMARKET_LISTENER_PID_FILE || DEFAULT_PID_PATH).trim();
  try {
    if (!fs.existsSync(resolvedPidPath)) return false;
    const pid = Number.parseInt(fs.readFileSync(resolvedPidPath, "utf8").trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function check({ dbPath, consumerId, pidPath }) {
  const store = new EventStore(resolveDbPath(dbPath)).open();
  try {
    const normalizedConsumer = String(consumerId || "default");
    const status = store.checkStatus({ consumerId: normalizedConsumer });
    const tsNow = nowMs();
    const oldestAgeMs =
      status.oldest_unread_at != null ? Math.max(0, tsNow - status.oldest_unread_at) : null;
    const alive = isListenerAlive(pidPath);

    const parts = [];
    if (status.unread > 0) {
      const ageStr = oldestAgeMs != null ? ` (oldest ${Math.round(oldestAgeMs / 1000)}s ago)` : "";
      parts.push(`${status.unread} unread${ageStr}`);
    } else {
      parts.push("0 unread");
    }
    if (status.pending_push > 0) parts.push(`${status.pending_push} pending push`);
    parts.push(alive ? "listener running" : "listener not running");

    return {
      ok: true,
      has_pending: status.unread > 0,
      unread_count: status.unread,
      pending_push_count: status.pending_push,
      oldest_unread_age_ms: oldestAgeMs,
      listener_alive: alive,
      summary: parts.join(", "),
    };
  } finally {
    store.close();
  }
}

module.exports = {
  pull,
  ack,
  peek,
  get,
  check,
};
