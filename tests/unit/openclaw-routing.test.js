const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAIN_SESSION_KEY,
  pickSourceSession,
  resolvePushSession,
  parseDeliveryHintsFromSessionKey,
} = require("../../runtime/js/src/config/openclaw-routing");

test("pickSourceSession returns explicitly requested session when it exists", () => {
  const sessions = [
    { key: MAIN_SESSION_KEY, sessionId: "main-session", updatedAt: 1000 },
    {
      key: "agent:main:feishu:direct:ou_123",
      sessionId: "feishu-session",
      updatedAt: 2000,
    },
  ];

  const resolved = pickSourceSession({
    sessions,
    preferredSessionKey: "agent:main:feishu:direct:ou_123",
    fallbackSessionId: "main-session",
    nowMs: 3000,
  });

  assert.deepEqual(resolved, {
    sessionId: "feishu-session",
    sessionKey: "agent:main:feishu:direct:ou_123",
    source: "explicit",
  });
});

test("pickSourceSession falls back to most recent active session", () => {
  const sessions = [
    { key: MAIN_SESSION_KEY, sessionId: "main-session", updatedAt: 1000 },
    {
      key: "agent:main:feishu:direct:ou_123",
      sessionId: "feishu-session",
      updatedAt: 5000,
    },
    {
      key: "agent:main:webchat:direct:user_1",
      sessionId: "web-session",
      updatedAt: 3000,
    },
  ];

  const resolved = pickSourceSession({
    sessions,
    fallbackSessionId: "main-session",
    nowMs: 8000,
    maxAgeMs: 10_000,
  });

  assert.deepEqual(resolved, {
    sessionId: "feishu-session",
    sessionKey: "agent:main:feishu:direct:ou_123",
    source: "latest-active",
  });
});

test("pickSourceSession ignores main session when inferring source automatically", () => {
  const sessions = [
    { key: MAIN_SESSION_KEY, sessionId: "main-session", updatedAt: 9000 },
    {
      key: "agent:main:feishu:direct:ou_123",
      sessionId: "feishu-session",
      updatedAt: 8000,
    },
  ];

  const resolved = pickSourceSession({
    sessions,
    fallbackSessionId: "main-session",
    nowMs: 10_000,
    maxAgeMs: 10_000,
  });

  assert.deepEqual(resolved, {
    sessionId: "feishu-session",
    sessionKey: "agent:main:feishu:direct:ou_123",
    source: "latest-active",
  });
});

test("pickSourceSession falls back to main when latest session is stale", () => {
  const sessions = [
    { key: MAIN_SESSION_KEY, sessionId: "main-session", updatedAt: 1000 },
    {
      key: "agent:main:feishu:direct:ou_123",
      sessionId: "feishu-session",
      updatedAt: 2000,
    },
  ];

  const resolved = pickSourceSession({
    sessions,
    fallbackSessionId: "main-session",
    nowMs: 20_000,
    maxAgeMs: 5_000,
  });

  assert.deepEqual(resolved, {
    sessionId: "main-session",
    sessionKey: MAIN_SESSION_KEY,
    source: "fallback",
  });
});

test("resolvePushSession prefers recorded event target over dynamic fallback", () => {
  const sessions = [
    { key: MAIN_SESSION_KEY, sessionId: "main-session", updatedAt: 1000 },
    {
      key: "agent:main:feishu:direct:ou_123",
      sessionId: "feishu-session",
      updatedAt: 5000,
    },
  ];

  const resolved = resolvePushSession({
    sessions,
    targetSessionKey: "agent:main:feishu:direct:ou_123",
    fallbackSessionId: "main-session",
    nowMs: 8000,
  });

  assert.deepEqual(resolved, {
    sessionId: "feishu-session",
    sessionKey: "agent:main:feishu:direct:ou_123",
    source: "recorded",
  });
});

test("resolvePushSession prefers unverified session key over stale session id", () => {
  const resolved = resolvePushSession({
    sessions: [],
    targetSessionId: "stale-session-id",
    targetSessionKey: "agent:main:feishu:direct:ou_123",
    fallbackSessionId: "main-session",
    nowMs: 8000,
  });

  assert.deepEqual(resolved, {
    sessionId: "",
    sessionKey: "agent:main:feishu:direct:ou_123",
    source: "recorded-unverified",
  });
});

// --- parseDeliveryHintsFromSessionKey ---

test("parseDeliveryHintsFromSessionKey extracts feishu direct session", () => {
  const hints = parseDeliveryHintsFromSessionKey("agent:main:feishu:direct:ou_123");
  assert.deepEqual(hints, { channel: "feishu", to: "ou_123" });
});

test("parseDeliveryHintsFromSessionKey extracts feishu group session", () => {
  const hints = parseDeliveryHintsFromSessionKey("agent:main:feishu:group:oc_abc");
  assert.deepEqual(hints, { channel: "feishu", to: "oc_abc" });
});

test("parseDeliveryHintsFromSessionKey extracts telegram dm session", () => {
  const hints = parseDeliveryHintsFromSessionKey("agent:main:telegram:dm:12345");
  assert.deepEqual(hints, { channel: "telegram", to: "12345" });
});

test("parseDeliveryHintsFromSessionKey extracts slack channel session", () => {
  const hints = parseDeliveryHintsFromSessionKey("agent:main:slack:channel:C012345");
  assert.deepEqual(hints, { channel: "slack", to: "C012345" });
});

test("parseDeliveryHintsFromSessionKey extracts whatsapp direct session with E164", () => {
  const hints = parseDeliveryHintsFromSessionKey("agent:main:whatsapp:direct:+15551234567");
  assert.deepEqual(hints, { channel: "whatsapp", to: "+15551234567" });
});

test("parseDeliveryHintsFromSessionKey returns null for agent:main:main", () => {
  assert.equal(parseDeliveryHintsFromSessionKey("agent:main:main"), null);
});

test("parseDeliveryHintsFromSessionKey returns null for empty string", () => {
  assert.equal(parseDeliveryHintsFromSessionKey(""), null);
  assert.equal(parseDeliveryHintsFromSessionKey(null), null);
  assert.equal(parseDeliveryHintsFromSessionKey(undefined), null);
});

test("parseDeliveryHintsFromSessionKey returns null for keys without agent prefix", () => {
  assert.equal(parseDeliveryHintsFromSessionKey("main:main"), null);
});

test("parseDeliveryHintsFromSessionKey handles multi-colon to values", () => {
  const hints = parseDeliveryHintsFromSessionKey("agent:main:discord:channel:guild:channel_id");
  assert.deepEqual(hints, { channel: "discord", to: "guild:channel_id" });
});
