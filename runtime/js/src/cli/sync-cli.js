const fs = require("node:fs");
const { DEFAULT_CACHE_PATH, ensureParentDir } = require("../config/paths");
const { loadCredentials, request } = require("./api-client");
const { parseOptions } = require("./arg-parser");

const CACHE_PATH = DEFAULT_CACHE_PATH;

async function syncProfile(creds) {
  const apiPath = "/findu-user/api/v1/user/profile/public";
  const json = await request({ creds, method: "GET", apiPath });
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
  const signPath = "/findu-user/api/v1/user/works/public";
  const apiPath = `${signPath}?type=${type}&page=1&pageSize=50`;
  const json = await request({ creds, method: "GET", apiPath, signPath });
  const data = json && json.data;
  if (!data) return [];
  const records = data.items || data.records || data.list || [];
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

    ensureParentDir(CACHE_PATH);
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
