// 公共 API 客户端：签名、请求、统一输出格式
// 所有业务 CLI（profile/works/order）均通过此模块访问平台 API。

const { loadShellExports, resolveConfigPath } = require("../config/loader");
const { computeHttpSignature } = require("../auth/signer");

// ---------------------------------------------------------------------------
// 凭据加载
// ---------------------------------------------------------------------------

function loadCredentials() {
  const configPath = resolveConfigPath();
  const shellCfg = loadShellExports(configPath);
  const pick = (key) => {
    const envVal = process.env[key];
    if (envVal && envVal.trim()) return envVal.trim();
    const shellVal = shellCfg[key];
    if (shellVal && String(shellVal).trim()) return String(shellVal).trim();
    return "";
  };
  const baseUrl = pick("BASE_URL");
  const agentId = pick("AGENT_ID");
  const agentSecret = pick("AGENT_SECRET");
  if (!baseUrl || !agentId || !agentSecret) {
    throw new Error(
      "missing BASE_URL / AGENT_ID / AGENT_SECRET — 请确认 config/config.sh 已正确填写"
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), agentId, agentSecret };
}

// ---------------------------------------------------------------------------
// 请求头构造（含签名）
// ---------------------------------------------------------------------------

function buildHeaders({ method, signPath, agentId, agentSecret }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeHttpSignature({
    secret: agentSecret,
    method,
    path: signPath,
    agentId,
    timestampSec: timestamp,
  });
  return {
    "Content-Type": "application/json",
    "X-Agent-Id": agentId,
    "X-Timestamp": timestamp,
    "X-Agent-Signature": signature,
  };
}

// ---------------------------------------------------------------------------
// HTTP 请求
// ---------------------------------------------------------------------------

async function request({ creds, method, apiPath, signPath, body }) {
  const { baseUrl, agentId, agentSecret } = creds;
  // signPath 用于签名（不含查询参数）；apiPath 用于实际请求 URL
  const resolvedSignPath = signPath || apiPath;
  const headers = buildHeaders({ method, signPath: resolvedSignPath, agentId, agentSecret });
  const url = `${baseUrl}${apiPath}`;
  const init = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url, init);
  let json;
  try {
    json = await resp.json();
  } catch {
    throw new Error(`HTTP ${resp.status} — response body is not JSON`);
  }
  if (!resp.ok) {
    const msg = (json && json.message) || `HTTP ${resp.status}`;
    const code = (json && json.code) || String(resp.status);
    throw new PlatformError(msg, code, json);
  }
  // 平台成功响应 code 为 "200"（字符串）
  const platformCode = json && json.code;
  if (platformCode && String(platformCode) !== "200") {
    throw new PlatformError(
      (json && json.message) || "platform error",
      String(platformCode),
      json
    );
  }
  return json && json.data !== undefined ? json.data : json;
}

async function fetchJson({ creds, apiPath, signPath }) {
  return request({ creds, method: "GET", apiPath, signPath });
}

async function postJson({ creds, apiPath, signPath, body }) {
  return request({ creds, method: "POST", apiPath, signPath, body: body ?? {} });
}

// ---------------------------------------------------------------------------
// 平台错误类
// ---------------------------------------------------------------------------

class PlatformError extends Error {
  constructor(message, code, raw) {
    super(message);
    this.name = "PlatformError";
    this.platformCode = code;
    this.raw = raw;
  }
}

// ---------------------------------------------------------------------------
// 统一输出帮助函数（由各 CLI 调用）
// ---------------------------------------------------------------------------

function outputOk(action, data, meta) {
  const payload = { ok: true, action, data: data ?? null };
  if (meta) payload.meta = meta;
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function outputError(action, err) {
  const code =
    err instanceof PlatformError ? `PLATFORM_${err.platformCode}` : "RUNTIME_ERROR";
  const payload = {
    ok: false,
    action,
    error: {
      code,
      message: err && err.message ? err.message : String(err),
    },
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

module.exports = {
  loadCredentials,
  fetchJson,
  postJson,
  outputOk,
  outputError,
  PlatformError,
};
