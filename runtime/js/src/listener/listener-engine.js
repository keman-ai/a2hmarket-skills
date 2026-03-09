const { EventStore, nowMs } = require("../store/event-store");
const { flushPushOutbox } = require("./push-dispatcher");
const { flushA2aOutbox } = require("./a2a-outbox-dispatcher");
const { flushMediaOutbox } = require("./media-dispatcher");
const { acquireSingleInstanceLock } = require("./lock");
const { startA2aService } = require("../a2a/service");
const { formatSessionRef } = require("../utils/session-ref");
const { GatewayClient } = require("../gateway/gateway-client");
const { PeerSessionManager } = require("../gateway/peer-session-manager");
const {
  looksLikeSessionKey,
  looksLikeUuid,
  writeOpenclawSessionState,
} = require("../config/openclaw-session");

async function bootstrapSession(gw, cfg, logger) {
  const sessionKey = cfg.openclawSessionKey;
  if (!sessionKey || !looksLikeSessionKey(sessionKey)) {
    return { ok: false, detail: `invalid session key: ${sessionKey}` };
  }

  try {
    const result = await gw.sessionsPatch({
      key: sessionKey,
      label: cfg.openclawSessionLabel || undefined,
    });

    const sessionId = String(result?.entry?.sessionId || "").trim();
    const canonicalKey = String(result?.key || "").trim() || sessionKey;

    if (!sessionId || !looksLikeUuid(sessionId)) {
      return { ok: false, detail: `sessions.patch returned invalid sessionId for key=${canonicalKey}` };
    }

    cfg.openclawSessionId = sessionId;
    cfg.openclawSessionKeyCanonical = canonicalKey;

    writeOpenclawSessionState({
      key: sessionKey,
      canonicalKey,
      sessionId,
      label: cfg.openclawSessionLabel || "",
      strict: cfg.openclawSessionStrict,
      pushEnabled: cfg.pushEnabled,
      bootstrapError: "",
      updatedAtMs: nowMs(),
    });

    logger.info(`session bootstrap ok key=${canonicalKey} session_id=${sessionId}`);
    return { ok: true, sessionId, canonicalKey };
  } catch (err) {
    const detail = String(err?.message || err);
    if (/label already in use/i.test(detail)) {
      try {
        const retry = await gw.sessionsPatch({ key: sessionKey });
        const sessionId = String(retry?.entry?.sessionId || "").trim();
        const canonicalKey = String(retry?.key || "").trim() || sessionKey;
        if (sessionId && looksLikeUuid(sessionId)) {
          cfg.openclawSessionId = sessionId;
          cfg.openclawSessionKeyCanonical = canonicalKey;
          logger.info(`session bootstrap ok (label retry) key=${canonicalKey} session_id=${sessionId}`);
          return { ok: true, sessionId, canonicalKey };
        }
      } catch {}
    }
    return { ok: false, detail };
  }
}

