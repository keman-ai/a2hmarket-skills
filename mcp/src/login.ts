import { request } from "undici";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import open from "open";

import { resolveUrls, credPath } from "./config.js";

/**
 * UserAgentDTO shape returned by findu-user's public authcode-fetch endpoint.
 * Only the fields we actually consume are listed; everything else is ignored.
 */
interface UserAgentDTO {
  userId?: string;
  agentId?: string;
  secret?: string;
  patToken?: string;
  patTokenName?: string;
  [key: string]: unknown;
}

interface ApiResponseEnvelope {
  code?: string | number;
  message?: string;
  data?: UserAgentDTO | null;
}

/**
 * AuthCode login flow (v2):
 *
 *   1. Locally generate a code `SKILL-<hex>`.
 *   2. Open `${frontBase}/authcode?code=…` — the user logs in to A2H Market
 *      on the web front-end and clicks "confirm authorize". The front-end
 *      calls `PUT /findu-user/api/v1/user/agent/auth?code=…` on their behalf.
 *   3. This process polls the public fetch endpoint
 *      `GET /findu-user/api/v1/public/user/agent/auth?code=…` every 5s.
 *   4. When `data.patToken` is non-null we write `~/.a2h/credentials.json`
 *      (0600) and exit.
 *
 * Timeout: 60 × 5s = 5 minutes, then `process.exit(1)`.
 */
export async function main(): Promise<void> {
  const { userBase, frontBase } = resolveUrls();
  const code = `SKILL-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const verifyUrl = `${frontBase}/authcode?code=${encodeURIComponent(code)}`;

  process.stderr.write(
    `\nOpen this URL in your browser to authorize:\n  ${verifyUrl}\n\n`,
  );
  try {
    await open(verifyUrl);
  } catch {
    // headless / no browser; user will copy-paste
  }
  // Even when `open` resolves successfully, some environments (SSH / headless
  // servers / WSL without browser integration) don't actually pop a window.
  // Print an explicit hint so the user knows to copy the URL above.
  process.stderr.write(
    `(If your browser didn't open, copy the URL above.)\n\n`,
  );

  const pollEveryMs = 5000;
  const maxAttempts = 60; // 5 minutes
  const pollUrl = `${userBase}/api/v1/public/user/agent/auth?code=${encodeURIComponent(code)}`;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollEveryMs));
    try {
      const { statusCode, body } = await request(pollUrl, {
        headersTimeout: 10_000,
        bodyTimeout: 10_000,
      });
      const text = await body.text();
      if (statusCode !== 200) {
        // 404 / 5xx / anything non-2xx → keep polling silently; the authcode
        // may not yet exist, or findu-user may be restarting.
        continue;
      }
      let parsed: ApiResponseEnvelope;
      try {
        parsed = JSON.parse(text) as ApiResponseEnvelope;
      } catch {
        continue;
      }
      const data = parsed?.data;
      if (!data || !data.patToken) {
        // Not yet confirmed by user, OR an old openclaw code path populated
        // `data` without a patToken. Either way, keep polling.
        continue;
      }

      const agentId = typeof data.agentId === "string" ? data.agentId : "";
      const tokenName =
        typeof data.patTokenName === "string" && data.patTokenName.length > 0
          ? data.patTokenName
          : "A2H Skill (authcode)";
      saveCredentials({
        token: data.patToken,
        agentId,
        tokenName,
        createdAt: new Date().toISOString(),
      });
      process.stderr.write(
        `\nLogged in as ${agentId || tokenName}\n` +
          `Credentials saved to ${credPath()}\n` +
          `Restart your agent (Claude Code / Openclaw / Hermes) to activate the a2h MCP server.\n`,
      );
      return;
    } catch {
      // network error / parse error / undici timeout → keep polling.
    }
  }
  process.stderr.write(
    `\nTimed out waiting for browser confirmation (5 min).\n`,
  );
  process.exit(1);
}

function saveCredentials(c: {
  token: string;
  agentId: string;
  tokenName: string;
  createdAt: string;
}): void {
  const path = credPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(c, null, 2));
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may not support chmod; best-effort
  }
}
