const { sha256Hex } = require("../auth/signer");

function coerceInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function sanitizePreview(text, maxChars) {
  const compact = String(text || "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const limit = Number.isFinite(maxChars) ? maxChars : 80;
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 3))}...`;
}

function toEventHash({ peerId, messageTs, messageText, messageId }) {
  if (messageId) return sha256Hex(`id:${messageId}`);
  return sha256Hex(`${peerId}|${messageTs}|${messageText}`);
}

function extractFullText(event) {
  const raw = event.payload_json;
  if (!raw) return "";
  let envelope;
  try {
    envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return "";
  }
  const payload = envelope && envelope.payload ? envelope.payload : envelope;
  const text = String(payload && (payload.text || payload.message) || "").trim();
  const image = String(payload && payload.image || "").trim();
  if (text && image) return `${text}\n[收款二维码]: ${image}`;
  if (image) return `[收款二维码]: ${image}`;
  return text;
}

function extractImageUrl(event) {
  const raw = event.payload_json;
  if (!raw) return "";
  let envelope;
  try {
    envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return "";
  }
  const payload = envelope && envelope.payload ? envelope.payload : envelope;
  return String(payload && payload.image || "").trim();
}

function formatSystemEventText(event) {
  const fullText = extractFullText(event);
  const body = fullText || sanitizePreview(event.preview, 200);
  const imageUrl = extractImageUrl(event);

  // header 一行内联必要元数据，AI 从中取 event_id / from_agent，无需复读流程指令
  const header = `[A2H Market | from:${event.peer_id} | event:${event.event_id}]`;

  const lines = [header, "", body];

  if (imageUrl && !fullText.includes(imageUrl)) {
    lines.push(`[收款二维码]: ${imageUrl}`);
  }

  return lines.join("\n");
}

function formatSummaryNotificationText({ eventId, peerId, summaryText, sourceSessionKey }) {
  const lines = [
    "【a2hmarket 关键事件摘要】",
    `event_id: ${eventId}`,
    `from_agent: ${peerId || "-"}`,
  ];
  if (sourceSessionKey) {
    lines.push(`source_session_key: ${sourceSessionKey}`);
  }
  lines.push("", String(summaryText || "").trim());
  if (sourceSessionKey) {
    lines.push(
      "",
      "---",
      "如需在飞书中做出决策，请直接回复本消息。",
      "飞书 session AI 收到你的回复后，请将决策转发到 peer session：",
      `  openclaw agent --session-key ${sourceSessionKey} --message "Human决策: <你的回复>"`
    );
  }
  return lines.join("\n");
}

module.exports = {
  coerceInt,
  normalizeText,
  sanitizePreview,
  toEventHash,
  extractFullText,
  extractImageUrl,
  formatSystemEventText,
  formatSummaryNotificationText,
};
