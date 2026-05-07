import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_NAME = "@a2hmarket/a2h-mcp";
const ENTRY_RELATIVE = "dist/index.js";

/**
 * Resolve the absolute path the host should invoke for the MCP server. We
 * prefer `npm root -g` because nvm / volta / deskclaw / Homebrew on Apple
 * Silicon all live somewhere other than `/usr/local/lib/node_modules` and
 * hardcoding that path was the #1 bug we're fixing.
 *
 * Returns null if the package isn't actually installed at the resolved
 * location — caller should print an actionable hint asking the user to run
 * `npm install -g @a2hmarket/a2h-mcp` first.
 */
export function resolveServerEntry(): string | null {
  let root: string;
  try {
    root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  if (!root) {
    return null;
  }
  const entry = join(root, PACKAGE_NAME, ENTRY_RELATIVE);
  return existsSync(entry) ? entry : null;
}

/**
 * For tests: pretend the binary is installed at `entry`. Done by setting
 * env A2H_MCP_ENTRY_OVERRIDE, which `resolveServerEntryWithOverride` checks
 * first. Override is still subject to existsSync — set to a non-existent
 * path to simulate "package not installed".
 */
export function resolveServerEntryWithOverride(): string | null {
  const override = process.env.A2H_MCP_ENTRY_OVERRIDE;
  if (override) {
    return existsSync(override) ? override : null;
  }
  return resolveServerEntry();
}
