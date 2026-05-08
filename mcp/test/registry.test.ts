import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HOSTS,
  SERVER_NAME,
  findHost,
  sortHosts,
  stableHosts,
} from "../src/hosts/registry.js";
import { detectRuntimeHost } from "../src/hosts/detect.js";

describe("registry", () => {
  it("server name is 'a2h'", () => {
    expect(SERVER_NAME).toBe("a2h");
  });

  it("includes the 6 stable hosts", () => {
    const ids = stableHosts().map((h) => h.id).sort();
    expect(ids).toEqual([
      "claude-code",
      "claude-desktop",
      "cursor",
      "hermes",
      "mcporter",
      "openclaw",
    ]);
  });

  it("findHost returns the right host", () => {
    expect(findHost("claude-desktop")?.vendor).toBe("anthropic");
    expect(findHost("nope")).toBeUndefined();
  });

  it("subprocess hosts have a cli spec", () => {
    for (const h of HOSTS.filter((h) => h.strategy === "subprocess")) {
      expect(h.cli).toBeDefined();
      expect(h.cli!.command).toBeTruthy();
      const argv = h.cli!.addArgs("a2h", {
        command: "node",
        args: ["/abs/dist/index.js"],
        env: { A2H_PAT: "pending" },
      });
      expect(argv.length).toBeGreaterThan(0);
    }
  });

  it("direct-* hosts have a configPath and mcpKeyPath", () => {
    for (const h of HOSTS.filter((h) => h.strategy !== "subprocess")) {
      expect(h.configPath).toBeDefined();
      expect(h.configPath!.darwin).toBeTruthy();
      expect(h.mcpKeyPath?.length).toBeGreaterThan(0);
    }
  });

  it("sortHosts puts anthropic first, then minimax, openai, other", () => {
    const sorted = sortHosts(HOSTS);
    const vendorsInOrder = sorted.map((h) => h.vendor);
    const firstAnthropic = vendorsInOrder.indexOf("anthropic");
    const firstMinimax = vendorsInOrder.indexOf("minimax");
    const firstOpenai = vendorsInOrder.indexOf("openai");
    const firstOther = vendorsInOrder.indexOf("other");
    expect(firstAnthropic).toBeLessThan(firstMinimax);
    expect(firstMinimax).toBeLessThan(firstOpenai);
    expect(firstOpenai).toBeLessThan(firstOther);
  });

  it("sortHosts orders stable before experimental within a vendor", () => {
    const sorted = sortHosts(HOSTS);
    const minimax = sorted.filter((h) => h.vendor === "minimax");
    const stableIdx = minimax.findIndex((h) => h.status === "experimental");
    // Every host before the first experimental should be stable.
    for (let i = 0; i < stableIdx; i++) {
      expect(minimax[i]!.status).toBe("stable");
    }
  });

  it("hermes addArgs builds repeatable env flags", () => {
    const hermes = findHost("hermes")!;
    const argv = hermes.cli!.addArgs("a2h", {
      command: "node",
      args: ["/x/index.js"],
      env: { A2H_API_BASE: "u", A2H_PAT: "p" },
    });
    expect(argv).toContain("--env");
    // Two env entries → --env appears twice.
    const envCount = argv.filter((s) => s === "--env").length;
    expect(envCount).toBe(2);
    expect(argv[argv.length - 1]).toBe("a2h");
  });

  it("openclaw addArgs uses 'mcp set' subcommand", () => {
    const openclaw = findHost("openclaw")!;
    const argv = openclaw.cli!.addArgs("a2h", {
      command: "node",
      args: ["/x/index.js"],
      env: {},
    });
    expect(argv[0]).toBe("mcp");
    expect(argv[1]).toBe("set");
    expect(argv[2]).toBe("a2h");
    // The fourth arg is a JSON blob containing command/args/env.
    expect(argv[3]).toContain('"command":"node"');
  });

  it("claude-code addArgs uses 'mcp add-json' with --scope user", () => {
    const claude = findHost("claude-code")!;
    const argv = claude.cli!.addArgs("a2h", {
      command: "node",
      args: ["/x/index.js"],
      env: {},
    });
    expect(argv).toContain("add-json");
    const scopeIdx = argv.indexOf("--scope");
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    expect(argv[scopeIdx + 1]).toBe("user");
  });

  it("claude-desktop pgrep matches both macOS and Linux process patterns", () => {
    const cd = findHost("claude-desktop")!;
    const pat = cd.process.pgrepPattern!;
    const re = new RegExp(pat);
    expect(
      re.test("/Applications/Claude.app/Contents/MacOS/Claude --type=renderer"),
    ).toBe(true);
    expect(re.test("/usr/bin/claude-desktop --no-sandbox")).toBe(true);
  });

  it("cursor pgrep covers Linux variants too (was macOS-only before)", () => {
    const cursor = findHost("cursor")!;
    const pat = cursor.process.pgrepPattern!;
    const re = new RegExp(pat);
    expect(
      re.test("/Applications/Cursor.app/Contents/MacOS/Cursor --type=gpu"),
    ).toBe(true);
    expect(re.test("/usr/share/cursor/cursor --no-sandbox")).toBe(true);
    expect(re.test("/tmp/cursor.AppImage --no-sandbox")).toBe(true);
    // Don't false-match unrelated processes that contain the substring "cursor".
    expect(re.test("/usr/bin/postgres -D /var/lib/pg/cursor")).toBe(false);
  });

  it("mcporter addArgs uses 'config add' with name first, repeatable --arg / --env, --scope home at end", () => {
    const mcp = findHost("mcporter")!;
    const argv = mcp.cli!.addArgs("a2h", {
      command: "node",
      args: ["/x/index.js"],
      env: { A2H_API_BASE: "u", A2H_PAT: "p" },
    });
    expect(argv.slice(0, 3)).toEqual(["config", "add", "a2h"]);
    // --scope home must come AFTER the positional <name>; placing it before
    // causes mcporter's commander parser to treat --scope as positional and
    // bind name=<--scope>, command=<home>, breaking the whole entry.
    const scopeIdx = argv.indexOf("--scope");
    expect(scopeIdx).toBeGreaterThan(2);
    expect(argv[scopeIdx + 1]).toBe("home");
    // Each stdio arg gets its own --arg flag (repeatable, NOT comma-joined).
    expect(argv.filter((s) => s === "--arg").length).toBe(1);
    expect(argv.filter((s) => s === "--env").length).toBe(2);
  });
});

