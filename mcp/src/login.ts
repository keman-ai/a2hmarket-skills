import { request } from "undici";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import open from "open";

import { credDir, credPath, resolveUrls } from "./config.js";

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
 * State persisted between `start` and `finish` subcommands. Lives in
 * `${A2H_HOME}/login-pending.json` — same dir as credentials.json.
 *
 * The two-step flow exists for hosts whose bash exec yields after a short
 * timeout (MaxClaw yields at 30s) and can't keep a 5-minute blocking command
 * alive. `start` writes this file and exits, `finish` reads + polls a few
 * times and exits with a status code. Agents loop `finish` until success.
 */
interface LoginPending {
  code: string;
  url: string;
  pollUrl: string;
  createdAt: string;
}

/** Pending logins older than this (10 min) are considered stale. */
const PENDING_TTL_MS = 10 * 60 * 1000;

const POLL_EVERY_MS = 5000;
/** Default poll attempts for the legacy (blocking) flow. 60 × 5s = 5 min. */
const LEGACY_MAX_ATTEMPTS = 60;
/** Default poll attempts for `finish` — short window so agents in yield-prone
 * envs (MaxClaw yields at 30s) can call it inside one bash exec.
 * 5 × 5s = 25s. */
const FINISH_DEFAULT_MAX_ATTEMPTS = 5;

/** Process exit codes for the `finish` subcommand. Documented in SKILL.md. */
export const ExitCode = {
  /** patToken received and saved to credentials.json. */
  Success: 0,
  /** Real error (network 5xx, malformed config, etc.). stderr has detail. */
  Error: 1,
  /** Code still pending — agent should retry `finish` after a short wait. */
  Pending: 2,
  /** Pending file is stale (older than TTL) or absent. Agent should run `start`. */
  Stale: 3,
} as const;

function pendingPath(): string {
  return join(credDir(), "login-pending.json");
}

/** Atomic-write helper: same-dir tmp file → fsync → rename. Mode 0600. */
function atomicWriteJson(target: string, obj: unknown): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(obj, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, target);
}

function readPending(): LoginPending | null {
  const path = pendingPath();
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LoginPending>;
    if (
      typeof parsed.code !== "string" ||
      typeof parsed.url !== "string" ||
      typeof parsed.pollUrl !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return parsed as LoginPending;
  } catch {
    return null;
  }
}

function isPendingStale(p: LoginPending): boolean {
  const age = Date.now() - Date.parse(p.createdAt);
  return !Number.isFinite(age) || age > PENDING_TTL_MS;
}

function clearPending(): void {
  const path = pendingPath();
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* best-effort */
    }
  }
}

