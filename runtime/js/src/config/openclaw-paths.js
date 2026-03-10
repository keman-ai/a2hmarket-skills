const os = require("node:os");
const path = require("node:path");

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function resolveHomeDir() {
  return normalizeNonEmptyString(process.env.OPENCLAW_HOME) || process.env.HOME || os.homedir() || "";
}

function resolveUserPath(input) {
  const trimmed = normalizeNonEmptyString(input);
  const homeDir = resolveHomeDir();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("~")) {
    return path.resolve(path.join(homeDir, trimmed.slice(1)));
  }
  return path.resolve(trimmed);
}

function resolveOpenclawStateDir(openclawDir) {
  const explicitDir = normalizeNonEmptyString(openclawDir);
  if (explicitDir) {
    return resolveUserPath(explicitDir);
  }
  const envDir = normalizeNonEmptyString(process.env.OPENCLAW_STATE_DIR);
  if (envDir) {
    return resolveUserPath(envDir);
  }
  return path.join(resolveHomeDir(), ".openclaw");
}

function resolveOpenclawConfigPath(openclawDir) {
  const explicitPath = normalizeNonEmptyString(process.env.OPENCLAW_CONFIG_PATH);
  if (explicitPath) {
    return resolveUserPath(explicitPath);
  }
  return path.join(resolveOpenclawStateDir(openclawDir), "openclaw.json");
}

module.exports = {
  normalizeNonEmptyString,
  resolveOpenclawStateDir,
  resolveOpenclawConfigPath,
};
