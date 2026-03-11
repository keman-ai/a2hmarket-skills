const { coerceInt } = require("./message-utils");

function calculateBackoffMs(attempt, maxDelayMs) {
  const normalizedAttempt = Math.max(1, Math.min(10, coerceInt(attempt, 1)));
  const base = 1000 * 2 ** (normalizedAttempt - 1);
  const capped = Math.min(base, coerceInt(maxDelayMs, 5 * 60 * 1000));
  return Math.max(1000, capped);
}

module.exports = { calculateBackoffMs };
