const MAIN_SESSION_KEY = "agent:main:main";

/**
 * List sessions via GatewayClient (async).
 * Falls back to empty list on error.
 */
async function listOpenclawSessions(options) {
  const gatewayClient = options && options.gatewayClient;
  if (!gatewayClient) {
    return { ok: false, detail: "no gateway client", sessions: [] };
  }
  try {
    const result = await gatewayClient.sessionsList();
    const sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    return { ok: true, detail: "", sessions };
  } catch (err) {
    return {
      ok: false,
      detail: String(err?.message || err),
      sessions: [],
    };
  }
}

function pickSessionByIdentity(sessions, options) {
  const list = Array.isArray(sessions) ? sessions : [];
  const sessionId = String((options && options.sessionId) || "").trim();
  const sessionKey = String((options && options.sessionKey) || "").trim();
  if (!sessionId && !sessionKey) return null;
  return (
    list.find((session) => {
      const currentId = String((session && session.sessionId) || "").trim();
      const currentKey = String((session && session.key) || "").trim();
      if (sessionId && currentId === sessionId) return true;
      if (sessionKey && currentKey === sessionKey) return true;
      return false;
    }) || null
  );
}

function pickLatestSession(sessions, options) {
  const excludedKeys = new Set(
    Array.isArray(options && options.excludeSessionKeys)
      ? options.excludeSessionKeys.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  );
  const list = (Array.isArray(sessions) ? sessions : [])
    .filter((session) => {
      const sessionId = String((session && session.sessionId) || "").trim();
      const sessionKey = String((session && session.key) || "").trim();
      if (!sessionId) return false;
      if (sessionKey && excludedKeys.has(sessionKey)) return false;
      return true;
    })
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  if (list.length === 0) return null;

  const best = list[0];
  const nowValue = Number(options && options.nowMs);
  const maxAgeMs = Number(options && options.maxAgeMs);
  if (Number.isFinite(nowValue) && Number.isFinite(maxAgeMs) && maxAgeMs >= 0) {
    const updatedAt = Number(best.updatedAt || 0);
    if (!updatedAt || nowValue - updatedAt > maxAgeMs) {
      return null;
    }
  }
  return best;
}

function buildSessionRoute(session, source) {
  if (!session) return null;
  return {
    sessionId: String((session && session.sessionId) || "").trim(),
    sessionKey: String((session && session.key) || "").trim(),
    source,
  };
}

function fallbackRoute(options) {
  return {
    sessionId: String((options && options.fallbackSessionId) || "").trim(),
    sessionKey: String((options && options.fallbackSessionKey) || MAIN_SESSION_KEY).trim(),
    source: "fallback",
  };
}

function pickChannelSession(sessions) {
  const list = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => {
      const key = String((s && s.key) || "").trim();
      return key && parseDeliveryHintsFromSessionKey(key) !== null;
    })
    .sort((a, b) => {
      const aKey = String((a && a.key) || "").toLowerCase();
      const bKey = String((b && b.key) || "").toLowerCase();
      const aFeishu = aKey.includes("feishu") ? 1 : 0;
      const bFeishu = bKey.includes("feishu") ? 1 : 0;
      if (aFeishu !== bFeishu) return bFeishu - aFeishu;
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    });
  return list.length > 0 ? list[0] : null;
}

function pickSourceSession(options) {
  const sessions = Array.isArray(options && options.sessions) ? options.sessions : [];
  const explicit = pickSessionByIdentity(sessions, {
    sessionId: options && options.preferredSessionId,
    sessionKey: options && options.preferredSessionKey,
  });
  if (explicit) {
    return buildSessionRoute(explicit, "explicit");
  }
  if ((options && options.preferredSessionId) || (options && options.preferredSessionKey)) {
    const preferredSessionKey = String((options && options.preferredSessionKey) || "").trim();
    return {
      sessionId: preferredSessionKey ? "" : String((options && options.preferredSessionId) || "").trim(),
      sessionKey: preferredSessionKey,
      source: "explicit-unverified",
    };
  }

  const nowMs = options && options.nowMs;
  const maxAgeMs = options && options.maxAgeMs;

  const latest = pickLatestSession(sessions, {
    nowMs,
    maxAgeMs,
    excludeSessionKeys: [MAIN_SESSION_KEY],
  });
  if (latest) {
    return buildSessionRoute(latest, "latest-active");
  }

  // Only consider channel sessions when no maxAgeMs staleness filter is active.
  // If maxAgeMs is specified and latest-active returned nothing, all non-main
  // sessions are too old → go straight to fallback.
  const hasAgeFilter = Number.isFinite(Number(nowMs)) && Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) >= 0;
  if (!hasAgeFilter) {
    const channel = pickChannelSession(sessions);
    if (channel) {
      return buildSessionRoute(channel, "channel-preferred");
    }
  }

  return fallbackRoute(options);
}

function resolvePushSession(options) {
  const sessions = Array.isArray(options && options.sessions) ? options.sessions : [];
  const recorded = pickSessionByIdentity(sessions, {
    sessionId: options && options.targetSessionId,
    sessionKey: options && options.targetSessionKey,
  });
  if (recorded) {
    return buildSessionRoute(recorded, "recorded");
  }
  if ((options && options.targetSessionId) || (options && options.targetSessionKey)) {
    const targetSessionKey = String((options && options.targetSessionKey) || "").trim();
    return {
      sessionId: targetSessionKey ? "" : String((options && options.targetSessionId) || "").trim(),
      sessionKey: targetSessionKey,
      source: "recorded-unverified",
    };
  }
  return pickSourceSession(options);
}

const DELIVERABLE_SESSION_KINDS = new Set(["direct", "dm", "group", "channel"]);

function parseDeliveryHintsFromSessionKey(sessionKey) {
  const raw = String(sessionKey || "").trim();
  if (!raw) return null;
  const rawParts = raw.split(":").filter(Boolean);
  const parts =
    rawParts.length >= 3 && rawParts[0] === "agent" ? rawParts.slice(2) : rawParts;
  if (parts.length < 3) return null;
  const [channelRaw, kind, ...rest] = parts;
  if (!channelRaw || !DELIVERABLE_SESSION_KINDS.has(kind)) return null;
  const to = rest.join(":").trim();
  if (!to) return null;
  const channel = channelRaw.toLowerCase();
  if (channel === "main" || channel === "subagent") return null;
  return { channel, to };
}

module.exports = {
  MAIN_SESSION_KEY,
  listOpenclawSessions,
  pickSessionByIdentity,
  pickLatestSession,
  pickChannelSession,
  pickSourceSession,
  resolvePushSession,
  parseDeliveryHintsFromSessionKey,
};
