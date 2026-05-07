import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { atomicWrite } from "../../utils/atomic-write.js";
import { configPathFor } from "../detect.js";
import type { HostSpec, InstallOutcome, McpServerSpec } from "../types.js";

/**
 * Minimal TOML writer for the one shape we need: a nested table with
 * `command` (string), `args` (string array), `env` (string→string map).
 *
 * We deliberately avoid pulling in a full TOML library: the only host that
 * uses TOML in V1 is codex-cli (experimental), the schema we emit is fixed,
 * and parsing user-edited TOML correctly requires far more code than we
 * want to maintain. Instead, on read we use a regex-based table extractor
 * good enough for our own write output, and on write we always emit fresh
 * tables (preserving any unrelated text by appending).
 */

function tomlEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function emitMcpTable(name: string, spec: McpServerSpec, prefix: string[]): string {
  const tableHeader = [...prefix, name].join(".");
  const lines: string[] = [];
  lines.push(`[${tableHeader}]`);
  lines.push(`command = "${tomlEscape(spec.command)}"`);
  const args = spec.args.map((a) => `"${tomlEscape(a)}"`).join(", ");
  lines.push(`args = [${args}]`);
  if (Object.keys(spec.env).length > 0) {
    lines.push(`[${tableHeader}.env]`);
    for (const [k, v] of Object.entries(spec.env)) {
      lines.push(`${k} = "${tomlEscape(v)}"`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Strip any existing `[<prefix>.<name>]` and `[<prefix>.<name>.*]` tables
 * from `text`. Used to make re-install idempotent.
 */
function stripTomlTable(text: string, prefix: string[], name: string): string {
  const target = [...prefix, name].join(".");
  // Match the target header and everything up to (but not including) the
  // next top-level header or EOF.
  const re = new RegExp(
    String.raw`(^|\n)\[${target.replace(/\./g, "\\.")}(\.[^\]]+)?\][^\[]*`,
    "g",
  );
  return text.replace(re, (match, leading: string) => leading);
}

export function installDirectToml(
  host: HostSpec,
  name: string,
  spec: McpServerSpec,
): InstallOutcome {
  if (!host.mcpKeyPath) {
    throw new Error(`host ${host.id} has no mcpKeyPath`);
  }
  const path = configPathFor(host);
  if (!path) {
    throw new Error(`host ${host.id} has no config path for this platform`);
  }
  mkdirSync(dirname(path), { recursive: true });

  const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const stripped = stripTomlTable(existing, host.mcpKeyPath, name);
  const trimmed = stripped.replace(/\n+$/, "");
  const next =
    (trimmed ? trimmed + "\n\n" : "") + emitMcpTable(name, spec, host.mcpKeyPath);
  const backup = atomicWrite(path, next);
  return { host, path, backup, alreadyExisted: existing.includes(`[${[...host.mcpKeyPath, name].join(".")}]`) };
}

/**
 * For doctor: detect presence of the entry. Cheap substring check on the
 * raw file is sufficient because we always emit a recognisable header.
 */
export function isInstalledDirectToml(host: HostSpec, name: string): boolean {
  const path = configPathFor(host);
  if (!path || !existsSync(path) || !host.mcpKeyPath) {
    return false;
  }
  const raw = readFileSync(path, "utf-8");
  return raw.includes(`[${[...host.mcpKeyPath, name].join(".")}]`);
}