/** Produce a fresh code + URLs from current resolveUrls(). */
function mintLoginPending(): LoginPending {
  const { userBase, frontBase } = resolveUrls();
  const code = `SKILL-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const url = `${frontBase}/authcode?code=${encodeURIComponent(code)}`;
  const pollUrl = `${userBase}/api/v1/public/user/agent/auth?code=${encodeURIComponent(code)}`;
  return { code, url, pollUrl, createdAt: new Date().toISOString() };
}

/**
 * One round-trip to the public authcode-fetch endpoint. Returns:
 *   - `{ patToken, agentId, tokenName }` when the user has confirmed
 *   - `null` when the response is well-formed but pending (no patToken yet)
 *     OR when the response is non-2xx (we treat backend hiccups as pending
 *     so blue-green deploys / brief 5xx don't kill the login flow)
 *   - throws on parse error (caller decides whether to retry)
 */
async function pollOnce(
  pollUrl: string,
): Promise<{ patToken: string; agentId: string; tokenName: string } | null> {
  const { statusCode, body } = await request(pollUrl, {
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
  const text = await body.text();
  if (statusCode !== 200) {
    return null;
  }
  let parsed: ApiResponseEnvelope;
  try {
    parsed = JSON.parse(text) as ApiResponseEnvelope;
  } catch {
    throw new Error(`malformed JSON from poll endpoint: ${text.slice(0, 200)}`);
  }
  const data = parsed?.data;
  if (!data || !data.patToken) {
    return null;
  }
  const agentId = typeof data.agentId === "string" ? data.agentId : "";
  const tokenName =
    typeof data.patTokenName === "string" && data.patTokenName.length > 0
      ? data.patTokenName
      : "A2H Skill (authcode)";
  return { patToken: data.patToken, agentId, tokenName };
}

function saveCredentials(c: {
  patToken: string;
  agentId: string;
  tokenName: string;
}): void {
  const path = credPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        token: c.patToken,
        agentId: c.agentId,
        tokenName: c.tokenName,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows may not support chmod; best-effort.
  }
}

/**
 * `a2h-mcp-login start` — non-blocking. Mints a fresh code, writes the
 * pending state file, prints the authorize URL to stderr, optionally opens a
 * browser, and returns. Exit code 0.
 *
 * Use case: agents whose bash exec yields after a short timeout (MaxClaw,
 * other managed envs). `start` returns in <1s so the bash exec succeeds, the
 * agent shows the URL to the user, then later runs `finish` to claim the
 * resulting PAT.
 */
export async function startCmd(): Promise<void> {
  const pending = mintLoginPending();
  atomicWriteJson(pendingPath(), pending);

  process.stderr.write(
    `\nOpen this URL in any browser to authorize (the code is single-use, valid 10 min):\n  ${pending.url}\n\n`,
  );
  try {
    await open(pending.url);
  } catch {
    // headless / no browser; URL above is the fallback
  }
  process.stderr.write(
    `[a2h-mcp-login] pending authorization registered at ${pendingPath()}\n` +
      `[a2h-mcp-login] this is a pull flow — no local port, no inbound connection.\n` +
      `[a2h-mcp-login] after the user clicks "Confirm authorize" in the browser,\n` +
      `[a2h-mcp-login] run \`a2h-mcp-login finish\` to claim the PAT.\n`,
  );
}

/**
 * `a2h-mcp-login finish [--max-attempts N]` — short-window poller.
 * Reads `login-pending.json`, polls the auth endpoint up to N times (5 by
 * default = ~25s of wall clock), and returns one of:
 *
 *   0  Success: PAT received + saved to credentials.json + pending cleared
 *   2  Pending: code still valid, agent should call `finish` again after a wait
 *   3  Stale: no pending file, or pending older than 10 min — run `start` again
 *   1  Error: real failure (malformed pending, etc.); stderr has detail
 *
 * Agents loop on exit 2 and re-mint on exit 3.
 */
export async function finishCmd(maxAttempts: number): Promise<number> {
  const pending = readPending();
  if (!pending) {
    process.stderr.write(
      `[a2h-mcp-login] no pending login. Run \`a2h-mcp-login start\` first.\n`,
    );
    return ExitCode.Stale;
  }
  if (isPendingStale(pending)) {
    process.stderr.write(
      `[a2h-mcp-login] pending login is stale (>10 min old). Run \`a2h-mcp-login start\` to mint a fresh code.\n`,
    );
    clearPending();
    return ExitCode.Stale;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    }
    let result: Awaited<ReturnType<typeof pollOnce>>;
    try {
      result = await pollOnce(pending.pollUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`[a2h-mcp-login] poll error (will retry): ${msg}\n`);
      continue;
    }
    if (result) {
      saveCredentials(result);
      clearPending();
      process.stderr.write(
        `\nLogged in as ${result.agentId || result.tokenName}\n` +
          `Credentials saved to ${credPath()}\n`,
      );
      return ExitCode.Success;
    }
  }

  process.stderr.write(
    `[a2h-mcp-login] not authorized yet after ${maxAttempts} polls (~${(maxAttempts * POLL_EVERY_MS) / 1000}s).\n` +
      `[a2h-mcp-login] make sure the user has clicked "Confirm authorize" in the browser, then run \`a2h-mcp-login finish\` again.\n`,
  );
  return ExitCode.Pending;
}

