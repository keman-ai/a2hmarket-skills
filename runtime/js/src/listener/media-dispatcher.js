const { nowMs } = require("../store/event-store");
const { coerceInt } = require("./message-utils");

// Feishu channel identifier
const FEISHU_CHANNELS = new Set(["feishu", "lark", "飞书", "lark-open"]);

function isFeishuChannel(channel) {
  if (!channel) return false;
  const lower = String(channel).toLowerCase();
  return FEISHU_CHANNELS.has(lower);
}

function calculateBackoffMs(attempt, maxDelayMs) {
  const normalizedAttempt = Math.max(1, Math.min(10, coerceInt(attempt, 1)));
  const base = 1000 * 2 ** (normalizedAttempt - 1);
  const capped = Math.min(base, coerceInt(maxDelayMs, 5 * 60 * 1000));
  return Math.max(1000, capped);
}

async function runGatewaySend(gatewayClient, row, feishuClient) {
  const started = nowMs();
  try {
    const params = {
      channel: String(row.channel),
      to: String(row.to_target),
    };
    if (row.account_id) params.accountId = String(row.account_id);
    if (row.thread_id) params.threadId = String(row.thread_id);
    if (row.message_text) params.message = String(row.message_text);

    // Handle Feishu image upload
    if (isFeishuChannel(row.channel) && row.media_url && feishuClient) {
      const mediaUrl = String(row.media_url);
      const resolveCredentials =
        typeof feishuClient.resolveCredentials === "function"
          ? feishuClient.resolveCredentials
          : null;
      const credentials = resolveCredentials ? resolveCredentials(row.account_id) : null;
      if (!credentials || !credentials.appId || !credentials.appSecret) {
        throw new Error(`missing Feishu credentials for image upload channel=${row.channel}`);
      }
      if (!params.accountId && credentials.accountId) {
        params.accountId = String(credentials.accountId);
      }
      const imageKey = await feishuClient.uploadImageFromUrl(
        credentials.appId,
        credentials.appSecret,
        mediaUrl
      );
      params.imageKey = imageKey;
      // Feishu must send images by image_key rather than the original URL.
    } else if (row.media_url) {
      params.mediaUrl = String(row.media_url);
    }

    await gatewayClient.send(params);
    const elapsed = nowMs() - started;
    const sentWithImageKey = params.imageKey ? " imageKey" : "";
    return { ok: true, detail: `elapsed_ms=${elapsed} gateway send ok channel=${row.channel} media=${!!row.media_url}${sentWithImageKey}` };
  } catch (err) {
    const elapsed = nowMs() - started;
    return { ok: false, detail: `elapsed_ms=${elapsed} ${err.message || String(err)}`.trim() };
  }
}

async function flushMediaOutbox(store, cfg, logger, options) {
  if (!cfg.pushEnabled) {
    return { sent: 0, retried: 0, failed: 0 };
  }
  const nowFn = options && typeof options.now === "function" ? options.now : nowMs;
  const gatewayClient = options && options.gatewayClient;
  const feishuClient = options && options.feishuClient;
  const sendFn = options && typeof options.send === "function"
    ? options.send
    : (_, row) => runGatewaySend(gatewayClient, row, feishuClient);

  const batchSize = coerceInt(cfg.pushBatchSize, 20);
  const maxRetries = coerceInt(cfg.mediaMaxRetries, 5);
  const rows = store.listPendingMediaOutbox({
    now: nowFn(),
    batchSize,
  });

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    const result = await sendFn(cfg, row);
    if (result.ok) {
      store.markMediaSent({ outboxId: row.id });
      sent += 1;
      logger.info(
        `media sent event_id=${row.event_id} channel=${row.channel} to=${row.to_target} media=${!!row.media_url} attempt=${row.attempt}`
      );
    } else {
      const nextAttempt = coerceInt(row.attempt, 0) + 1;
      if (nextAttempt > maxRetries) {
        store.markMediaFailed({ outboxId: row.id, lastError: result.detail });
        failed += 1;
        logger.error(
          `media failed permanently event_id=${row.event_id} attempt=${nextAttempt} detail=${(result.detail || "").slice(0, 200)}`
        );
      } else {
        const delayMs = calculateBackoffMs(nextAttempt, cfg.pushRetryMaxDelayMs);
        const nextRetryAt = nowFn() + delayMs;
        store.markMediaRetry({
          outboxId: row.id,
          attempt: nextAttempt,
          nextRetryAt,
          lastError: result.detail,
        });
        retried += 1;
        logger.warn(
          `media retry event_id=${row.event_id} attempt=${nextAttempt} retry_in_ms=${delayMs} detail=${(result.detail || "").slice(0, 200)}`
        );
      }
    }
  }

  return { sent, retried, failed };
}

module.exports = {
  flushMediaOutbox,
  calculateBackoffMs,
};
