const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  A2HMARKET_ROOT,
  DEFAULT_DB_PATH,
  DEFAULT_LOCK_PATH,
  DEFAULT_LOG_PATH,
  DEFAULT_PID_PATH,
  DEFAULT_CONFIG_PATH,
  resolvePath,
} = require("./paths");
const {
  DEFAULT_OPENCLAW_SESSION_KEY,
  DEFAULT_OPENCLAW_SESSION_LABEL,
  writeOpenclawSessionState,
} = require("./openclaw-session");
const {
  resolveOpenclawConfigPath,
  resolveOpenclawFeishuCredentials,
} = require("./openclaw-feishu");

function nowMs() {
  return Date.now();
}

function parseBool(raw, fallback) {
  if (raw == null) return fallback;
  const value = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(value)) return true;
  if (["0", "false", "no", "n", "off"].includes(value)) return false;
  return fallback;
}

function parseIntBound(raw, fallback, min, max) {
  let n = Number.parseInt(String(raw == null ? fallback : raw), 10);
  if (!Number.isFinite(n)) n = fallback;
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max)) n = Math.min(max, n);
  return n;
}

function loadShellExports(configPath) {
  const values = {};
  if (!configPath || !fs.existsSync(configPath)) return values;

  const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  const pattern = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) continue;
    const matched = rawLine.match(pattern);
    if (!matched) continue;
    const key = matched[1];
    let value = matched[2].trim();
    // Strip inline comment (# not inside quotes) - MQTT clientId must be ASCII-only
    let inQuote = null;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (c === '"' || c === "'") {
        if (inQuote === c) inQuote = null;
        else if (!inQuote) inQuote = c;
      } else if (c === "#" && !inQuote) {
        value = value.slice(0, i).trim();
        break;
      }
    }
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function resolveConfigPath() {
  const explicit = String(process.env.A2HMARKET_CONFIG_PATH || "").trim();
  if (explicit) {
    return path.isAbsolute(explicit)
      ? explicit
      : path.resolve(process.cwd(), explicit);
  }
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
    return DEFAULT_CONFIG_PATH;
  }
  const legacyPath = path.join(A2HMARKET_ROOT, "config", "config.sh");
  if (fs.existsSync(legacyPath)) {
    return legacyPath;
  }
  return DEFAULT_CONFIG_PATH;
}

