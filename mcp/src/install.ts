import { stderr, stdout } from "node:process";

import { resolveApiBase } from "./config.js";
import { detectInstalledHosts, isHostRunning, waitForHostQuit } from "./hosts/detect.js";
import {
  HOSTS,
  SERVER_NAME,
  findHost,
  sortHosts,
} from "./hosts/registry.js";
import { installDirectJson } from "./hosts/adapters/direct-json.js";
import { installDirectToml } from "./hosts/adapters/direct-toml.js";
import { installSubprocess } from "./hosts/adapters/subprocess.js";
import type { HostSpec, InstallOutcome, McpServerSpec } from "./hosts/types.js";
import { resolveServerEntryWithOverride } from "./utils/npm-prefix.js";
import { confirm, pickOne } from "./utils/prompt.js";

interface CliOptions {
  hostId?: string;
  skipLogin: boolean;
  noOverwrite: boolean;
  yes: boolean;
}

function parseArgv(argv: string[]): CliOptions {
  const opts: CliOptions = {
    skipLogin: false,
    noOverwrite: false,
    yes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host") {
      opts.hostId = argv[++i];
    } else if (a?.startsWith("--host=")) {
      opts.hostId = a.slice("--host=".length);
    } else if (a === "--skip-login") {
      opts.skipLogin = true;
    } else if (a === "--no-overwrite") {
      opts.noOverwrite = true;
    } else if (a === "--yes" || a === "-y") {
      opts.yes = true;
    } else if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    } else if (a !== undefined) {
      stderr.write(`unknown option: ${a}\n`);
      printHelp();
      process.exit(2);
    }
  }
  return opts;
}

function printHelp(): void {
  stdout.write(`Usage: a2h-mcp-install [options]

Detects installed MCP hosts, lets you pick one, writes the @a2hmarket/a2h-mcp
server entry to its config, then runs the browser login flow.

Options:
  --host <id>      Skip detection and install for this host id
  --skip-login     Don't run the login flow after install
  --no-overwrite   If a2h is already configured, leave it alone
  -y, --yes        Don't ask "host is running, please quit" — assume the user has
  -h, --help       Show this help

Known hosts (stable): claude-desktop, claude-code, cursor, openclaw, hermes
Known hosts (experimental): codex-cli, maxclaw, maxhermes
`);
}

function describeHost(h: HostSpec): string {
  const tag = h.status === "stable" ? "" : " [experimental]";
  return `${h.displayName}${tag} (${h.id})`;
}

async function pickHost(opts: CliOptions): Promise<HostSpec> {
  if (opts.hostId) {
    const h = findHost(opts.hostId);
    if (!h) {
      throw new Error(
        `unknown host "${opts.hostId}". Try one of: ${HOSTS.map((h) => h.id).join(", ")}`,
      );
    }
    return h;
  }
  const installed = sortHosts(detectInstalledHosts(HOSTS));
  if (installed.length === 0) {
    throw new Error(
      `no MCP-capable host detected on this machine. Use --host <id> to force one.\nKnown ids: ${HOSTS.map((h) => h.id).join(", ")}`,
    );
  }
  return pickOne("Which host should I install A2H MCP into?", installed, describeHost);
}

async function ensureHostQuit(host: HostSpec, opts: CliOptions): Promise<void> {
  // Only direct-write strategies are vulnerable to "host re-serializes config
  // and strips our entry" — that bug happens because we touch the file
  // out-of-band. Subprocess strategies delegate to the host's own CLI, which
  // handles locking itself, so we don't need to (and shouldn't) ask the user
  // to quit a running daemon.
  if (host.strategy === "subprocess") {
    return;
  }
  if (!host.process.pgrepPattern) {
    return;
  }
  if (!isHostRunning(host)) {
    return;
  }
  const note = host.process.quitInstruction ?? `quit ${host.displayName}`;
  stderr.write(
    `\n${host.displayName} is currently running. Configuration writes WILL be reverted by the running app.\nPlease ${note}.\n`,
  );
  if (!opts.yes) {
    const ok = await confirm(`Continue once ${host.displayName} is fully quit?`, true);
    if (!ok) {
      throw new Error("aborted by user");
    }
  }
  stderr.write(`Waiting for ${host.displayName} to exit (60s timeout)...`);
  const cleared = await waitForHostQuit(host, 60_000, () => stderr.write("."));
  stderr.write("\n");
  if (!cleared) {
    throw new Error(
      `${host.displayName} is still running after 60s. Aborting; please quit it and rerun.`,
    );
  }
}

function buildSpec(serverEntry: string): McpServerSpec {
  return {
    command: "node",
    args: [serverEntry],
    env: {
      A2H_API_BASE: process.env.A2H_API_BASE ?? resolveApiBase(),
      A2H_PAT: "pending",
    },
  };
}

function dispatchInstall(host: HostSpec, spec: McpServerSpec, overwrite: boolean): InstallOutcome {
  switch (host.strategy) {
    case "subprocess":
      return installSubprocess(host, SERVER_NAME, spec);
    case "direct-json":
      return installDirectJson(host, SERVER_NAME, spec, { overwrite });
    case "direct-toml":
      return installDirectToml(host, SERVER_NAME, spec);
    default:
      throw new Error(`unknown strategy: ${(host as HostSpec).strategy}`);
  }
}

export async function main(argv: string[]): Promise<void> {
  const opts = parseArgv(argv);

  const host = await pickHost(opts);
  stdout.write(`\n→ host: ${describeHost(host)}\n`);

  const serverEntry = resolveServerEntryWithOverride();
  if (!serverEntry) {
    throw new Error(
      `cannot find @a2hmarket/a2h-mcp dist/index.js.\nRun: npm install -g @a2hmarket/a2h-mcp\n(then re-run this installer)`,
    );
  }
  stdout.write(`→ server path: ${serverEntry}\n`);

  await ensureHostQuit(host, opts);

  const spec = buildSpec(serverEntry);
  const outcome = dispatchInstall(host, spec, !opts.noOverwrite);
  if (outcome.path) {
    stdout.write(`→ wrote: ${outcome.path}\n`);
  }
  if (outcome.backup) {
    stdout.write(`→ backup: ${outcome.backup}\n`);
  }
  if (outcome.alreadyExisted && opts.noOverwrite) {
    stdout.write(`→ a2h entry already present, left untouched (--no-overwrite)\n`);
  } else if (outcome.alreadyExisted) {
    stdout.write(`→ replaced existing a2h entry\n`);
  }

  // Chain login. We delay-import so a stub of the login module is easy in
  // tests, and so that login's network deps don't load on `--skip-login`.
  if (!opts.skipLogin) {
    stdout.write(`\n→ launching login flow (browser)...\n`);
    const login = await import("./login.js");
    await login.main();
    // Login wrote ~/.a2h/credentials.json. The MCP server reads from env first
    // (A2H_PAT) then falls back to that file, so we don't need to backfill the
    // PAT into the host config — but for hosts that pin env at spawn time
    // (everyone), the file fallback works fine after restart.
  }

  stdout.write(`\n✓ install complete for ${host.displayName}.\n`);
  stdout.write(`Next: ${host.reload.instruction}\n`);
  stdout.write(`Verify: a2h-mcp-doctor\n`);
}
