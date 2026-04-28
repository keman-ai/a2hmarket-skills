import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  token: string;
  /**
   * 仅 metadata，鉴权层（concierge AgentPatAuthFilter）不读这些字段——
   * 它从 PAT 反查数据库拿到真实 owner_user_id / agent_id / token_id。
   * 这里保留 optional 字段是给本地 `get_user_info` tool 显示用，缺了就空。
   */
  agentId?: string;
  tokenName?: string;
  createdAt?: string;
}

/**
 * Resolved URL set for a given environment. `apiBase` is the concierge
 * endpoint; `userBase` is the findu-user public endpoint (used only by the
 * login authcode flow); `frontBase` is the a2hmarket web frontend that hosts
 * `/authcode`.
 */
export interface A2hUrls {
  apiBase: string;
  userBase: string;
  frontBase: string;
}

/**
 * Resolve the credentials path. Respects `A2H_HOME` env var for testability.
 * Falls back to `$HOME/.a2h`.
 */
export function credDir(): string {
  const override = process.env.A2H_HOME;
  if (override) {
    return override;
  }
  return join(homedir(), ".a2h");
}

export function credPath(): string {
  return join(credDir(), "credentials.json");
}

/**
 * Load credentials from (in order):
 *   1. `A2H_PAT` env var — for hosts that can pass env in MCP config (most
 *      modern hosts: Claude Desktop, MaxClaw via mcporter, etc.). Lets users
 *      paste just the token from /authcode and skip the credentials file.
 *   2. `~/.a2h/credentials.json` — JSON object whose only required field is
 *      `token`. agentId/tokenName/createdAt are optional metadata.
 *   3. `~/.a2h/credentials.json` containing a bare `a2h_pat_...` string
 *      (no JSON braces) — same convenience path for `echo TOKEN > file` users.
 */
export function loadCredentials(): Credentials | null {
  const envToken = process.env.A2H_PAT;
  if (typeof envToken === "string" && envToken.startsWith("a2h_pat_")) {
    return { token: envToken.trim() };
  }

  const path = credPath();
  if (!existsSync(path)) {
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf-8").trim();
  } catch {
    return null;
  }

  // Bare-token form: file contents are just the PAT, no JSON.
  if (text.startsWith("a2h_pat_") && !text.startsWith("{")) {
    return { token: text };
  }

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.token !== "string") {
      return null;
    }
    return {
      token: parsed.token,
      agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
      tokenName:
        typeof parsed.tokenName === "string" ? parsed.tokenName : undefined,
      createdAt:
        typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
    };
  } catch {
    return null;
  }
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/$/, "");
}

/**
 * Derive the findu-user public endpoint from a concierge `apiBase`. The
 * concierge and findu-user share the same host/ALB; we just swap the path
 * segment (`/a2hmarket-concierge` → `/findu-user`). For non-standard hosts
 * (e.g. local dev with a different port), the caller must set `A2H_USER_BASE`
 * explicitly.
 */
function deriveUserBase(apiBase: string): string {
  try {
    const u = new URL(apiBase);
    // apiBase paths: `/a2hmarket-concierge` → `/findu-user`.
    // Any unrecognized path: replace entirely with `/findu-user`.
    const path = u.pathname.replace(/\/$/, "");
    const segments = path.split("/").filter(Boolean);
    if (segments.length > 0) {
      segments[segments.length - 1] = "findu-user";
      u.pathname = "/" + segments.join("/");
    } else {
      u.pathname = "/findu-user";
    }
    return stripTrailingSlash(u.toString());
  } catch {
    return apiBase;
  }
}

/**
 * Derive the a2hmarket-front base URL from a concierge `apiBase`. Strips the
 * `api.` / `api-staging.` hostname prefix. Known mappings:
 *   api.a2hmarket.ai         → a2hmarket.ai
 *   api-staging.a2hmarket.ai → demo.a2hmarket.ai   (staging front CloudFront)
 * For anything else (local dev, custom hosts), callers should set
 * `A2H_FRONT_BASE` explicitly — we fall back to localhost:5173.
 */
function deriveFrontBase(apiBase: string): string {
  try {
    const u = new URL(apiBase);
    const host = u.hostname;
    if (host === "api.a2hmarket.ai") {
      return "https://a2hmarket.ai";
    }
    if (host === "api-staging.a2hmarket.ai") {
      // NOTE: staging frontend is `demo.a2hmarket.ai` per findu-docs
      // (findu-docs/testing/staging-api-test.md); verified against
      // a2hmarket-front CloudFront mapping.
      return "https://demo.a2hmarket.ai";
    }
    // Local dev / unknown host: default to vite dev server; user should set
    // A2H_FRONT_BASE explicitly if this isn't right.
    return "http://localhost:5173";
  } catch {
    return "http://localhost:5173";
  }
}

/**
 * Resolve all three base URLs (concierge / findu-user / a2hmarket-front) in
 * one shot. Precedence (per variable):
 *   1. Explicit env override (A2H_API_BASE / A2H_USER_BASE / A2H_FRONT_BASE)
 *   2. `--staging` CLI flag → staging defaults
 *   3. prod defaults
 *
 * `A2H_USER_BASE` / `A2H_FRONT_BASE` fall back to values *derived from*
 * `apiBase` so setting only `A2H_API_BASE=http://localhost:…` still routes
 * everything to the same host by default.
 */
export function resolveUrls(): A2hUrls {
  const envApi = process.env.A2H_API_BASE;
  const isStaging = process.argv.includes("--staging");

  let apiBase: string;
  if (envApi) {
    apiBase = stripTrailingSlash(envApi);
  } else {
    apiBase = isStaging
      ? "https://api-staging.a2hmarket.ai/a2hmarket-concierge"
      : "https://api.a2hmarket.ai/a2hmarket-concierge";
  }

  const envUser = process.env.A2H_USER_BASE;
  const userBase = envUser ? stripTrailingSlash(envUser) : deriveUserBase(apiBase);

  const envFront = process.env.A2H_FRONT_BASE;
  const frontBase = envFront
    ? stripTrailingSlash(envFront)
    : deriveFrontBase(apiBase);

  return { apiBase, userBase, frontBase };
}

/**
 * Backward-compat alias. Returns just the concierge base URL. Existing
 * callers (`api-client`, `event-stream`, `server`) continue to work
 * unchanged.
 */
export function resolveApiBase(): string {
  return resolveUrls().apiBase;
}