function resolveListenerConfig() {
  const configPath = resolveConfigPath();
  if (!fs.existsSync(configPath)) {
    throw new Error(`missing authoritative config: ${configPath}`);
  }
  const shellCfg = loadShellExports(configPath);
  const pick = (key, fallback) => {
    const shellVal = shellCfg[key];
    if (shellVal != null && String(shellVal).trim() !== "") return String(shellVal).trim();
    const envVal = process.env[key];
    if (envVal != null && String(envVal).trim() !== "") return String(envVal).trim();
    return fallback == null ? "" : String(fallback);
  };
  // 凭据类配置优先使用环境变量，避免 config.sh 仍为占位符时把 REPLACE_WITH_YOUR_AGENT_ID 发到服务端
  const pickCred = (key, fallback) => {
    const envVal = process.env[key];
    if (envVal != null && String(envVal).trim() !== "") return String(envVal).trim();
    const shellVal = shellCfg[key];
    if (shellVal != null && String(shellVal).trim() !== "") return String(shellVal).trim();
    return fallback == null ? "" : String(fallback);
  };

  const baseUrl = pickCred("BASE_URL", "");
  const agentId = pickCred("AGENT_ID", "");
  const agentSecret = pickCred("AGENT_KEY", "");
  if (!baseUrl) {
    throw new Error("missing BASE_URL");
  }
  if (!agentId || !agentSecret) {
    throw new Error("missing credentials: BASE_URL/AGENT_ID/AGENT_KEY");
  }

  // Runtime 默认配置
  const RUNTIME_DEFAULTS = {
    A2HMARKET_PUSH_ENABLED: "true",
    A2HMARKET_OPENCLAW_SESSION_LABEL: "",
    A2HMARKET_OPENCLAW_SESSION_STRICT: "true",
    A2HMARKET_PUSH_ONCE: "true",
    A2HMARKET_MQTT_TOKEN_BASE_URL: baseUrl,
    A2HMARKET_MQTT_ENDPOINT: "post-cn-e4k4o78q702.mqtt.aliyuncs.com",
    A2HMARKET_MQTT_PORT: "8883",
    A2HMARKET_MQTT_PROTOCOL: "mqtts",
    A2HMARKET_MQTT_GROUP_ID: "GID_agent",
    A2HMARKET_MQTT_TOPIC_ID: "P2P_TOPIC",
    A2HMARKET_POLL_INTERVAL_MS: "5000",
    A2HMARKET_PUSH_BATCH_SIZE: "20",
    A2HMARKET_PUSH_ACK_WAIT_MS: "15000",
    A2HMARKET_PUSH_RETRY_MAX_DELAY_MS: "300000",
    A2HMARKET_A2A_SHARED_SECRET: "",
    A2HMARKET_A2A_OUTBOX_BATCH_SIZE: "50",
    A2HMARKET_A2A_OUTBOX_RETRY_MAX_DELAY_MS: String(60 * 1000),
    A2HMARKET_MQTT_RECONNECT_PERIOD_MS: "5000",
    A2HMARKET_MQTT_CONNECT_TIMEOUT_MS: "15000",
    A2HMARKET_MQTT_TOKEN_REFRESH_THRESHOLD_MS: String(60 * 60 * 1000),
    A2HMARKET_MQTT_TOKEN_PATH: "/mqtt-token/api/v1/token",
    A2HMARKET_MQTT_TOKEN_SIGN_PATH: "",
    A2HMARKET_PUSH_ACK_CONSUMER: "openclaw",
  };

  const pickWithDefault = (key) => {
    const value = pick(key, RUNTIME_DEFAULTS[key] || "");
    return value;
  };

  const pushEnabled = parseBool(pickWithDefault("A2HMARKET_PUSH_ENABLED"), true);

  const openclawSessionLabel = pickWithDefault("A2HMARKET_OPENCLAW_SESSION_LABEL");
  const openclawSessionStrict = parseBool(pickWithDefault("A2HMARKET_OPENCLAW_SESSION_STRICT"), true);
  const openclawSessionKeyRaw = DEFAULT_OPENCLAW_SESSION_KEY;
  const mqttTokenBaseUrl = pickWithDefault("A2HMARKET_MQTT_TOKEN_BASE_URL").replace(/\/+$/, "");
  const openclawConfigPath = resolveOpenclawConfigPath();
  const resolveFeishuCredentials = (accountId) => {
    return resolveOpenclawFeishuCredentials(accountId).credentials;
  };

  return {
    configPath,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    mqttTokenPath: pickWithDefault("A2HMARKET_MQTT_TOKEN_PATH"),
    mqttTokenSignPath: pickWithDefault("A2HMARKET_MQTT_TOKEN_SIGN_PATH"),
    mqttTokenBaseUrl,
    mqttClientGroupId: pickWithDefault("A2HMARKET_MQTT_GROUP_ID"),
    mqttTopicId: pickWithDefault("A2HMARKET_MQTT_TOPIC_ID"),
    mqttEndpoint: pickWithDefault("A2HMARKET_MQTT_ENDPOINT"),
    mqttPort: parseIntBound(pickWithDefault("A2HMARKET_MQTT_PORT"), 8883, 1, 65535),
    mqttProtocol: pickWithDefault("A2HMARKET_MQTT_PROTOCOL"),
    mqttReconnectPeriodMs: parseIntBound(
      pickWithDefault("A2HMARKET_MQTT_RECONNECT_PERIOD_MS"),
      5000,
      1000,
      60000
    ),
    mqttConnectTimeoutMs: parseIntBound(
      pickWithDefault("A2HMARKET_MQTT_CONNECT_TIMEOUT_MS"),
      15000,
      1000,
      120000
    ),
    a2aOutboxBatchSize: parseIntBound(
      pickWithDefault("A2HMARKET_A2A_OUTBOX_BATCH_SIZE"),
      50,
      1,
      500
    ),
    a2aOutboxRetryMaxDelayMs: parseIntBound(
      pickWithDefault("A2HMARKET_A2A_OUTBOX_RETRY_MAX_DELAY_MS"),
      60 * 1000,
      1000,
      30 * 60 * 1000
    ),
    a2aSharedSecret: pickWithDefault("A2HMARKET_A2A_SHARED_SECRET"),
    mqttTokenRefreshThresholdMs: parseIntBound(
      pickWithDefault("A2HMARKET_MQTT_TOKEN_REFRESH_THRESHOLD_MS"),
      60 * 60 * 1000,
      5000,
      24 * 60 * 60 * 1000
    ),
    agentId,
    agentSecret,
    dbPath: resolvePath(pick("A2HMARKET_DB_PATH", DEFAULT_DB_PATH), DEFAULT_DB_PATH),
    lockPath: resolvePath(pick("A2HMARKET_LISTENER_LOCK_FILE", DEFAULT_LOCK_PATH), DEFAULT_LOCK_PATH),
    logPath: resolvePath(pick("A2HMARKET_LISTENER_LOG_FILE", DEFAULT_LOG_PATH), DEFAULT_LOG_PATH),
    pidPath: resolvePath(pick("A2HMARKET_LISTENER_PID_FILE", DEFAULT_PID_PATH), DEFAULT_PID_PATH),
    pollIntervalMs: parseIntBound(pickWithDefault("A2HMARKET_POLL_INTERVAL_MS"), 5000, 500),
    pushEnabled,
    openclawSessionKey: openclawSessionKeyRaw,
    openclawSessionLabel,
    openclawSessionStrict,
    openclawSessionId: "",
    openclawSessionKeyCanonical: "",
    pushAckConsumer: pickWithDefault("A2HMARKET_PUSH_ACK_CONSUMER"),
    pushAckWaitMs: parseIntBound(
      pickWithDefault("A2HMARKET_PUSH_ACK_WAIT_MS"),
      15000,
      1000,
      10 * 60 * 1000
    ),
    pushRetryMaxDelayMs: parseIntBound(
      pickWithDefault("A2HMARKET_PUSH_RETRY_MAX_DELAY_MS"),
      5 * 60 * 1000,
      10000,
      60 * 60 * 1000
    ),
    pushBatchSize: parseIntBound(pickWithDefault("A2HMARKET_PUSH_BATCH_SIZE"), 20, 1, 200),
    pushOnce: parseBool(pickWithDefault("A2HMARKET_PUSH_ONCE"), true),
    openclawConfigPath,
    resolveFeishuCredentials,
    startedAtMs: nowMs(),
  };
}

module.exports = {
  loadShellExports,
  resolveConfigPath,
  resolveListenerConfig,
  parseBool,
  parseIntBound,
};
