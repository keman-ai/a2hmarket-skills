import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "install-test-"));
  originalEnv = {
    A2H_HOME: process.env.A2H_HOME,
    A2H_API_BASE: process.env.A2H_API_BASE,
    A2H_MCP_ENTRY_OVERRIDE: process.env.A2H_MCP_ENTRY_OVERRIDE,
  };
  process.env.A2H_HOME = tmp;
  process.env.A2H_API_BASE = "https://api.example/concierge";
  // Pretend the npm-installed dist file is on disk.
  const fakeEntry = join(tmp, "fake-dist-index.js");
  writeFileSync(fakeEntry, "// stub\n");
  process.env.A2H_MCP_ENTRY_OVERRIDE = fakeEntry;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  for (const k of Object.keys(originalEnv) as (keyof typeof originalEnv)[]) {
    if (originalEnv[k] === undefined) {
      delete process.env[k as string];
    } else {
      process.env[k as string] = originalEnv[k];
    }
  }
});

describe("install (direct-json path)", () => {
  it("installs to a synthetic claude-desktop config and writes correct entry", async () => {
    const cfgDir = join(tmp, "ClaudeDesktop");
    const cfgPath = join(cfgDir, "claude_desktop_config.json");
    // Pre-populate with a non-empty config to mirror real Claude Desktop.
    require("node:fs").mkdirSync(cfgDir, { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({ preferences: { theme: "x" } }));

    // Patch the registry to point claude-desktop at our tmp config and clear
    // the pgrep pattern so the test doesn't wait for the real Claude.app to
    // quit (which it never will, on a dev machine).
    const registry = await import("../src/hosts/registry.js");
    const cd = registry.findHost("claude-desktop")!;
    const originalConfig = { ...cd.configPath };
    const originalPgrep = cd.process.pgrepPattern;
    cd.configPath = { darwin: cfgPath };
    cd.process = { ...cd.process, pgrepPattern: undefined };

    try {
      // Stub out the chained login so we don't hit network or block on stdin.
      vi.doMock("../src/login.js", () => ({
        main: async () => {
          /* no-op */
        },
      }));

      const install = await import("../src/install.js");
      await install.main(["--host", "claude-desktop", "--yes", "--skip-login"]);

      const written = JSON.parse(readFileSync(cfgPath, "utf-8"));
      expect(written.preferences).toEqual({ theme: "x" });
      expect(written.mcpServers.a2h.command).toBe("node");
      expect(written.mcpServers.a2h.args[0]).toBe(
        process.env.A2H_MCP_ENTRY_OVERRIDE,
      );
      expect(written.mcpServers.a2h.env.A2H_API_BASE).toBe(
        "https://api.example/concierge",
      );
      expect(written.mcpServers.a2h.env.A2H_PAT).toBe("pending");
    } finally {
      cd.configPath = originalConfig as typeof cd.configPath;
      cd.process = { ...cd.process, pgrepPattern: originalPgrep };
    }
  });

  it("aborts if @a2hmarket/a2h-mcp not installed", async () => {
    // Point the override at a path that doesn't exist so the real
    // npm-root lookup can't accidentally find a globally-installed copy.
    process.env.A2H_MCP_ENTRY_OVERRIDE = join(tmp, "definitely-missing.js");
    const install = await import("../src/install.js");
    await expect(install.main(["--host", "cursor", "--skip-login", "--yes"])).rejects.toThrow(
      /cannot find @a2hmarket\/a2h-mcp/,
    );
  });
});
