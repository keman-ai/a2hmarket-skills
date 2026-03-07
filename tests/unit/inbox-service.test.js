const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { EventStore } = require("../../runtime/js/src/store/event-store");
const { pull, ack } = require("../../runtime/js/src/inbox/inbox-service");

function createTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "a2hmarket-inbox-service-"));
  return {
    dir,
    dbPath: path.join(dir, "listener.db"),
  };
}

test("inbox ack binds route only on first ack", async () => {
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
  } finally {
    store.close();
  }

  try {
    const first = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-1",
      sourceSessionKey: "agent:main:main",
    });
    const second = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-1",
      sourceSessionKey: "agent:main:feishu:direct:ou_old",
    });
    const verifyStore = new EventStore(temp.dbPath).open();

    try {
      const route = verifyStore.findA2aReplyRoute({
        peerId: "peer-1",
        traceId: null,
      });

      assert.equal(first.route_bound, true);
      assert.equal(second.route_bound, false);
      assert.equal(second.route_bind_reason, "already_acked");
      assert.equal(second.acked_at, first.acked_at);
      assert.deepEqual(route, {
        sessionId: null,
        sessionKey: "agent:main:main",
        matchedBy: "peer-binding",
      });
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack from non-authoritative consumer does not bind route", async () => {
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
  } finally {
    store.close();
  }

  try {
    const result = await ack({
      dbPath: temp.dbPath,
      consumerId: "debugger",
      eventId: "event-1",
      sourceSessionKey: "agent:main:feishu:direct:ou_old",
    });
    const verifyStore = new EventStore(temp.dbPath).open();

    try {
      const route = verifyStore.findA2aReplyRoute({
        peerId: "peer-1",
        traceId: null,
      });

      assert.equal(result.route_bound, false);
      assert.equal(result.route_bind_reason, "non_authoritative_consumer");
      assert.equal(route, null);
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox pull from openclaw binds returned peers to current session", async () => {
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
  } finally {
    store.close();
  }

  try {
    const result = await pull({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      cursor: 0,
      maxEvents: 20,
      waitMs: 0,
      pollIntervalMs: 50,
      sourceSessionKey: "agent:main:main",
    });
    const verifyStore = new EventStore(temp.dbPath).open();

    try {
      const route = verifyStore.findA2aReplyRoute({
        peerId: "peer-1",
        traceId: null,
      });

      assert.equal(result.events.length, 1);
      assert.equal(result.route_bound_count, 1);
      assert.deepEqual(route, {
        sessionId: null,
        sessionKey: "agent:main:main",
        matchedBy: "peer-binding",
      });
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox pull from non-authoritative consumer does not bind returned peers", async () => {
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
  } finally {
    store.close();
  }

  try {
    const result = await pull({
      dbPath: temp.dbPath,
      consumerId: "debugger",
      cursor: 0,
      maxEvents: 20,
      waitMs: 0,
      pollIntervalMs: 50,
      sourceSessionKey: "agent:main:feishu:direct:ou_old",
    });
    const verifyStore = new EventStore(temp.dbPath).open();

    try {
      const route = verifyStore.findA2aReplyRoute({
        peerId: "peer-1",
        traceId: null,
      });

      assert.equal(result.events.length, 1);
      assert.equal(result.route_bound_count, 0);
      assert.equal(route, null);
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox pull for openclaw requires source session", async () => {
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
  } finally {
    store.close();
  }

  try {
    await assert.rejects(
      () =>
        pull({
          dbPath: temp.dbPath,
          consumerId: "openclaw",
          cursor: 0,
          maxEvents: 20,
          waitMs: 0,
          pollIntervalMs: 50,
        }),
      /source_session/i
    );
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack for openclaw requires source session key", async () => {
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
  } finally {
    store.close();
  }

  try {
    await assert.rejects(
      () =>
        ack({
          dbPath: temp.dbPath,
          consumerId: "openclaw",
          eventId: "event-1",
          sourceSessionId: "session-only",
        }),
      /source_session_key/i
    );
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox pull does not let old event override newer peer binding", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-1",
      peer_id: "peer-1",
      message_id: "incoming-1",
      msg_ts: 1000,
      hash: "hash-1",
      unread_count: 1,
      preview: "hello",
      payload: { text: "hello" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-1",
      push_enabled: false,
      created_at: 1000,
      updated_at: 1000,
    });
    store.bindPeerSession({
      peerId: "peer-1",
      sessionKey: "agent:main:feishu:direct:ou_new",
      source: "inbox-ack",
      updatedAt: 2000,
    });
  } finally {
    store.close();
  }

  try {
    const result = await pull({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      cursor: 0,
      maxEvents: 20,
      waitMs: 0,
      pollIntervalMs: 50,
      sourceSessionKey: "agent:main:main",
    });
    const verifyStore = new EventStore(temp.dbPath).open();

    try {
      const route = verifyStore.findA2aReplyRoute({
        peerId: "peer-1",
        traceId: null,
      });

      assert.equal(result.route_bound_count, 0);
      assert.deepEqual(route, {
        sessionId: null,
        sessionKey: "agent:main:feishu:direct:ou_new",
        matchedBy: "peer-binding",
      });
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack does not let old event override newer peer binding", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-1",
      peer_id: "peer-1",
      message_id: "incoming-1",
      msg_ts: 1000,
      hash: "hash-1",
      unread_count: 1,
      preview: "hello",
      payload: { text: "hello" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-1",
      push_enabled: false,
      created_at: 5000,
      updated_at: 5000,
    });
    store.bindPeerSession({
      peerId: "peer-1",
      sessionKey: "agent:main:feishu:direct:ou_new",
      source: "inbox-pull",
      updatedAt: 2000,
    });
  } finally {
    store.close();
  }

  try {
    const result = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-1",
      sourceSessionKey: "agent:main:main",
    });
    const verifyStore = new EventStore(temp.dbPath).open();

    try {
      const route = verifyStore.findA2aReplyRoute({
        peerId: "peer-1",
        traceId: null,
      });

      assert.equal(result.route_bound, false);
      assert.equal(result.route_bind_reason, "stale_binding");
      assert.deepEqual(route, {
        sessionId: null,
        sessionKey: "agent:main:feishu:direct:ou_new",
        matchedBy: "peer-binding",
      });
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
