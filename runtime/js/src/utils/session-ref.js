function formatSessionRef(sessionKey, sessionId) {
  const key = String(sessionKey || "").trim();
  if (key) {
    const parts = key.split(":");
    if (parts.length >= 2) {
      return `${parts.slice(0, 2).join(":")}:...`;
    }
    return `${key.slice(0, 6)}...`;
  }
  const id = String(sessionId || "").trim();
  if (!id) return "-";
  return `${id.slice(0, 8)}...`;
}

function scrubSessionRefs(text) {
  const raw = String(text || "");
  if (!raw) return raw;

  const scrubbedKeys = raw.replace(/\b[^\s"']+(?::[^\s"']+){2,}\b/g, (match) => {
    return formatSessionRef(match, "");
  });

  return scrubbedKeys.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    (match) => formatSessionRef("", match)
  );
}

module.exports = {
  formatSessionRef,
  scrubSessionRefs,
};
