const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { EventStore } = require("../../runtime/js/src/store/event-store");

function createTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a2hmarket-event-store-"));
  return {
    dir,
    dbPath: path.join(dir, "listener.db"),
  };
}

test("findA2aReplyRoute matches exact trace before peer fallback", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.enqueueA2aOutbox({
      message_id: "msg-1",
      trace_id: "trace-1",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-1", trace_id: "trace-1" },
      source_session_id: "feishu-session",
      source_session_key: "agent:main:feishu:direct:ou_123",
    });
    store.markA2aOutboxSent({ id: 1 });
    store.enqueueA2aOutbox({
      message_id: "msg-2",
      trace_id: "trace-2",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-2", trace_id: "trace-2" },
      source_session_id: "web-session",
      source_session_key: "agent:main:webchat:direct:user_1",
    });
    store.markA2aOutboxSent({ id: 2 });

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: "trace-1",
    });

    assert.deepEqual(route, {
      sessionId: "feishu-session",
      sessionKey: "agent:main:feishu:direct:ou_123",
      matchedBy: "trace",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("findA2aReplyRoute falls back to latest peer route when trace is unknown", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.enqueueA2aOutbox({
      message_id: "msg-1",
      trace_id: "trace-1",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-1", trace_id: "trace-1" },
      source_session_id: "old-session",
      source_session_key: "agent:main:webchat:direct:user_old",
    });
    store.markA2aOutboxSent({ id: 1 });
    store.enqueueA2aOutbox({
      message_id: "msg-2",
      trace_id: "trace-2",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-2", trace_id: "trace-2" },
      source_session_id: "new-session",
      source_session_key: "agent:main:feishu:direct:ou_new",
    });
    store.markA2aOutboxSent({ id: 2 });

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: "unknown-trace",
    });

    assert.deepEqual(route, {
      sessionId: "new-session",
      sessionKey: "agent:main:feishu:direct:ou_new",
      matchedBy: "peer-binding",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("findA2aReplyRoute peer fallback ignores retry rows that were not sent", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    const sent = store.enqueueA2aOutbox({
      message_id: "msg-sent",
      trace_id: "trace-sent",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-sent", trace_id: "trace-sent" },
      source_session_id: "sent-session",
      source_session_key: "agent:main:feishu:direct:ou_sent",
    });
    store.markA2aOutboxSent({ id: 1 });

    store.enqueueA2aOutbox({
      message_id: "msg-retry",
      trace_id: "trace-retry",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-retry", trace_id: "trace-retry" },
      source_session_id: "retry-session",
      source_session_key: "agent:main:webchat:direct:user_retry",
    });
    store.markA2aOutboxRetry({
      id: 2,
      attempt: 1,
      nextRetryAt: Date.now() + 1000,
      lastError: "network error",
    });

    assert.equal(sent.created, true);

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: "unknown-trace",
    });

    assert.deepEqual(route, {
      sessionId: "sent-session",
      sessionKey: "agent:main:feishu:direct:ou_sent",
      matchedBy: "peer-binding",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("findA2aReplyRoute trace match ignores retry rows that were not sent", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.enqueueA2aOutbox({
      message_id: "msg-sent",
      trace_id: "trace-1",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-sent", trace_id: "trace-1" },
      source_session_id: "sent-session",
      source_session_key: "agent:main:feishu:direct:ou_sent",
    });
    store.markA2aOutboxSent({ id: 1 });

    store.enqueueA2aOutbox({
      message_id: "msg-retry",
      trace_id: "trace-1",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-retry", trace_id: "trace-1" },
      source_session_id: "retry-session",
      source_session_key: "agent:main:webchat:direct:user_retry",
    });
    store.markA2aOutboxRetry({
      id: 2,
      attempt: 1,
      nextRetryAt: Date.now() + 1000,
      lastError: "network error",
    });

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: "trace-1",
    });

    assert.deepEqual(route, {
      sessionId: "sent-session",
      sessionKey: "agent:main:feishu:direct:ou_sent",
      matchedBy: "trace",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("findA2aReplyRoute prefers explicit peer binding over old peer-latest route", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.enqueueA2aOutbox({
      message_id: "msg-old",
      trace_id: "trace-old",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-old", trace_id: "trace-old" },
      source_session_id: "feishu-session",
      source_session_key: "agent:main:feishu:direct:ou_old",
    });
    store.markA2aOutboxSent({ id: 1 });

    store.bindPeerSession({
      peerId: "peer-1",
      sessionId: "main-session",
      sessionKey: "agent:main:main",
      source: "manual-claim",
    });

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: "unknown-trace",
    });

    assert.deepEqual(route, {
      sessionId: "main-session",
      sessionKey: "agent:main:main",
      matchedBy: "peer-binding",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("bindPeerSessionForEvent binds the event peer to current session", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-1",
      peer_id: "peer-1",
      message_id: "incoming-1",
      msg_ts: Date.now(),
      hash: "hash-1",
      unread_count: 1,
      preview: "hello",
      payload: { text: "hello" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-1",
      push_enabled: false,
    });

    const bound = store.bindPeerSessionForEvent({
      eventId: "event-1",
      sessionId: "main-session",
      sessionKey: "agent:main:main",
      source: "ack",
    });
    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: null,
    });

    assert.deepEqual(bound, {
      updated: true,
      peerId: "peer-1",
    });
    assert.deepEqual(route, {
      sessionId: "main-session",
      sessionKey: "agent:main:main",
      matchedBy: "peer-binding",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("late outbox sent does not override newer peer binding", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.enqueueA2aOutbox({
      message_id: "msg-old",
      trace_id: "trace-old",
      target_agent_id: "peer-1",
      message_type: "chat.request",
      qos: 1,
      envelope: { message_id: "msg-old", trace_id: "trace-old" },
      source_session_id: "feishu-session",
      source_session_key: "agent:main:feishu:direct:ou_old",
    });
    store.db.prepare(`
      UPDATE a2a_outbox
      SET created_at = 1000, updated_at = 1000
      WHERE id = 1
    `).run();

    store.bindPeerSession({
      peerId: "peer-1",
      sessionId: "main-session",
      sessionKey: "agent:main:main",
      source: "inbox-ack",
      updatedAt: 2000,
    });
    store.markA2aOutboxSent({ id: 1 });

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: "unknown-trace",
    });

    assert.deepEqual(route, {
      sessionId: "main-session",
      sessionKey: "agent:main:main",
      matchedBy: "peer-binding",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("bindPeerSession keeps existing non-empty session fields on partial update", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.bindPeerSession({
      peerId: "peer-1",
      sessionId: "main-session",
      sessionKey: "agent:main:main",
      source: "inbox-ack",
      updatedAt: 1000,
    });
    store.bindPeerSession({
      peerId: "peer-1",
      sessionId: "main-session-v2",
      source: "manual-claim",
      updatedAt: 2000,
    });

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: null,
    });

    assert.deepEqual(route, {
      sessionId: "main-session-v2",
      sessionKey: "agent:main:main",
      matchedBy: "peer-binding",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("bindPeerSession clears stale session id when binding with key only", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.bindPeerSession({
      peerId: "peer-1",
      sessionId: "old-session-id",
      sessionKey: "agent:main:feishu:direct:ou_old",
      source: "inbox-ack",
      updatedAt: 1000,
    });
    store.bindPeerSession({
      peerId: "peer-1",
      sessionKey: "agent:main:main",
      source: "inbox-pull",
      updatedAt: 2000,
    });

    const route = store.findA2aReplyRoute({
      peerId: "peer-1",
      traceId: null,
    });

    assert.deepEqual(route, {
      sessionId: null,
      sessionKey: "agent:main:main",
      matchedBy: "peer-binding",
    });
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("pending push rows expose stored target session fields", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-1",
      peer_id: "peer-1",
      message_id: "incoming-1",
      msg_ts: Date.now(),
      hash: "hash-1",
      unread_count: 1,
      preview: "hello",
      payload: { text: "hello" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-1",
      push_enabled: true,
      push_target: "openclaw",
      target_session_id: "feishu-session",
      target_session_key: "agent:main:feishu:direct:ou_123",
    });

    const [row] = store.listPendingPushOutbox({
      now: Date.now() + 1,
      batchSize: 10,
    });

    assert.equal(row.target_session_id, "feishu-session");
    assert.equal(row.target_session_key, "agent:main:feishu:direct:ou_123");
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("getEvent returns full event with parsed payload", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    const fullPayload = {
      protocol: "a2hmarket-a2a",
      message_id: "msg-get-1",
      sender_id: "peer-get",
      payload: {
        text: "## 订单确认\n\n价格：¥300\n\n[![收款码](https://qr.example.com/pay.png)](https://qr.example.com/pay.png)",
      },
    };
    store.insertIncomingEvent({
      event_id: "evt-get-1",
      peer_id: "peer-get",
      message_id: "msg-get-1",
      msg_ts: 1000,
      hash: "h1",
      unread_count: 1,
      preview: "订单确认 价格：¥300 ...",
      payload: fullPayload,
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "msg-get-1",
      push_enabled: false,
    });

    const event = store.getEvent("evt-get-1");
    assert.ok(event);
    assert.equal(event.event_id, "evt-get-1");
    assert.equal(event.peer_id, "peer-get");
    assert.equal(event.source, "MQTT");
    assert.deepEqual(event.payload, fullPayload);
    assert.ok(event.payload.payload.text.includes("[![收款码]"));

    const missing = store.getEvent("nonexistent-id");
    assert.equal(missing, null);
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("enqueueSummaryOutbox prevents duplicate entries for same event_id", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    const first = store.enqueueSummaryOutbox({
      eventId: "evt-summary-1",
      sessionKey: "agent:main:feishu:direct:ou_abc",
      channel: "feishu",
      to: "ou_abc",
      accountId: null,
      threadId: null,
      summaryText: "第一次摘要",
    });

    assert.equal(first.inserted, true);

    const second = store.enqueueSummaryOutbox({
      eventId: "evt-summary-1",
      sessionKey: "agent:main:feishu:direct:ou_abc",
      channel: "feishu",
      to: "ou_abc",
      accountId: null,
      threadId: null,
      summaryText: "重复入队",
    });

    assert.equal(second.inserted, false);
    assert.equal(second.reason, "duplicate");
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("listPendingSummaryOutbox returns only pending and retry rows ready to dispatch", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    const now = Date.now();

    store.enqueueSummaryOutbox({
      eventId: "evt-pending",
      channel: "feishu",
      to: "ou_1",
      summaryText: "摘要1",
    });
    store.enqueueSummaryOutbox({
      eventId: "evt-future",
      channel: "feishu",
      to: "ou_2",
      summaryText: "摘要2",
    });
    // Mark evt-future as retry with future deadline
    const rows = store.listPendingSummaryOutbox({ now: now + 1, batchSize: 10 });
    const futureRow = rows.find((r) => r.event_id === "evt-future");
    if (futureRow) {
      store.markSummaryRetry({
        outboxId: futureRow.id,
        attempt: 1,
        nextRetryAt: now + 999999,
        lastError: "temp error",
      });
    }

    const pending = store.listPendingSummaryOutbox({ now: now + 1, batchSize: 10 });
    const ids = pending.map((r) => r.event_id);
    assert.ok(ids.includes("evt-pending"));
    assert.ok(!ids.includes("evt-future"));
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("markSummarySent transitions status to SENT", () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.enqueueSummaryOutbox({
      eventId: "evt-to-send",
      channel: "feishu",
      to: "ou_send",
      summaryText: "摘要",
    });

    const [row] = store.listPendingSummaryOutbox({ now: Date.now() + 1, batchSize: 5 });
    assert.ok(row);
    store.markSummarySent({ outboxId: row.id });

    const remaining = store.listPendingSummaryOutbox({ now: Date.now() + 1, batchSize: 5 });
    assert.equal(remaining.length, 0);
  } finally {
    store.close();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox get via service returns event or not_found", async () => {
  const { get } = require("../../runtime/js/src/inbox/inbox-service");
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "evt-svc-1",
      peer_id: "peer-svc",
      message_id: "msg-svc-1",
      msg_ts: 2000,
      hash: "h2",
      unread_count: 1,
      preview: "test",
      payload: { payload: { text: "full message body" } },
      state: "NEW",
      source: "MQTT",
      push_enabled: false,
    });
    store.close();

    const found = await get({ dbPath: temp.dbPath, eventId: "evt-svc-1" });
    assert.equal(found.ok, true);
    assert.equal(found.event.event_id, "evt-svc-1");
    assert.equal(found.event.payload.payload.text, "full message body");

    const notFound = await get({ dbPath: temp.dbPath, eventId: "no-such" });
    assert.equal(notFound.ok, false);
    assert.equal(notFound.error, "event_not_found");
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
