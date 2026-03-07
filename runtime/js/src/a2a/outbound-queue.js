const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { EventStore } = require("../store/event-store");
const {
  MAIN_SESSION_KEY,
  listOpenclawSessions,
  pickSourceSession,
} = require("../config/openclaw-routing");

function isProcessRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessCommand(pid) {
  try {
    return String(
      execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    ).trim();
  } catch {
    return "";
  }
}

function isListenerProcess(pid) {
  if (!isProcessRunning(pid)) return false;
  const cmd = getProcessCommand(pid);
  if (!cmd) return false;
  return /\ba2hmarket\.js\b/.test(cmd) && /\blistener\b/.test(cmd) && /\brun\b/.test(cmd);
}

function getListenerProcess(lockPath) {
  if (!lockPath || !fs.existsSync(lockPath)) {
    return { running: false, pid: 0 };
  }
  let raw = "";
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch {
    return { running: false, pid: 0 };
  }
  const pid = Number.parseInt(String(raw || "").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { running: false, pid: 0 };
  }
  return {
    running: isListenerProcess(pid),
    pid,
  };
}

function resolveOutboundSourceSession({ cfg, sourceSessionId, sourceSessionKey, nowMs }) {
  const explicitSessionId = String(sourceSessionId || "").trim();
  const explicitSessionKey = String(sourceSessionKey || "").trim();
  if (explicitSessionId || explicitSessionKey) {
    return {
      sessionId: explicitSessionId,
      sessionKey: explicitSessionKey,
      source: "explicit-param",
      lookupOk: true,
      lookupDetail: "explicit source session provided",
    };
  }

  const listed = listOpenclawSessions({
    openclawCommand: cfg.openclawCommand,
  });
  const resolved = pickSourceSession({
    sessions: listed.sessions,
    preferredSessionId: "",
    preferredSessionKey: "",
    fallbackSessionId: cfg.openclawSessionId,
    fallbackSessionKey: MAIN_SESSION_KEY,
    nowMs,
  });
  if (!listed.ok && resolved.source === "fallback") {
    return {
      ...resolved,
      source: "fallback-session-list-failed",
      lookupOk: false,
      lookupDetail: listed.detail,
    };
  }
  return {
    ...resolved,
    lookupOk: listed.ok,
    lookupDetail: listed.detail,
  };
}

function enqueueOutboundEnvelope({
  cfg,
  targetAgentId,
  messageType,
  qos,
  envelope,
  sourceSessionId,
  sourceSessionKey,
}) {
  const store = new EventStore(cfg.dbPath).open();
  try {
    const messageId = String((envelope && envelope.message_id) || "").trim();
    if (!messageId) {
      throw new Error("envelope.message_id is required");
    }
    const traceId = String((envelope && envelope.trace_id) || "").trim();
    const sourceSession = resolveOutboundSourceSession({
      cfg,
      sourceSessionId,
      sourceSessionKey,
      nowMs: Date.now(),
    });
    const result = store.enqueueA2aOutbox({
      message_id: messageId,
      trace_id: traceId || null,
      target_agent_id: String(targetAgentId || "").trim(),
      message_type: String(messageType || "").trim(),
      qos: Number.parseInt(String(qos == null ? 1 : qos), 10),
      envelope: envelope || {},
      source_session_id: sourceSession.sessionId || null,
      source_session_key: sourceSession.sessionKey || null,
    });
    return {
      ...result,
      source_session_id: sourceSession.sessionId || "",
      source_session_key: sourceSession.sessionKey || "",
      source_session_source: sourceSession.source || "",
      source_session_lookup_ok: sourceSession.lookupOk !== false,
      source_session_lookup_detail: sourceSession.lookupDetail || "",
    };
  } finally {
    store.close();
  }
}

module.exports = {
  getListenerProcess,
  enqueueOutboundEnvelope,
};
