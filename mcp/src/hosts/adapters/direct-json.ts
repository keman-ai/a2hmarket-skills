import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { atomicWrite } from "../../utils/atomic-write.js";
import { configPathFor } from "../detect.js";
import type { HostSpec, InstallOutcome, McpServerSpec } from "../types.js";

interface JsonObject {
  [key: string]: unknown;
}

/**
 * Read host config from disk, parse, and return the parsed root. If the
 * file doesn't exist we return an empty object — `installDirectJson` will
 * create the file on write. Existing top-level keys we don't recognise are
 * preserved verbatim (Claude Desktop puts `preferences` there, etc.).
 */
function readJsonConfig(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf-8");
  // Strip a UTF-8 BOM if present — Cursor on Windows occasionally writes one.
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (stripped.trim() === "") {
    return {};
  }
  const parsed: unknown = JSON.parse(stripped);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config at ${path} is not a JSON object`);
  }
  return parsed as JsonObject;
}

/**
 * Walk `keyPath` into `root`, creating empty objects as needed, and return
 * the deepest container. Throws if a non-object is in the way.
 */
function ensureContainer(root: JsonObject, keyPath: string[]): JsonObject {
  let cur: JsonObject = root;
  for (const key of keyPath) {
    const next = cur[key];
    if (next === undefined || next === null) {
      const fresh: JsonObject = {};
      cur[key] = fresh;
      cur = fresh;
    } else if (typeof next !== "object" || Array.isArray(next)) {
      throw new Error(
        `cannot install: existing config has non-object at "${keyPath.join(".")}"`,
      );
    } else {
      cur = next as JsonObject;
    }
  }
  return cur;
}

/**
 * Install (or replace) the `name` MCP server entry in a JSON-format host
 * config. Atomic write with backup. Returns the outcome so the caller can
 * print user-facing summaries.
 */
export function installDirectJson(
  host: HostSpec,
  name: string,
  spec: McpServerSpec,
  options: { overwrite: boolean } = { overwrite: true },
): InstallOutcome {
  if (!host.mcpKeyPath) {
    throw new Error(`host ${host.id} has no mcpKeyPath`);
  }
  const path = configPathFor(host);
  if (!path) {
    throw new Error(`host ${host.id} has no config path for this platform`);
  }

  // Ensure the parent dir exists; some hosts haven't been opened on a
  // freshly installed machine and the dir won't exist yet.
  mkdirSync(dirname(path), { recursive: true });

  const root = readJsonConfig(path);
  const container = ensureContainer(root, host.mcpKeyPath);
  const alreadyExisted = name in container;
  if (alreadyExisted && !options.overwrite) {
    return { host, path, alreadyExisted };
  }
  container[name] = {
    command: spec.command,
    args: spec.args,
    env: spec.env,
  };

  const text = JSON.stringify(root, null, 2) + "\n";
  const backup = atomicWrite(path, text);
  return { host, path, backup, alreadyExisted };
}

/**
 * Read the current MCP server entry by `name` if present. Used by doctor.
 * Returns undefined if the file or the entry doesn't exist.
 */
export function readDirectJsonEntry(
  host: HostSpec,
  name: string,
): McpServerSpec | undefined {
  if (!host.mcpKeyPath) {
    return undefined;
  }
  const path = configPathFor(host);
  if (!path || !existsSync(path)) {
    return undefined;
  }
  let root: JsonObject;
  try {
    root = readJsonConfig(path);
  } catch {
    return undefined;
  }
  let cur: unknown = root;
  for (const key of host.mcpKeyPath) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as JsonObject)[key];
    if (cur === undefined) {
      return undefined;
    }
  }
  if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
    return undefined;
  }
  const entry = (cur as JsonObject)[name];
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const e = entry as JsonObject;
  const command = typeof e.command === "string" ? e.command : "";
  const args = Array.isArray(e.args)
    ? e.args.filter((x): x is string => typeof x === "string")
    : [];
  const env =
    e.env && typeof e.env === "object" && !Array.isArray(e.env)
      ? Object.fromEntries(
          Object.entries(e.env as JsonObject).filter(
            (kv): kv is [string, string] => typeof kv[1] === "string",
          ),
        )
      : {};
  return { command, args, env };
}
