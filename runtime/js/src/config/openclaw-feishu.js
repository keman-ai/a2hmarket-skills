const fs = require("node:fs");
const {
  normalizeNonEmptyString,
  resolveOpenclawConfigPath,
} = require("./openclaw-paths");

const DEFAULT_ACCOUNT_ID = "default";
const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_CHARS_RE = /[^a-z0-9_-]+/g;
const LEADING_DASH_RE = /^-+/;
const TRAILING_DASH_RE = /-+$/;

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeAccountId(value) {
  if (VALID_ID_RE.test(value)) {
    return value.toLowerCase();
  }
  return value
    .toLowerCase()
    .replace(INVALID_CHARS_RE, "-")
    .replace(LEADING_DASH_RE, "")
    .replace(TRAILING_DASH_RE, "")
    .slice(0, 64);
}

function normalizeAccountId(value) {
  const trimmed = normalizeNonEmptyString(value);
  if (!trimmed) {
    return DEFAULT_ACCOUNT_ID;
  }
  return canonicalizeAccountId(trimmed) || DEFAULT_ACCOUNT_ID;
}

function readOpenclawConfig() {
  const configPath = resolveOpenclawConfigPath();
  if (!configPath || !fs.existsSync(configPath)) {
    return { configPath, config: null };
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return { configPath, config: JSON.parse(raw) };
  } catch (err) {
    return {
      configPath,
      config: null,
      error: `failed to parse OpenClaw config: ${(err && err.message) || String(err)}`,
    };
  }
}

function resolveSecretLike(value) {
  const direct = normalizeNonEmptyString(value);
  if (direct) {
    return direct;
  }
  if (!isRecord(value)) {
    return "";
  }
  const source = normalizeNonEmptyString(value.source).toLowerCase();
  const id = normalizeNonEmptyString(value.id);
  if (source === "env" && id) {
    return normalizeNonEmptyString(process.env[id]);
  }
  return "";
}

function resolveFeishuConfig(openclawConfig) {
  if (!isRecord(openclawConfig) || !isRecord(openclawConfig.channels)) {
    return null;
  }
  const feishu = openclawConfig.channels.feishu;
  return isRecord(feishu) ? feishu : null;
}

function buildAccountMap(feishuConfig) {
  const accounts = isRecord(feishuConfig.accounts) ? feishuConfig.accounts : null;
  const map = new Map();
  if (!accounts) {
    return map;
  }
  for (const [rawAccountId, accountConfig] of Object.entries(accounts)) {
    if (!isRecord(accountConfig)) {
      continue;
    }
    map.set(normalizeAccountId(rawAccountId), accountConfig);
  }
  return map;
}

function resolveDefaultAccountId(feishuConfig, accountMap) {
  const preferred = normalizeNonEmptyString(feishuConfig.defaultAccount);
  if (preferred) {
    return normalizeAccountId(preferred);
  }
  if (accountMap.has(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  const sortedIds = Array.from(accountMap.keys()).sort((a, b) => a.localeCompare(b));
  return sortedIds[0] || DEFAULT_ACCOUNT_ID;
}

function mergeFeishuAccountConfig(feishuConfig, accountConfig) {
  const { accounts: _ignoredAccounts, defaultAccount: _ignoredDefault, ...baseConfig } = feishuConfig;
  return {
    ...baseConfig,
    ...(isRecord(accountConfig) ? accountConfig : {}),
  };
}

function resolveOpenclawFeishuCredentials(accountId) {
  const { configPath, config, error } = readOpenclawConfig();
  if (!config) {
    return { credentials: null, configPath, error: error || "" };
  }
  const feishuConfig = resolveFeishuConfig(config);
  if (!feishuConfig) {
    return { credentials: null, configPath, error: "" };
  }

  const accountMap = buildAccountMap(feishuConfig);
  const selectedAccountId = normalizeNonEmptyString(accountId)
    ? normalizeAccountId(accountId)
    : resolveDefaultAccountId(feishuConfig, accountMap);
  const mergedConfig = mergeFeishuAccountConfig(feishuConfig, accountMap.get(selectedAccountId));

  if (feishuConfig.enabled === false || mergedConfig.enabled === false) {
    return { credentials: null, configPath, error: "" };
  }

  const appId = resolveSecretLike(mergedConfig.appId);
  const appSecret = resolveSecretLike(mergedConfig.appSecret);
  if (!appId || !appSecret) {
    return { credentials: null, configPath, error: "" };
  }

  return {
    credentials: {
      accountId: selectedAccountId,
      appId,
      appSecret,
    },
    configPath,
    error: "",
  };
}

module.exports = {
  resolveOpenclawConfigPath,
  resolveOpenclawFeishuCredentials,
};
