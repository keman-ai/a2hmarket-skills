const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { A2HMARKET_ROOT } = require("../config/paths");
const { loadShellExports, resolveConfigPath } = require("../config/loader");
const { computeHttpSignature } = require("../auth/signer");
const { parseOptions } = require("./arg-parser");

const CACHE_PATH = path.join(A2HMARKET_ROOT, "runtime", "store", "profile-cache.json");

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
  const agentSecret = pick("AGENT_KEY");
  if (!baseUrl || !agentId || !agentSecret) {
    throw new Error("missing BASE_URL / AGENT_ID / AGENT_KEY");
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), agentId, agentSecret };
}

function buildHeaders({ method, apiPath, agentId, agentSecret }) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = computeHttpSignature({
    secret: agentSecret,
    method,
    path: apiPath,
    agentId,
    timestampSec: timestamp,
  });
  return {
    "X-Agent-Id": agentId,
    "X-Timestamp": timestamp,
    "X-Agent-Signature": signature,
  };
}

async function fetchJson({ baseUrl, method, apiPath, agentId, agentSecret }) {
  const headers = buildHeaders({ method, apiPath, agentId, agentSecret });
  const url = `${baseUrl}${apiPath}`;
  const resp = await fetch(url, { method, headers });
  if (!resp.ok) {
    throw new Error(`API ${method} ${apiPath} returned ${resp.status}`);
  }
  return resp.json();
}

async function syncProfile(creds) {
  const apiPath = "/findu-user/api/v1/user/profile/public";
  const json = await fetchJson({ ...creds, method: "GET", apiPath });
  const data = json && json.data;
  if (!data) return null;
  return {
    nickname: data.nickname || null,
    avatarUrl: data.avatarUrl || null,
    bio: data.bio || null,
    abilities: data.abilities || [],
    realnameStatus: data.realnameStatus ?? null,
    paymentQrcodeUrl: data.paymentQrcodeUrl || null,
  };
}

async function syncWorks(creds, type) {
  const apiPath = `/findu-user/api/v1/user/works/public?type=${type}&page=1&pageSize=50`;
  const signPath = "/findu-user/api/v1/user/works/public";
  const headers = buildHeaders({ method: "GET", apiPath: signPath, agentId: creds.agentId, agentSecret: creds.agentSecret });
  const url = `${creds.baseUrl}${apiPath}`;
  const resp = await fetch(url, { method: "GET", headers });
  if (!resp.ok) {
    throw new Error(`API GET ${apiPath} returned ${resp.status}`);
  }
  const json = await resp.json();
  const data = json && json.data;
  if (!data) return [];
  const records = data.records || data.list || [];
  return records.map((r) => ({
    worksId: r.worksId || null,
    title: r.title || "",
    content: r.content || "",
    type: r.type ?? type,
    status: r.status ?? null,
    extendInfo: r.extendInfo || null,
  }));
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  a2hmarket sync [--only profile|works]",
      "",
      "Syncs agent self-information from the platform and caches locally.",
    ].join("\n") + "\n"
  );
}

async function runSyncCli(args) {
  try {
    const options = parseOptions(args || []);
    const only = String(options.only || "").toLowerCase();
    if (only && only !== "profile" && only !== "works") {
      process.stderr.write("--only must be 'profile' or 'works'\n");
      printUsage();
      return 1;
    }

    const creds = loadCredentials();
    const result = { synced_at: new Date().toISOString() };

    if (!only || only === "profile") {
      result.profile = await syncProfile(creds);
    }

    if (!only || only === "works") {
      result.service_works = await syncWorks(creds, 3);
      result.demand_works = await syncWorks(creds, 2);
    }

    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");

    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  } catch (err) {
    const payload = {
      ok: false,
      error: err && err.message ? err.message : String(err),
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return 1;
  }
}

module.exports = { runSyncCli };
