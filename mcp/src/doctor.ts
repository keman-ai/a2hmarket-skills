import { request } from "undici";
import { stdout } from "node:process";

import { loadCredentials, resolveApiBase } from "./config.js";
import { detectInstalledHosts, isHostRunning } from "./hosts/detect.js";
import { HOSTS, SERVER_NAME, findHost } from "./hosts/registry.js";
import {
  isInstalledSubprocess,
} from "./hosts/adapters/subprocess.js";
import { readDirectJsonEntry } from "./hosts/adapters/direct-json.js";
import { isInstalledDirectToml } from "./hosts/adapters/direct-toml.js";
import type { DoctorFinding, HostSpec } from "./hosts/types.js";
import { existsSync } from "node:fs";

interface CliOptions {
  hostId?: string;
}

function parseArgv(argv: string[]): CliOptions {
  const opts: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") {
      opts.hostId = argv[++i];
    } else if (a?.startsWith("--host=")) {
      opts.hostId = a.slice("--host=".length);
    } else if (a === "-h" || a === "--help") {
      stdout.write(
        `Usage: a2h-mcp-doctor [--host <id>]\n\nVerifies the @a2hmarket/a2h-mcp install on this machine.\n`,
      );
      process.exit(0);
    } else if (a !== undefined) {
      throw new Error(`unknown option: ${a}`);
    }
  }
  return opts;
}

async function checkCredentials(): Promise<DoctorFinding[]> {
  const creds = loadCredentials();
  if (!creds) {
    return [
      {
        level: "error",
        scope: "credentials",
        message: "No PAT found (~/.a2h/credentials.json missing and A2H_PAT not set). Run: a2h-mcp-login",
      },
    ];
  }
  if (!creds.token.startsWith("a2h_pat_")) {
    return [
      {
        level: "warn",
        scope: "credentials",
        message: `Token doesn't look like an A2H PAT (expected a2h_pat_… prefix). Got: ${creds.token.slice(0, 12)}…`,
      },
    ];
  }
  return [
    {
      level: "ok",
      scope: "credentials",
      message: `PAT loaded (${creds.agentId || creds.tokenName || "unnamed"}).`,
    },
  ];
}

/**
 * Best-effort PAT validation. Calls a non-mutating endpoint on the
 * concierge backend; any 2xx is treated as valid. We do NOT make this a
 * blocker for doctor passing — concierge could be down for unrelated
 * reasons, in which case we want the rest of the report to still surface.
 */
async function checkApi(): Promise<DoctorFinding[]> {
  const creds = loadCredentials();
  if (!creds) {
    return [];
  }
  const base = resolveApiBase();
  // Probe a benign auth-required endpoint. We try `/mcp/me` first (matches
  // existing get_user_info path on concierge); if 404 we fall through to
  // `/api/v1/mcp/me`. Any 2xx = ok.
  const candidates = [
    `${base}/mcp/me`,
    `${base}/api/v1/mcp/me`,
  ];
  let lastError: string | undefined;
  for (const url of candidates) {
    try {
      const { statusCode, body } = await request(url, {
        method: "GET",
        headers: { authorization: `Bearer ${creds.token}` },
        headersTimeout: 5_000,
        bodyTimeout: 5_000,
      });
      // Drain body so undici doesn't warn about leaks.
      await body.text();
      if (statusCode >= 200 && statusCode < 300) {
        return [{ level: "ok", scope: "api", message: `${url} → ${statusCode}` }];
      }
      if (statusCode === 401 || statusCode === 403) {
        return [
          {
            level: "error",
            scope: "api",
            message: `PAT rejected by ${url} (${statusCode}). Re-run a2h-mcp-login.`,
          },
        ];
      }
      lastError = `${url} → ${statusCode}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return [
    {
      level: "warn",
      scope: "api",
      message: `Couldn't validate PAT against backend (${lastError ?? "unknown"}). PAT may still be valid.`,
    },
  ];
}

function checkHost(host: HostSpec): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const scope = `host:${host.id}`;

  let installed = false;
  let entryPath: string | undefined;
  if (host.strategy === "direct-json") {
    const entry = readDirectJsonEntry(host, SERVER_NAME);
    installed = entry !== undefined;
    if (installed && entry) {
      entryPath = entry.args[0];
    }
  } else if (host.strategy === "direct-toml") {
    installed = isInstalledDirectToml(host, SERVER_NAME);
  } else if (host.strategy === "subprocess") {
    installed = isInstalledSubprocess(host, SERVER_NAME);
  }

  if (!installed) {
    findings.push({
      level: "warn",
      scope,
      message: `${host.displayName}: a2h not registered. Run: a2h-mcp-install --host ${host.id}`,
    });
    return findings;
  }

  findings.push({ level: "ok", scope, message: `${host.displayName}: a2h registered.` });

  if (entryPath && !existsSync(entryPath)) {
    findings.push({
      level: "error",
      scope,
      message: `${host.displayName}: configured server path does not exist: ${entryPath}. Run: npm install -g @a2hmarket/a2h-mcp`,
    });
  }

  if (isHostRunning(host)) {
    findings.push({
      level: "warn",
      scope,
      message: `${host.displayName}: currently running. To activate the new entry: ${host.reload.instruction}`,
    });
  }

  return findings;
}

function symbol(level: DoctorFinding["level"]): string {
  switch (level) {
    case "ok": return "✓";
    case "warn": return "⚠";
    case "error": return "✗";
  }
}

export async function main(argv: string[]): Promise<void> {
  const opts = parseArgv(argv);

  const findings: DoctorFinding[] = [];
  findings.push(...(await checkCredentials()));
  findings.push(...(await checkApi()));

  const hosts = opts.hostId
    ? [findHost(opts.hostId)].filter((h): h is HostSpec => !!h)
    : detectInstalledHosts(HOSTS);
  if (opts.hostId && hosts.length === 0) {
    findings.push({
      level: "error",
      scope: "host",
      message: `unknown host id: ${opts.hostId}`,
    });
  }
  for (const h of hosts) {
    findings.push(...checkHost(h));
  }

  for (const f of findings) {
    stdout.write(`${symbol(f.level)} [${f.scope}] ${f.message}\n`);
  }

  const errored = findings.some((f) => f.level === "error");
  const warned = findings.some((f) => f.level === "warn");
  stdout.write("\n");
  if (errored) {
    stdout.write("doctor: errors found.\n");
    process.exit(1);
  } else if (warned) {
    stdout.write("doctor: passed with warnings.\n");
  } else {
    stdout.write("doctor: all good.\n");
  }
}
