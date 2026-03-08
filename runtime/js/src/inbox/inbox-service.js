const { resolveDbPath } = require("../config/paths");
const { EventStore, nowMs } = require("../store/event-store");
const { parseDeliveryHintsFromSessionKey } = require("../config/openclaw-routing");

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
    const doNotify = Boolean(notifyExternal) && normalizedSummaryText.length > 0;

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
        const enqueueResult = store.enqueueSummaryOutbox({
          eventId: normalizedEventId,
          sessionKey: normalizedSourceSessionKey || null,
          channel: resolvedChannel,
          to: resolvedTo,
          accountId: normalizedAccountId || null,
          threadId: normalizedThreadId || null,
          summaryText: normalizedSummaryText,
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
    } else if (Boolean(notifyExternal) && !normalizedSummaryText) {
      summarySkipReason = "no_summary_text";
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

module.exports = {
  pull,
  ack,
  peek,
  get,
};
