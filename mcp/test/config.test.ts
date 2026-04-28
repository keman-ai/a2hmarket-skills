import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  credPath,
  loadCredentials,
  resolveApiBase,
  resolveUrls,
} from "../src/config.js";

let tmp: string;
let originalArgv: string[];
let originalEnvBase: string | undefined;
let originalEnvUser: string | undefined;
let originalEnvFront: string | undefined;
let originalHome: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "a2h-mcp-test-"));
  process.env.A2H_HOME = tmp;
  originalArgv = process.argv;
  originalEnvBase = process.env.A2H_API_BASE;
  originalEnvUser = process.env.A2H_USER_BASE;
  originalEnvFront = process.env.A2H_FRONT_BASE;
  originalHome = process.env.A2H_HOME;
  delete process.env.A2H_API_BASE;
  delete process.env.A2H_USER_BASE;
  delete process.env.A2H_FRONT_BASE;
  process.argv = ["node", "test"];
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  process.argv = originalArgv;
  if (originalEnvBase === undefined) {
    delete process.env.A2H_API_BASE;
  } else {
    process.env.A2H_API_BASE = originalEnvBase;
  }
  if (originalEnvUser === undefined) {
    delete process.env.A2H_USER_BASE;
  } else {
    process.env.A2H_USER_BASE = originalEnvUser;
  }
  if (originalEnvFront === undefined) {
    delete process.env.A2H_FRONT_BASE;
  } else {
    process.env.A2H_FRONT_BASE = originalEnvFront;
  }
  if (originalHome === undefined) {
    delete process.env.A2H_HOME;
  } else {
    process.env.A2H_HOME = originalHome;
  }
});

describe("config.loadCredentials", () => {
  it("returns null when file does not exist", () => {
    expect(loadCredentials()).toBeNull();
  });

  it("parses a valid credentials file", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      credPath(),
      JSON.stringify({
        token: "a2h_pat_abc",
        agentId: "ag_1",
        tokenName: "my-laptop",
        createdAt: "2026-04-24T00:00:00Z",
      }),
    );
    const c = loadCredentials();
    expect(c).not.toBeNull();
    expect(c?.token).toBe("a2h_pat_abc");
    expect(c?.agentId).toBe("ag_1");
  });

  it("returns null on malformed JSON", () => {
    writeFileSync(credPath(), "not json {{{");
    expect(loadCredentials()).toBeNull();
  });

  it("accepts a token-only JSON (other fields optional)", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(credPath(), JSON.stringify({ token: "a2h_pat_only" }));
    const c = loadCredentials();
    expect(c).not.toBeNull();
    expect(c?.token).toBe("a2h_pat_only");
    expect(c?.agentId).toBeUndefined();
    expect(c?.tokenName).toBeUndefined();
    expect(c?.createdAt).toBeUndefined();
  });

  it("accepts a bare PAT string (no JSON wrapping)", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(credPath(), "a2h_pat_bare\n");
    const c = loadCredentials();
    expect(c?.token).toBe("a2h_pat_bare");
  });

  it("returns null when token field is missing or non-string", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(credPath(), JSON.stringify({ agentId: "ag_1" }));
    expect(loadCredentials()).toBeNull();
    writeFileSync(credPath(), JSON.stringify({ token: 42 }));
    expect(loadCredentials()).toBeNull();
  });

  it("prefers A2H_PAT env over the credentials file", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      credPath(),
      JSON.stringify({ token: "a2h_pat_from_file", agentId: "ag_x" }),
    );
    process.env.A2H_PAT = "a2h_pat_from_env";
    try {
      const c = loadCredentials();
      expect(c?.token).toBe("a2h_pat_from_env");
      // env path returns just the token, no metadata
      expect(c?.agentId).toBeUndefined();
    } finally {
      delete process.env.A2H_PAT;
    }
  });
});

describe("config.resolveApiBase", () => {
  it("defaults to prod", () => {
    expect(resolveApiBase()).toBe(
      "https://api.a2hmarket.ai/a2hmarket-concierge",
    );
  });

  it("switches to staging with --staging flag", () => {
    process.argv = ["node", "test", "--staging"];
    expect(resolveApiBase()).toBe(
      "https://api-staging.a2hmarket.ai/a2hmarket-concierge",
    );
  });

  it("A2H_API_BASE env var overrides everything", () => {
    process.env.A2H_API_BASE = "http://localhost:8821/a2hmarket-concierge/";
    process.argv = ["node", "test", "--staging"];
    expect(resolveApiBase()).toBe(
      "http://localhost:8821/a2hmarket-concierge",
    );
  });
});

describe("config.resolveUrls", () => {
  it("prod defaults: concierge + findu-user + a2hmarket.ai front", () => {
    const urls = resolveUrls();
    expect(urls.apiBase).toBe("https://api.a2hmarket.ai/a2hmarket-concierge");
    expect(urls.userBase).toBe("https://api.a2hmarket.ai/findu-user");
    expect(urls.frontBase).toBe("https://a2hmarket.ai");
  });

  it("staging (--staging flag): derives demo.a2hmarket.ai as frontBase", () => {
    process.argv = ["node", "test", "--staging"];
    const urls = resolveUrls();
    expect(urls.apiBase).toBe(
      "https://api-staging.a2hmarket.ai/a2hmarket-concierge",
    );
    expect(urls.userBase).toBe(
      "https://api-staging.a2hmarket.ai/findu-user",
    );
    // Staging frontend is demo.a2hmarket.ai (findu-docs/testing/staging-api-test.md).
    expect(urls.frontBase).toBe("https://demo.a2hmarket.ai");
  });

  it("explicit env overrides: each URL independently overridable", () => {
    process.env.A2H_API_BASE = "http://localhost:8821/a2hmarket-concierge";
    process.env.A2H_USER_BASE = "http://localhost:8802/findu-user/";
    process.env.A2H_FRONT_BASE = "http://localhost:5173/";
    const urls = resolveUrls();
    expect(urls.apiBase).toBe("http://localhost:8821/a2hmarket-concierge");
    expect(urls.userBase).toBe("http://localhost:8802/findu-user");
    expect(urls.frontBase).toBe("http://localhost:5173");
  });

  it("only A2H_API_BASE set (localhost): derives userBase by path swap, front → localhost:5173", () => {
    process.env.A2H_API_BASE = "http://localhost:8821/a2hmarket-concierge";
    const urls = resolveUrls();
    expect(urls.userBase).toBe("http://localhost:8821/findu-user");
    expect(urls.frontBase).toBe("http://localhost:5173");
  });
});
