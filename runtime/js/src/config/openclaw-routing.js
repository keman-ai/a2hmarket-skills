const { spawnSync } = require("node:child_process");

const MAIN_SESSION_KEY = "agent:main:main";

function parseSessionsJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function listOpenclawSessions(options) {
  const openclawCommand = Array.isArray(options && options.openclawCommand)
    ? options.openclawCommand
    : ["openclaw"];
  const execFn = options && typeof options.execFn === "function" ? options.execFn : spawnSync;
  const timeoutMs = Number.isFinite(options && options.timeoutMs)
    ? Math.max(1000, Number(options.timeoutMs))
    : 10_000;
  const command = [...openclawCommand, "sessions", "--json"];

  try {
    const result = execFn(command[0], command.slice(1), {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 512 * 1024,
    });
    if (result.error) {
      return {
        ok: false,
        detail: String(result.error.message || result.error),
        sessions: [],
      };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        detail: String(`${result.stdout || ""}\n${result.stderr || ""}`.trim() || `exit=${result.status}`),
        sessions: [],
      };
    }
    const parsed = parseSessionsJson(result.stdout || "");
    const sessions = Array.isArray(parsed && parsed.sessions) ? parsed.sessions : [];
    return {
      ok: true,
      detail: "",
      sessions,
    };
  } catch (err) {
    return {
      ok: false,
      detail: String((err && err.message) || err),
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

  const latest = pickLatestSession(sessions, {
    nowMs: options && options.nowMs,
    maxAgeMs: options && options.maxAgeMs,
    excludeSessionKeys: [MAIN_SESSION_KEY],
  });
  if (latest) {
    return buildSessionRoute(latest, "latest-active");
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
  parseSessionsJson,
  listOpenclawSessions,
  pickSessionByIdentity,
  pickLatestSession,
  pickSourceSession,
  resolvePushSession,
  parseDeliveryHintsFromSessionKey,
};
