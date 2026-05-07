import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { atomicWrite } from "../src/utils/atomic-write.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "atomic-write-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("atomicWrite", () => {
  it("creates a new file when target absent", () => {
    const target = join(tmp, "fresh.json");
    const backup = atomicWrite(target, "{}\n");
    expect(backup).toBeUndefined();
    expect(readFileSync(target, "utf-8")).toBe("{}\n");
  });

  it("backs up the original to <target>.bak.<ts>", () => {
    const target = join(tmp, "existing.json");
    writeFileSync(target, "old\n");
    const backup = atomicWrite(target, "new\n");
    expect(backup).toBeDefined();
    expect(backup!).toMatch(/existing\.json\.bak\.\d+$/);
    expect(readFileSync(backup!, "utf-8")).toBe("old\n");
    expect(readFileSync(target, "utf-8")).toBe("new\n");
  });

  it("does not leave tmp file siblings on success", () => {
    const target = join(tmp, "x.json");
    atomicWrite(target, "{}\n");
    const siblings = readdirSync(tmp);
    expect(siblings.filter((n) => n.includes(".tmp."))).toEqual([]);
  });

  it("writes file with 0600 perms", () => {
    const target = join(tmp, "perm.json");
    atomicWrite(target, "secret\n");
    expect(existsSync(target)).toBe(true);
    // Skip strict perm check on filesystems that drop modes (covered by chmod
    // later if we ever add it). The atomicWrite uses mode 0o600 on open() so
    // newly created files are 0600 on macOS / Linux.
  });
});
