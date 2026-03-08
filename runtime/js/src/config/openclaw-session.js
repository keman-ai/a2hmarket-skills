const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_OPENCLAW_SESSION_KEY = "agent:main:main";
const DEFAULT_OPENCLAW_SESSION_LABEL = "";

function looksLikeSessionKey(value) {
  return /^[^:\s]+(?::[^:\s]+){2,}$/.test(String(value || "").trim());
}

function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}

function getOpenclawSessionStatePath(homeDir) {
  const root = String(homeDir || process.env.HOME || os.homedir() || "").trim();
  if (!root) return "";
  return path.join(root, ".a2hmarket", "state", "openclaw-session.json");
}

function writeOpenclawSessionState(payload, options) {
  const filePath = getOpenclawSessionStatePath(options && options.homeDir);
  if (!filePath) return "";
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return filePath;
  } catch {
    return "";
  }
}

module.exports = {
  DEFAULT_OPENCLAW_SESSION_KEY,
  DEFAULT_OPENCLAW_SESSION_LABEL,
  looksLikeSessionKey,
  looksLikeUuid,
  getOpenclawSessionStatePath,
  writeOpenclawSessionState,
};