/**
 * `a2h-mcp-login` (no arg) — legacy blocking flow. Mints a code, opens the
 * browser, polls for up to 5 minutes, exits 0 on success or 1 on timeout.
 * Backwards-compatible with all existing callers. Use this in environments
 * where blocking 5 min is fine (regular terminals, SSH, Claude Code, Cursor).
 *
 * Agents in yield-prone envs (MaxClaw) should use `start` + `finish` instead.
 */
export async function main(): Promise<void> {
  const pending = mintLoginPending();
  atomicWriteJson(pendingPath(), pending);

  process.stderr.write(
    `\nOpen this URL in your browser to authorize (the code is single-use):\n  ${pending.url}\n\n`,
  );
  try {
    await open(pending.url);
  } catch {
    // headless / no browser; user will copy-paste
  }
  process.stderr.write(
    `(If your browser didn't open here, copy the URL above and open it on any device.)\n` +
      `[a2h-mcp-login] polling backend every 5s for up to 5 min — no local port is opened.\n\n`,
  );

  for (let attempt = 0; attempt < LEGACY_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
    try {
      const result = await pollOnce(pending.pollUrl);
      if (result) {
        saveCredentials(result);
        clearPending();
        process.stderr.write(
          `\nLogged in as ${result.agentId || result.tokenName}\n` +
            `Credentials saved to ${credPath()}\n` +
            `Restart your MCP host (or run \`a2h-mcp-doctor\`) to verify.\n`,
        );
        return;
      }
    } catch {
      // transport error → keep polling silently
    }
  }
  clearPending();
  process.stderr.write(
    `\nTimed out waiting for browser confirmation (5 min).\n` +
      `If you authorized after the timeout, the code is now stale —\n` +
      `re-run \`a2h-mcp-login\` (or \`a2h-mcp-login start\` for the two-step flow).\n`,
  );
  process.exit(1);
}

/**
 * Entry point invoked by bin/a2h-mcp-login.js. Dispatches on argv:
 *   a2h-mcp-login              → main() (legacy blocking)
 *   a2h-mcp-login start        → startCmd()
 *   a2h-mcp-login finish       → finishCmd(default)
 *   a2h-mcp-login finish --max-attempts N → finishCmd(N)
 *   a2h-mcp-login --help       → help text
 */
export async function run(argv: string[]): Promise<void> {
  const sub = argv[0];

  if (sub === "-h" || sub === "--help") {
    process.stdout.write(
      `Usage: a2h-mcp-login [start|finish [--max-attempts N]]\n\n` +
        `  (no args)              5-min blocking poll; exits 0 on success.\n` +
        `  start                  mint code + URL, exit immediately.\n` +
        `  finish                 poll the pending code briefly. Exit codes:\n` +
        `                           0 success, 2 still pending, 3 stale, 1 error.\n` +
        `  finish --max-attempts N\n` +
        `                         override poll count (default ${FINISH_DEFAULT_MAX_ATTEMPTS} = ~${(FINISH_DEFAULT_MAX_ATTEMPTS * POLL_EVERY_MS) / 1000}s).\n`,
    );
    return;
  }
  if (sub === "start") {
    await startCmd();
    return;
  }
  if (sub === "finish") {
    let maxAttempts = FINISH_DEFAULT_MAX_ATTEMPTS;
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === "--max-attempts") {
        const n = Number.parseInt(argv[i + 1] ?? "", 10);
        if (Number.isInteger(n) && n > 0) {
          maxAttempts = n;
        }
        i++;
      }
    }
    const code = await finishCmd(maxAttempts);
    process.exit(code);
  }
  // No subcommand (or unrecognized) → legacy blocking flow.
  await main();
}
