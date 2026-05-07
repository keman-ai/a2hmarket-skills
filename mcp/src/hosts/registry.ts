import { homedir } from "node:os";
import { join } from "node:path";

import type { HostSpec, McpServerSpec } from "./types.js";

const HOME = homedir();

/**
 * The MCP server entry name we standardize on across hosts. Lower-case, no
 * spaces — every host CLI / config format accepts this.
 */
export const SERVER_NAME = "a2h";

function jsonForCli(spec: McpServerSpec): string {
  return JSON.stringify({ command: spec.command, args: spec.args, env: spec.env });
}

/**
 * V1 host registry. Stable = we've verified locally. Experimental = data is
 * here so `--host` can target it, but no release-blocker.
 *
 * To add a host: add a row. If its file format is JSON or TOML, you also
 * need adapter coverage. Subprocess hosts are zero-code-add as long as the
 * host's CLI follows a sane add/list/remove pattern.
 */
export const HOSTS: HostSpec[] = [
  // ─── Anthropic ─────────────────────────────────────────────────────────
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    vendor: "anthropic",
    strategy: "direct-json",
    status: "stable",
    configPath: {
      darwin: join(HOME, "Library/Application Support/Claude/claude_desktop_config.json"),
      linux: join(HOME, ".config/Claude/claude_desktop_config.json"),
      win32: join(HOME, "AppData/Roaming/Claude/claude_desktop_config.json"),
    },
    mcpKeyPath: ["mcpServers"],
    detect: { configExists: true },
    process: {
      // pgrep treats this as an extended regex on both macOS and Linux
      // (procps 3.3+). macOS literal first, then Linux AppImage variant.
      pgrepPattern: "Claude\\.app/Contents/MacOS/Claude|claude-desktop",
      quitInstruction: "Cmd+Q in the Claude menu (closing the window is not enough)",
    },
    reload: {
      kind: "hard-restart",
      instruction: "Quit Claude Desktop completely (Cmd+Q) and reopen it.",
    },
  },
  {
    id: "claude-code",
    displayName: "Claude Code (CLI)",
    vendor: "anthropic",
    strategy: "subprocess",
    status: "stable",
    cli: {
      command: "claude",
      addArgs: (name, spec) => ["mcp", "add-json", "--scope", "user", name, jsonForCli(spec)],
      listArgs: () => ["mcp", "list"],
      removeArgs: (name) => ["mcp", "remove", name],
    },
    detect: { binOnPath: "claude" },
    process: {},
    reload: {
      kind: "session-restart",
      instruction: "Start a fresh `claude` session (existing sessions keep the old config).",
    },
  },

  // ─── OpenAI ────────────────────────────────────────────────────────────
  {
    id: "codex-cli",
    displayName: "Codex CLI",
    vendor: "openai",
    strategy: "direct-toml",
    status: "experimental",
    configPath: { darwin: join(HOME, ".codex/config.toml") },
    mcpKeyPath: ["mcp_servers"],
    detect: { configExists: true },
    process: {},
    reload: {
      kind: "session-restart",
      instruction: "Start a fresh `codex` session.",
    },
  },

  // ─── MiniMax ───────────────────────────────────────────────────────────
  {
    id: "openclaw",
    displayName: "OpenClaw",
    vendor: "minimax",
    strategy: "subprocess",
    status: "stable",
    cli: {
      command: "openclaw",
      addArgs: (name, spec) => ["mcp", "set", name, jsonForCli(spec)],
      listArgs: () => ["mcp", "list"],
      removeArgs: (name) => ["mcp", "unset", name],
    },
    detect: { binOnPath: "openclaw" },
    process: { pgrepPattern: "openclaw" },
    reload: {
      kind: "soft-reload",
      instruction: "If OpenClaw is running, run `openclaw mcp list` to confirm a2h appears, then reload from the menu.",
    },
  },
  {
    id: "maxclaw",
    displayName: "MaxClaw (MiniMax-hosted OpenClaw)",
    vendor: "minimax",
    strategy: "subprocess",
    status: "experimental",
    cli: {
      command: "maxclaw",
      addArgs: (name, spec) => ["mcp", "set", name, jsonForCli(spec)],
      listArgs: () => ["mcp", "list"],
      removeArgs: (name) => ["mcp", "unset", name],
    },
    detect: { binOnPath: "maxclaw" },
    process: { pgrepPattern: "maxclaw" },
    reload: {
      kind: "soft-reload",
      instruction: "Reload MaxClaw from its menu after install.",
    },
  },
  {
    id: "hermes",
    displayName: "Hermes",
    vendor: "minimax",
    strategy: "subprocess",
    status: "stable",
    cli: {
      command: "hermes",
      addArgs: (name, spec) => {
        const argv = ["mcp", "add", "--command", spec.command];
        if (spec.args.length > 0) {
          argv.push("--args", ...spec.args);
        }
        for (const [k, v] of Object.entries(spec.env)) {
          argv.push("--env", `${k}=${v}`);
        }
        argv.push(name);
        return argv;
      },
      listArgs: () => ["mcp", "list"],
      removeArgs: (name) => ["mcp", "remove", name],
    },
    detect: { binOnPath: "hermes" },
    process: { pgrepPattern: "hermes" },
    reload: {
      kind: "soft-reload",
      instruction: "Reload Hermes via `hermes mcp list` to confirm and restart your session.",
    },
  },
  {
    id: "maxhermes",
    displayName: "MaxHermes",
    vendor: "minimax",
    strategy: "subprocess",
    status: "experimental",
    cli: {
      command: "maxhermes",
      addArgs: (name, spec) => {
        const argv = ["mcp", "add", "--command", spec.command];
        if (spec.args.length > 0) {
          argv.push("--args", ...spec.args);
        }
        for (const [k, v] of Object.entries(spec.env)) {
          argv.push("--env", `${k}=${v}`);
        }
        argv.push(name);
        return argv;
      },
      listArgs: () => ["mcp", "list"],
      removeArgs: (name) => ["mcp", "remove", name],
    },
    detect: { binOnPath: "maxhermes" },
    process: { pgrepPattern: "maxhermes" },
    reload: {
      kind: "soft-reload",
      instruction: "Reload MaxHermes after install.",
    },
  },

  // ─── Generic / managed envs ────────────────────────────────────────────
  {
    // mcporter is a vendor-neutral MCP CLI that writes to a config some hosts
    // (notably MaxClaw managed env, and OpenClaw versions older than 2026.4
    // where `openclaw mcp` doesn't exist yet) consume. Use this when:
    //   - the host's own CLI rejects MCP edits (managed env schema lock)
    //   - the host's CLI predates MCP support (OpenClaw < 2026.4)
    //   - you're on a generic Linux box with multiple hosts and want one
    //     mcporter config to feed all of them
    // We pass --scope home so the entry lands in ~/.mcporter/mcporter.json
    // and applies system-wide; --scope project would write to cwd which is
    // unhelpful for an unattended CLI install.
    id: "mcporter",
    displayName: "mcporter (generic MCP CLI)",
    vendor: "other",
    strategy: "subprocess",
    status: "stable",
    cli: {
      command: "mcporter",
      addArgs: (name, spec) => {
        // mcporter's commander parser treats `--scope` as a flag only AFTER
        // the positional <name>. Putting it before causes commander to fall
        // through to positional and mis-bind name=<--scope>, command=<home>,
        // breaking the entry entirely. Always place name first.
        const argv = ["config", "add", name, "--command", spec.command];
        for (const a of spec.args) {
          argv.push("--arg", a);
        }
        for (const [k, v] of Object.entries(spec.env)) {
          argv.push("--env", `${k}=${v}`);
        }
        // --scope home so we write to ~/.mcporter/mcporter.json (system),
        // not cwd's ./config/mcporter.json (project default).
        argv.push("--scope", "home");
        return argv;
      },
      listArgs: () => ["config", "list", "--scope", "home"],
      removeArgs: (name) => ["config", "remove", name],
    },
    detect: { binOnPath: "mcporter" },
    process: {},
    reload: {
      kind: "soft-reload",
      instruction: "Hosts that consume mcporter (MaxClaw, recent OpenClaw, …) will pick up the new entry on next chat session.",
    },
  },

  // ─── Other ─────────────────────────────────────────────────────────────
  {
    id: "cursor",
    displayName: "Cursor",
    vendor: "other",
    strategy: "direct-json",
    status: "stable",
    configPath: {
      darwin: join(HOME, ".cursor/mcp.json"),
      linux: join(HOME, ".cursor/mcp.json"),
      win32: join(HOME, ".cursor/mcp.json"),
    },
    mcpKeyPath: ["mcpServers"],
    detect: { configExists: true },
    process: {
      // macOS literal first, then Linux variants (Cursor ships as
      // electron AppImage / extracted to a path containing `cursor`).
      pgrepPattern: "Cursor\\.app/Contents/MacOS/Cursor|/usr/share/cursor/cursor|cursor\\.AppImage",
      quitInstruction: "Quit Cursor completely (Cmd+Q on macOS, Quit from menu on Linux).",
    },
    reload: {
      kind: "hard-restart",
      instruction: "Quit Cursor (Cmd+Q) and reopen it. Or toggle MCP off/on in Settings → MCP.",
    },
  },
];

/** Look up a host by id; returns undefined if unknown. */
export function findHost(id: string): HostSpec | undefined {
  return HOSTS.find((h) => h.id === id);
}

/** Stable hosts only. */
export function stableHosts(): HostSpec[] {
  return HOSTS.filter((h) => h.status === "stable");
}

/**
 * Vendor-aware sort: anthropic first (most common), minimax next, others
 * last. Within a vendor, stable before experimental, then alphabetical.
 */
export function sortHosts(hosts: HostSpec[]): HostSpec[] {
  const vendorRank: Record<HostSpec["vendor"], number> = {
    anthropic: 0,
    minimax: 1,
    openai: 2,
    other: 3,
  };
  return [...hosts].sort((a, b) => {
    if (vendorRank[a.vendor] !== vendorRank[b.vendor]) {
      return vendorRank[a.vendor] - vendorRank[b.vendor];
    }
    if (a.status !== b.status) {
      return a.status === "stable" ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}
