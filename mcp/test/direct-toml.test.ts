import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installDirectToml,
  isInstalledDirectToml,
} from "../src/hosts/adapters/direct-toml.js";
import type { HostSpec, McpServerSpec } from "../src/hosts/types.js";

let tmp: string;

const SPEC: McpServerSpec = {
  command: "node",
  args: ["/abs/dist/index.js"],
  env: { A2H_API_BASE: "https://api.example", A2H_PAT: "pending" },
};

function host(): HostSpec {
  return {
    id: "test-toml",
    displayName: "Test TOML",
    vendor: "other",
    strategy: "direct-toml",
    status: "stable",
    configPath: { darwin: join(tmp, "config.toml") },
    mcpKeyPath: ["mcp_servers"],
    detect: { configExists: true },
    process: {},
    reload: { kind: "session-restart", instruction: "" },
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "direct-toml-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("installDirectToml", () => {
  it("creates fresh file with mcp_servers.<name> table", () => {
    const out = installDirectToml(host(), "a2h", SPEC);
    const text = readFileSync(out.path!, "utf-8");
    expect(text).toContain("[mcp_servers.a2h]");
    expect(text).toContain('command = "node"');
    expect(text).toContain('args = ["/abs/dist/index.js"]');
    expect(text).toContain("[mcp_servers.a2h.env]");
    expect(text).toContain('A2H_API_BASE = "https://api.example"');
  });

  it("preserves prior unrelated content", () => {
    const path = join(tmp, "config.toml");
    writeFileSync(path, '[profile]\nname = "default"\n\n[mcp_servers.other]\ncommand = "x"\n');
    installDirectToml(host(), "a2h", SPEC);
    const text = readFileSync(path, "utf-8");
    expect(text).toContain("[profile]");
    expect(text).toContain('name = "default"');
    expect(text).toContain("[mcp_servers.other]");
    expect(text).toContain("[mcp_servers.a2h]");
  });

  it("re-installing replaces the prior entry idempotently", () => {
    const h = host();
    installDirectToml(h, "a2h", SPEC);
    const updated: McpServerSpec = { ...SPEC, env: { ...SPEC.env, A2H_PAT: "a2h_pat_new" } };
    installDirectToml(h, "a2h", updated);
    const text = readFileSync(h.configPath!.darwin, "utf-8");
    // The new PAT must be present and the prior one must not.
    expect(text).toContain('A2H_PAT = "a2h_pat_new"');
    expect(text).not.toContain('A2H_PAT = "pending"');
    // Only one [mcp_servers.a2h] header.
    const headerCount = (text.match(/\[mcp_servers\.a2h\]/g) ?? []).length;
    expect(headerCount).toBe(1);
  });

  it("isInstalledDirectToml detects presence", () => {
    const h = host();
    expect(isInstalledDirectToml(h, "a2h")).toBe(false);
    installDirectToml(h, "a2h", SPEC);
    expect(isInstalledDirectToml(h, "a2h")).toBe(true);
  });
});
