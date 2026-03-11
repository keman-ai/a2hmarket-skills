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

test("inbox ack with notify-external enqueues summary on first ack only", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-notify-1",
      peer_id: "peer-notify",
      message_id: "incoming-notify-1",
      msg_ts: Date.now(),
      hash: "hash-notify-1",
      unread_count: 1,
      preview: "important event",
      payload: { text: "important event body" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-notify-1",
      push_enabled: false,
    });
  } finally {
    store.close();
  }

  try {
    // First ACK with notify-external and summary-text should enqueue
    const first = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-notify-1",
      sourceSessionKey: "agent:main:feishu:direct:ou_abc123",
      notifyExternal: true,
      summaryText: "订单已确认，请人工审核",
    });

    assert.equal(first.ok, true);
    assert.equal(first.summary_enqueued, true);
    assert.equal(first.summary_skip_reason, undefined);

    // Second ACK should NOT enqueue again (idempotent)
    const second = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-notify-1",
      sourceSessionKey: "agent:main:feishu:direct:ou_abc123",
      notifyExternal: true,
      summaryText: "重复入队",
    });

    assert.equal(second.ok, true);
    assert.equal(second.summary_enqueued, false);
    assert.equal(second.summary_skip_reason, "already_acked");
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack without notify-external does not enqueue summary", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-no-notify",
      peer_id: "peer-no-notify",
      message_id: "incoming-no-notify",
      msg_ts: Date.now(),
      hash: "hash-no-notify",
      unread_count: 1,
      preview: "regular event",
      payload: { text: "regular event body" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-no-notify",
      push_enabled: false,
    });
  } finally {
    store.close();
  }

  try {
    const result = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-no-notify",
      sourceSessionKey: "agent:main:feishu:direct:ou_abc",
      notifyExternal: false,
      summaryText: "这条消息不应该被入队",
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary_enqueued, false);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack with notify-external but no summary-text does not enqueue", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-empty-summary",
      peer_id: "peer-empty",
      message_id: "incoming-empty",
      msg_ts: Date.now(),
      hash: "hash-empty",
      unread_count: 1,
      preview: "event",
      payload: { text: "body" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-empty",
      push_enabled: false,
    });
  } finally {
    store.close();
  }

  try {
    const result = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-empty-summary",
      sourceSessionKey: "agent:main:feishu:direct:ou_abc",
      notifyExternal: true,
      summaryText: "",
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary_enqueued, false);
    assert.equal(result.summary_skip_reason, "no_summary_text");
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack with notify-external uses explicit channel/to over session key parsing", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-explicit-route",
      peer_id: "peer-route",
      message_id: "incoming-route",
      msg_ts: Date.now(),
      hash: "hash-route",
      unread_count: 1,
      preview: "event",
      payload: { text: "body" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-route",
      push_enabled: false,
    });
  } finally {
    store.close();
  }

  try {
    const result = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-explicit-route",
      sourceSessionKey: "agent:main:feishu:direct:ou_abc",
      notifyExternal: true,
      summaryText: "摘要",
      channel: "feishu",
      to: "ou_override_user",
      accountId: "acc123",
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary_enqueued, true);

    // Verify the queued record used explicit channel/to
    const verifyStore = new EventStore(temp.dbPath).open();
    try {
      const rows = verifyStore.listPendingMediaOutbox({ now: Date.now() + 1, batchSize: 5 });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].channel, "feishu");
      assert.equal(rows[0].to_target, "ou_override_user");
      assert.equal(rows[0].account_id, "acc123");
      assert.equal(rows[0].message_text, "摘要");
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack with notify-external and media-url enqueues summary with media_url", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-media-1",
      peer_id: "peer-media",
      message_id: "incoming-media-1",
      msg_ts: Date.now(),
      hash: "hash-media-1",
      unread_count: 1,
      preview: "收款码",
      payload: { text: "[![收款二维码](https://qr.example.com/pay.png)](https://pay.example.com)" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-media-1",
      push_enabled: false,
    });
  } finally {
    store.close();
  }

  try {
    const result = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-media-1",
      sourceSessionKey: "agent:main:feishu:direct:ou_media",
      notifyExternal: true,
      summaryText: "订单确认，请扫码支付",
      mediaUrl: "https://qr.example.com/pay.png",
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary_enqueued, true);

    const verifyStore = new EventStore(temp.dbPath).open();
    try {
      const rows = verifyStore.listPendingMediaOutbox({ now: Date.now() + 1, batchSize: 5 });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].channel, "feishu");
      assert.equal(rows[0].to_target, "ou_media");
      assert.equal(rows[0].message_text, "订单确认，请扫码支付");
      assert.equal(rows[0].media_url, "https://qr.example.com/pay.png");
    } finally {
      verifyStore.close();
    }
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("inbox ack with only media-url (no summary-text) still enqueues when notify-external", async () => {
  const temp = createTempDbPath();
  const store = new EventStore(temp.dbPath).open();

  try {
    store.insertIncomingEvent({
      event_id: "event-media-only",
      peer_id: "peer-media2",
      message_id: "incoming-media-2",
      msg_ts: Date.now(),
      hash: "hash-media-2",
      unread_count: 1,
      preview: "收款码",
      payload: { text: "[![QR](https://qr.example.com/pay2.png)](https://pay.example.com)" },
      state: "NEW",
      source: "MQTT",
      a2a_message_id: "incoming-media-2",
      push_enabled: false,
    });
  } finally {
    store.close();
  }

  try {
    const result = await ack({
      dbPath: temp.dbPath,
      consumerId: "openclaw",
      eventId: "event-media-only",
      sourceSessionKey: "agent:main:feishu:direct:ou_media2",
      notifyExternal: true,
      summaryText: "",
      mediaUrl: "https://qr.example.com/pay2.png",
    });

    assert.equal(result.ok, true);
    assert.equal(result.summary_enqueued, true);

    const verifyStore = new EventStore(temp.dbPath).open();
    try {
      const rows = verifyStore.listPendingMediaOutbox({ now: Date.now() + 1, batchSize: 5 });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].media_url, "https://qr.example.com/pay2.png");
      assert.equal(rows[0].message_text, "");
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
