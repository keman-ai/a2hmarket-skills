const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const A2HMARKET_ROOT = path.resolve(__dirname, "../../../..");

function resolveHomeDir() {
  return (
    (process.env.A2HMARKET_HOME || "").trim() ||
    process.env.HOME ||
    os.homedir() ||
    ""
  );
}

function resolveStateDir() {
  const explicit = (process.env.A2HMARKET_STATE_DIR || "").trim();
  if (explicit) {
    return path.isAbsolute(explicit)
      ? explicit
      : path.resolve(process.cwd(), explicit);
  }
  return path.join(resolveHomeDir(), ".a2hmarket");
}

const A2HMARKET_STATE_DIR = resolveStateDir();

const DEFAULT_DB_PATH = path.join(A2HMARKET_STATE_DIR, "store", "a2hmarket_listener.db");
const DEFAULT_CONFIG_PATH = path.join(A2HMARKET_STATE_DIR, "config.sh");
const DEFAULT_PID_PATH = path.join(A2HMARKET_STATE_DIR, "store", "listener.pid");
const DEFAULT_LOCK_PATH = path.join(A2HMARKET_STATE_DIR, "store", "a2hmarket_listener.lock");
const DEFAULT_LOG_PATH = path.join(A2HMARKET_STATE_DIR, "logs", "listener.log");
const DEFAULT_CACHE_PATH = path.join(A2HMARKET_STATE_DIR, "store", "profile-cache.json");

function resolvePath(input, fallbackAbsolutePath) {
  const raw = String(input || fallbackAbsolutePath).trim();
  if (!raw) return fallbackAbsolutePath;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(process.cwd(), raw);
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveDbPath(input) {
  return resolvePath(
    input || process.env.A2HMARKET_DB_PATH || DEFAULT_DB_PATH,
    DEFAULT_DB_PATH
  );
}

module.exports = {
  A2HMARKET_ROOT,
  A2HMARKET_STATE_DIR,
  DEFAULT_DB_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_PID_PATH,
  DEFAULT_LOCK_PATH,
  DEFAULT_LOG_PATH,
  DEFAULT_CACHE_PATH,
  resolveDbPath,
  resolvePath,
  ensureParentDir,
};
