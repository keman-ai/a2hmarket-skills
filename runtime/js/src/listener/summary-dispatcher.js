const { spawn } = require("node:child_process");
const { nowMs } = require("../store/event-store");
const { coerceInt } = require("./message-utils");

function calculateBackoffMs(attempt, maxDelayMs) {
  const normalizedAttempt = Math.max(1, Math.min(10, coerceInt(attempt, 1)));
  const base = 1000 * 2 ** (normalizedAttempt - 1);
  const capped = Math.min(base, coerceInt(maxDelayMs, 5 * 60 * 1000));
  return Math.max(1000, capped);
}

async function runOpenclawMessageSend(cfg, row) {
  const timeoutSec = Math.max(30, coerceInt(cfg.openclawPushTimeoutSec, 60));
  const command = [...cfg.openclawCommand, "message", "send"];
  command.push("--channel", String(row.channel));
  command.push("--target", String(row.to_target));
  if (row.account_id) {
    command.push("--account", String(row.account_id));
  }
  if (row.thread_id) {
    command.push("--thread-id", String(row.thread_id));
  }
  command.push("--message", String(row.summary_text));

  const started = nowMs();

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timeoutHandle = null;
    let exited = false;

    const child = spawn(command[0], command.slice(1), {
      encoding: "utf8",
      maxBuffer: 512 * 1024,
    });

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      if (!exited) {
        exited = true;
        try {
          child.kill("SIGTERM");
        } catch {}
      }
    };

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      cleanup();
      const elapsed = nowMs() - started;
      resolve({
        ok: false,
        detail: `elapsed_ms=${elapsed} ${err.message || String(err)}`.trim(),
      });
    });

    child.on("exit", (code) => {
      cleanup();
      exited = true;
      const elapsed = nowMs() - started;
      const output = `${stdout}\n${stderr}`.trim().slice(0, 500);
      if (code === 0) {
        resolve({ ok: true, detail: `elapsed_ms=${elapsed} ${output}`.trim() });
      } else {
        resolve({ ok: false, detail: `elapsed_ms=${elapsed} exit=${code} ${output}`.trim() });
      }
    });

    timeoutHandle = setTimeout(() => {
      if (!exited) {
        cleanup();
        const elapsed = nowMs() - started;
        resolve({
          ok: false,
          detail: `elapsed_ms=${elapsed} timeout after ${timeoutSec}s`,
        });
      }
    }, (timeoutSec + 10) * 1000);
  });
}

async function flushSummaryOutbox(store, cfg, logger, options) {
  if (!cfg.pushEnabled) {
    return { sent: 0, retried: 0, failed: 0 };
  }
  const nowFn = options && typeof options.now === "function" ? options.now : nowMs;
  const sendFn =
    options && typeof options.send === "function"
      ? options.send
      : runOpenclawMessageSend;
  const batchSize = coerceInt(cfg.pushBatchSize, 20);
  const maxRetries = coerceInt(cfg.summaryMaxRetries, 5);
  const rows = store.listPendingSummaryOutbox({
    now: nowFn(),
    batchSize,
  });

  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    const result = await sendFn(cfg, row);
    if (result.ok) {
      store.markSummarySent({ outboxId: row.id });
      sent += 1;
      logger.info(
        `summary sent event_id=${row.event_id} channel=${row.channel} to=${row.to_target} attempt=${row.attempt}`
      );
    } else {
      const nextAttempt = coerceInt(row.attempt, 0) + 1;
      if (nextAttempt > maxRetries) {
        store.markSummaryFailed({ outboxId: row.id, lastError: result.detail });
        failed += 1;
        logger.error(
          `summary failed permanently event_id=${row.event_id} attempt=${nextAttempt} detail=${(result.detail || "").slice(0, 200)}`
        );
      } else {
        const delayMs = calculateBackoffMs(nextAttempt, cfg.pushRetryMaxDelayMs);
        const nextRetryAt = nowFn() + delayMs;
        store.markSummaryRetry({
          outboxId: row.id,
          attempt: nextAttempt,
          nextRetryAt,
          lastError: result.detail,
        });
        retried += 1;
        logger.warn(
          `summary retry event_id=${row.event_id} attempt=${nextAttempt} retry_in_ms=${delayMs} detail=${(result.detail || "").slice(0, 200)}`
        );
      }
    }
  }

  return { sent, retried, failed };
}

module.exports = {
  flushSummaryOutbox,
  calculateBackoffMs,
};