describe("detectRuntimeHost (env-based runtime auto-pick)", () => {
  // Save / restore env vars we mutate so other tests don't leak state.
  const SAVED: Record<string, string | undefined> = {};
  const ENV_KEYS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CURSOR_TRACE_ID"];

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      SAVED[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (SAVED[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = SAVED[k];
      }
    }
  });

  it("returns claude-code when CLAUDECODE is set", () => {
    process.env.CLAUDECODE = "1";
    expect(detectRuntimeHost(HOSTS)?.id).toBe("claude-code");
  });

  it("returns claude-code when only CLAUDE_CODE_ENTRYPOINT is set (any-of semantics)", () => {
    process.env.CLAUDE_CODE_ENTRYPOINT = "cli";
    expect(detectRuntimeHost(HOSTS)?.id).toBe("claude-code");
  });

  it("returns cursor when CURSOR_TRACE_ID is set", () => {
    process.env.CURSOR_TRACE_ID = "abc123";
    expect(detectRuntimeHost(HOSTS)?.id).toBe("cursor");
  });

  it("returns undefined when no runtimeEnv markers are present", () => {
    expect(detectRuntimeHost(HOSTS)).toBeUndefined();
  });

  it("only honors hosts in the input list — passing only mcporter+codex should NOT match claude-code env", () => {
    process.env.CLAUDECODE = "1";
    const subset = HOSTS.filter((h) => h.id === "mcporter" || h.id === "codex-cli");
    expect(detectRuntimeHost(subset)).toBeUndefined();
  });
});
