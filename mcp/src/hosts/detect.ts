import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";

import type { HostSpec } from "./types.js";

/** Resolve the per-platform config path; falls back to darwin if missing. */
export function configPathFor(host: HostSpec): string | undefined {
  if (!host.configPath) {
    return undefined;
  }
  const p = platform();
  const map = host.configPath as Record<string, string | undefined>;
  return map[p] ?? map.darwin;
}

/** True if `bin` is on PATH. Uses POSIX `which`; on win32 uses `where`. */
function isOnPath(bin: string): boolean {
  const cmd = platform() === "win32" ? "where" : "which";
  try {
    const out = execFileSync(cmd, [bin], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Best-effort detection of "is this host installed on this machine?".
 * Adapter strategy decides which of the two signals to use; if both are
 * absent we conservatively report false.
 */
export function isHostInstalled(host: HostSpec): boolean {
  if (host.detect.binOnPath) {
    if (isOnPath(host.detect.binOnPath)) {
      return true;
    }
  }
  if (host.detect.configExists !== false && host.configPath) {
    const path = configPathFor(host);
    if (path && existsSync(path)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the host's main process is currently running. Uses
 * `pgrep -f` for substring match against argv. Hosts without a pgrep
 * pattern (e.g. Claude Code which is ephemeral) always report false.
 */
export function isHostRunning(host: HostSpec): boolean {
  const pat = host.process.pgrepPattern;
  if (!pat) {
    return false;
  }
  try {
    execFileSync("pgrep", ["-f", pat], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;   // exit 0 = at least one match
  } catch {
    return false;  // exit 1 = no match (or pgrep missing)
  }
}

/**
 * Poll `isHostRunning` until it's false. Returns true once gone, false on
 * timeout. `onTick` lets the caller print a heartbeat so the user doesn't
 * think the CLI is hung.
 */
export async function waitForHostQuit(
  host: HostSpec,
  timeoutMs: number,
  onTick?: (elapsedMs: number) => void,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isHostRunning(host)) {
      return true;
    }
    onTick?.(Date.now() - start);
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Timeout. Don't re-check after the loop — that introduced a reverse race
  // where a process that briefly died and restarted between the last in-loop
  // check and the post-loop check would falsely flip the result. If we've
  // timed out, treat the host as still running (safe default).
  return false;
}

/** All hosts that detect as installed on this machine. */
export function detectInstalledHosts(hosts: HostSpec[]): HostSpec[] {
  return hosts.filter(isHostInstalled);
}
