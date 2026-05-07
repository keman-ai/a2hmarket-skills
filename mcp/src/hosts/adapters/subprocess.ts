import { spawnSync } from "node:child_process";

import type { HostSpec, InstallOutcome, McpServerSpec } from "../types.js";

/**
 * Install via the host's own CLI. Hosts with native MCP commands handle
 * config merging, file locking, and schema migrations themselves —
 * delegating to them is dramatically safer than reverse-engineering their
 * file format.
 *
 * Throws on non-zero exit; stderr is included in the error message so the
 * user sees the host's own diagnostic.
 */
export function installSubprocess(
  host: HostSpec,
  name: string,
  spec: McpServerSpec,
): InstallOutcome {
  if (!host.cli) {
    throw new Error(`host ${host.id} is subprocess strategy but has no cli`);
  }

  // Best-effort idempotence: if the host CLI supports `remove`, run it
  // first so `add` doesn't fail with "name already exists" on re-install.
  // Failures are swallowed because "not installed" is a normal case.
  if (host.cli.removeArgs) {
    try {
      const args = host.cli.removeArgs(name);
      spawnSync(host.cli.command, args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      /* ignore */
    }
  }

  const args = host.cli.addArgs(name, spec);
  const result = spawnSync(host.cli.command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(
      `failed to invoke ${host.cli.command}: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    const stdout = (result.stdout ?? "").trim();
    throw new Error(
      `${host.cli.command} ${args.join(" ")} exited ${result.status}\n${stderr || stdout}`,
    );
  }
  return { host, alreadyExisted: false };
}

/**
 * For doctor: ask the host CLI whether `name` is registered. Returns true
 * if the host's own list contains it. Heuristic: substring search on the
 * combined stdout/stderr — host CLIs format `list` differently and a strict
 * parser per host is overkill for V1.
 */
export function isInstalledSubprocess(host: HostSpec, name: string): boolean {
  if (!host.cli?.listArgs) {
    return false;
  }
  const args = host.cli.listArgs(name);
  const result = spawnSync(host.cli.command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    return false;
  }
  const haystack = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return haystack.includes(name);
}
