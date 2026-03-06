const DEFAULTS = {
  mqttEndpoint: "post-cn-e4k4o78q702.mqtt.aliyuncs.com",
  mqttPort: 8883,
  mqttProtocol: "mqtts",
  mqttGroupId: "GID_agent",
  mqttTopicId: "P2P_TOPIC",
  mqttTokenPath: "/mqtt-token/api/v1/token",
  mqttTokenSignPath: "",
  mqttReconnectPeriodMs: 5000,
  mqttConnectTimeoutMs: 15000,
  mqttTokenRefreshThresholdMs: 60 * 60 * 1000,
  inboundToleranceMs: 24 * 60 * 60 * 1000,
  dmPolicy: "open",
};

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function assertSecureUrl(name, value) {
  const normalized = normalizeBaseUrl(value);
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid https url`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use https`);
  }
  return parsed.toString().replace(/\/+$/, "");
}

function listAccountIds(config) {
  const accounts = config && config.channels && config.channels.a2hmarket && config.channels.a2hmarket.accounts
    ? config.channels.a2hmarket.accounts
    : {};
  return Object.keys(accounts).filter((accountId) => accounts[accountId] && accounts[accountId].enabled !== false);
}

function resolveAccount(config, accountId) {
  const accounts = config && config.channels && config.channels.a2hmarket
    ? config.channels.a2hmarket.accounts
    : null;
  const resolvedAccountId = String(accountId || "default").trim() || "default";
  const raw = accounts && accounts[resolvedAccountId] ? accounts[resolvedAccountId] : null;
  if (!raw) return undefined;
  if (raw.enabled === false) return undefined;

  const baseUrl = assertSecureUrl("baseUrl", raw.baseUrl);
  const mqttTokenBaseUrl = assertSecureUrl("mqttTokenBaseUrl", raw.mqttTokenBaseUrl || baseUrl);
  const mqttProtocol = String(raw.mqttProtocol || DEFAULTS.mqttProtocol).trim();
  if (mqttProtocol !== "mqtts") {
    throw new Error("mqttProtocol must be mqtts");
  }

  return {
    accountId: resolvedAccountId,
    enabled: raw.enabled !== false,
    agentId: String(raw.agentId || "").trim(),
    agentSecret: String(raw.agentSecret || "").trim(),
    baseUrl,
    mqttTokenBaseUrl,
    mqttTokenPath: String(raw.mqttTokenPath || DEFAULTS.mqttTokenPath).trim(),
    mqttTokenSignPath: String(raw.mqttTokenSignPath || DEFAULTS.mqttTokenSignPath).trim(),
    mqttEndpoint: String(raw.mqttEndpoint || DEFAULTS.mqttEndpoint).trim(),
    mqttPort: toInt(raw.mqttPort, DEFAULTS.mqttPort),
    mqttProtocol,
    mqttGroupId: String(raw.mqttGroupId || DEFAULTS.mqttGroupId).trim(),
    mqttTopicId: String(raw.mqttTopicId || DEFAULTS.mqttTopicId).trim(),
    mqttReconnectPeriodMs: toInt(raw.mqttReconnectPeriodMs, DEFAULTS.mqttReconnectPeriodMs),
    mqttConnectTimeoutMs: toInt(raw.mqttConnectTimeoutMs, DEFAULTS.mqttConnectTimeoutMs),
    mqttTokenRefreshThresholdMs: toInt(
      raw.mqttTokenRefreshThresholdMs,
      DEFAULTS.mqttTokenRefreshThresholdMs
    ),
    inboundToleranceMs: toInt(raw.inboundToleranceMs, DEFAULTS.inboundToleranceMs),
    a2aSharedSecret: String(raw.a2aSharedSecret || raw.agentSecret || "").trim(),
    dmPolicy: String(raw.dmPolicy || DEFAULTS.dmPolicy).trim(),
    allowFrom: Array.isArray(raw.allowFrom) ? raw.allowFrom.map((item) => String(item)) : [],
    allowTo: Array.isArray(raw.allowTo) ? raw.allowTo.map((item) => String(item)) : [],
    groups: raw.groups && typeof raw.groups === "object" ? { ...raw.groups } : {},
  };
}

module.exports = {
  DEFAULTS,
  listAccountIds,
  resolveAccount,
};
