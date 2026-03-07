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