async function runListener(cfg, options) {
  const store = new EventStore(cfg.dbPath).open();
  const once = Boolean(options && options.once);
  const logger = options.logger;
  const lock = acquireSingleInstanceLock(cfg.lockPath);
  const a2aService = await startA2aService({ cfg, store, logger });

  let gw = null;
  let peerSessionManager = null;
  if (cfg.pushEnabled) {
    gw = new GatewayClient({ logger });
    try {
      await gw.connect();
    } catch (err) {
      if (cfg.openclawSessionStrict) {
        store.close();
        lock.release();
        throw new Error(`gateway connect failed: ${err.message}`);
      }
      logger.warn(`gateway connect failed, push disabled: ${err.message}`);
      cfg.pushEnabled = false;
    }

    if (cfg.pushEnabled) {
      const boot = await bootstrapSession(gw, cfg, logger);
      if (!boot.ok) {
        if (cfg.openclawSessionStrict) {
          gw.disconnect();
          store.close();
          lock.release();
          throw new Error(`session bootstrap failed: ${boot.detail}`);
        }
        logger.warn(`session bootstrap failed, push disabled: ${boot.detail}`);
        cfg.pushEnabled = false;
      }
    }

    if (cfg.pushEnabled) {
      peerSessionManager = new PeerSessionManager(gw, logger);
    }
  }

  let stopRequested = false;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 10;

  const stop = () => {
    stopRequested = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  logger.info(
    `listener started db=${cfg.dbPath} flush_interval_ms=${cfg.pollIntervalMs || 5000} push_enabled=${cfg.pushEnabled} session=${cfg.pushEnabled ? formatSessionRef(cfg.openclawSessionKey, cfg.openclawSessionId) : "-"} gateway=${gw ? "connected" : "off"}`
  );
  try {
    while (!stopRequested) {
      const start = nowMs();
      let stats = {
        pushDispatched: 0,
        pushAcked: 0,
        pushRetried: 0,
        pushSkipped: 0,
        a2aSent: 0,
        a2aRetried: 0,
        mediaSent: 0,
        mediaRetried: 0,
        mediaFailed: 0,
      };
      
      try {
        const pushStats = await flushPushOutbox(store, cfg, logger, { gatewayClient: gw, peerSessionManager });
        stats.pushDispatched = pushStats.dispatched;
        stats.pushAcked = pushStats.acked;
        stats.pushRetried = pushStats.retried;
        stats.pushSkipped = pushStats.skipped || 0;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        logger.error(`flush push outbox failed: ${(err && err.message) || String(err)}`);
        if (isCriticalError(err) || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.error(`critical error or too many failures (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), stopping listener`);
          throw err;
        }
      }
      
      try {
        const a2aStats = await flushA2aOutbox(store, cfg, logger, {
          publish: a2aService.publishEnvelope,
          peerSessionManager,
          gatewayClient: gw,
        });
        stats.a2aSent = a2aStats.sent;
        stats.a2aRetried = a2aStats.retried;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        logger.error(`flush a2a outbox failed: ${(err && err.message) || String(err)}`);
        if (isCriticalError(err) || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.error(`critical error or too many failures (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), stopping listener`);
          throw err;
        }
      }

      try {
        const mediaStats = await flushMediaOutbox(store, cfg, logger, { gatewayClient: gw });
        stats.mediaSent = mediaStats.sent;
        stats.mediaRetried = mediaStats.retried;
        stats.mediaFailed = mediaStats.failed;
        consecutiveFailures = 0;
      } catch (err) {
        consecutiveFailures++;
        logger.error(`flush media outbox failed: ${(err && err.message) || String(err)}`);
        if (isCriticalError(err) || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          logger.error(`critical error or too many failures (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), stopping listener`);
          throw err;
        }
      }

      const anyMedia = stats.mediaSent > 0 || stats.mediaRetried > 0 || stats.mediaFailed > 0;
      if (stats.pushDispatched > 0 || stats.pushAcked > 0 || stats.pushRetried > 0 || stats.pushSkipped > 0 || stats.a2aSent > 0 || stats.a2aRetried > 0 || anyMedia) {
        logger.info(
          `cycle done dispatched=${stats.pushDispatched} acked=${stats.pushAcked} retried=${stats.pushRetried} skipped=${stats.pushSkipped} a2a_sent=${stats.a2aSent} a2a_retried=${stats.a2aRetried} media_sent=${stats.mediaSent} media_retried=${stats.mediaRetried} media_failed=${stats.mediaFailed}`
        );
      }

      if (once) break;
      const elapsed = nowMs() - start;
      const flushIntervalMs = cfg.pollIntervalMs || 5000;
      const sleepMs = Math.max(100, flushIntervalMs - elapsed);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  } finally {
    if (gw) gw.disconnect();
    await a2aService.stop();
    store.close();
    lock.release();
    logger.info("listener stopped");
  }
  return 0;
}

function isCriticalError(err) {
  const msg = String((err && err.message) || "");
  if (msg.includes("database is locked")) return true;
  if (msg.includes("SQLITE_FULL")) return true;
  if (msg.includes("EACCES")) return true;
  if (msg.includes("ENOSPC")) return true;
  return false;
}

module.exports = {
  runListener,
};
