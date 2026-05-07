import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installDirectJson,
  readDirectJsonEntry,
} from "../src/hosts/adapters/direct-json.js";
import type { HostSpec, McpServerSpec } from "../src/hosts/types.js";

let tmp: string;

const SPEC: McpServerSpec = {
  command: "node",
  args: ["/abs/dist/index.js"],
  env: { A2H_API_BASE: "https://api.example", A2H_PAT: "pending" },
};

function host(opts: { keyPath: string[]; cfgName?: string }): HostSpec {
  return {
    id: "test-host",
    displayName: "Test",
    vendor: "other",
    strategy: "direct-json",
    status: "stable",
    configPath: { darwin: join(tmp, opts.cfgName ?? "config.json") },
    mcpKeyPath: opts.keyPath,
    detect: { configExists: true },
    process: {},
    reload: { kind: "hard-restart", instruction: "" },
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "direct-json-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("installDirectJson", () => {
  it("creates fresh config when file absent", () => {
    const h = host({ keyPath: ["mcpServers"] });
    const out = installDirectJson(h, "a2h", SPEC);
    expect(out.alreadyExisted).toBe(false);
    const text = readFileSync(out.path!, "utf-8");
    const parsed = JSON.parse(text);
    expect(parsed.mcpServers.a2h).toEqual(SPEC);
  });

  it("preserves unknown top-level keys (Claude Desktop has 'preferences')", () => {
    const path = join(tmp, "config.json");
    writeFileSync(
      path,
      JSON.stringify({ preferences: { theme: "dark" }, customField: 42 }, null, 2),
    );
    const h = host({ keyPath: ["mcpServers"] });
    installDirectJson(h, "a2h", SPEC);
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.preferences).toEqual({ theme: "dark" });
    expect(parsed.customField).toBe(42);
    expect(parsed.mcpServers.a2h).toEqual(SPEC);
  });

  it("supports nested mcpKeyPath (mcp.servers)", () => {
    const h = host({ keyPath: ["mcp", "servers"] });
    installDirectJson(h, "a2h", SPEC);
    const parsed = JSON.parse(readFileSync(h.configPath!.darwin, "utf-8"));
    expect(parsed.mcp.servers.a2h).toEqual(SPEC);
  });

  it("preserves siblings inside the mcpServers map", () => {
    const path = join(tmp, "config.json");
    writeFileSync(
      path,
      JSON.stringify(
        { mcpServers: { other: { command: "node", args: ["other.js"], env: {} } } },
        null,
        2,
      ),
    );
    const h = host({ keyPath: ["mcpServers"] });
    installDirectJson(h, "a2h", SPEC);
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.mcpServers.other).toBeDefined();
    expect(parsed.mcpServers.a2h).toEqual(SPEC);
  });

  it("overwrites existing a2h entry by default", () => {
    const path = join(tmp, "config.json");
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { a2h: { command: "old", args: [], env: {} } } }, null, 2),
    );
    const h = host({ keyPath: ["mcpServers"] });
    const out = installDirectJson(h, "a2h", SPEC);
    expect(out.alreadyExisted).toBe(true);
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.mcpServers.a2h).toEqual(SPEC);
  });

  it("with overwrite=false leaves existing entry untouched", () => {
    const path = join(tmp, "config.json");
    const original = { command: "old", args: [], env: {} };
    writeFileSync(path, JSON.stringify({ mcpServers: { a2h: original } }, null, 2));
    const h = host({ keyPath: ["mcpServers"] });
    const out = installDirectJson(h, "a2h", SPEC, { overwrite: false });
    expect(out.alreadyExisted).toBe(true);
    // File should still contain the original entry; the function should not
    // have rewritten it.
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    expect(parsed.mcpServers.a2h).toEqual(original);
  });

  it("strips a UTF-8 BOM gracefully", () => {
    const path = join(tmp, "config.json");
    writeFileSync(path, "﻿" + JSON.stringify({}));
    const h = host({ keyPath: ["mcpServers"] });
    expect(() => installDirectJson(h, "a2h", SPEC)).not.toThrow();
  });

  it("readDirectJsonEntry returns the installed spec", () => {
    const h = host({ keyPath: ["mcpServers"] });
    installDirectJson(h, "a2h", SPEC);
    const got = readDirectJsonEntry(h, "a2h");
    expect(got).toEqual(SPEC);
  });

  it("readDirectJsonEntry returns undefined when absent", () => {
    const h = host({ keyPath: ["mcpServers"] });
    expect(readDirectJsonEntry(h, "a2h")).toBeUndefined();
  });
});
