/**
 * Shared types for the host registry. Adding a new host = add a row in
 * `registry.ts`; only adapters in `adapters/` actually contain logic.
 */

export type HostStrategy = "direct-json" | "subprocess" | "direct-toml";

export type ReloadKind =
  | "hard-restart"      // Claude Desktop, Cursor — quit + reopen
  | "session-restart"   // Claude Code — new CLI session
  | "soft-reload"       // OpenClaw, Hermes — `<host> mcp` command does it
  | "cli-managed";      // host's own CLI handles reload internally

/**
 * Concrete MCP server entry the user wants installed. Adapters translate this
 * into whatever shape the host expects.
 */
export interface McpServerSpec {
  /** Executable, typically "node". */
  command: string;
  /** Argv to the executable, typically [absolutePathToDistIndexJs]. */
  args: string[];
  /** Environment passed to the spawned MCP server. */
  env: Record<string, string>;
}

export interface HostSpec {
  id: string;                  // "claude-desktop"
  displayName: string;
  vendor: "anthropic" | "openai" | "minimax" | "other";
  strategy: HostStrategy;
  status: "stable" | "experimental";

  /** direct-json / direct-toml only. */
  configPath?: { darwin: string; linux?: string; win32?: string };
  /** direct-json / direct-toml only — dotted key path to the MCP servers map. */
  mcpKeyPath?: string[];

  /** subprocess only. */
  cli?: HostCliSpec;

  detect: {
    /** direct-* default true: configPath existing means "installed". */
    configExists?: boolean;
    /** subprocess default: this binary on PATH. */
    binOnPath?: string;
    /**
     * Env vars whose presence (any one) indicates this host is the CURRENT
     * runtime (i.e. a2h-mcp-install is being invoked from inside this host).
     * Used by pickHost as a smart default when multiple hosts are installed —
     * we prefer "the one I'm running inside" over making the agent ask.
     * Example: claude-code sets CLAUDECODE=1.
     */
    runtimeEnv?: string[];
  };

  process: {
    /** Pattern passed to `pgrep -f`. Empty/undefined for ephemeral hosts. */
    pgrepPattern?: string;
    /** User-facing instruction shown when host is running. */
    quitInstruction?: string;
  };

  reload: {
    kind: ReloadKind;
    /** Printed after install completes. */
    instruction: string;
  };
}

export interface HostCliSpec {
  /** Binary name on PATH, e.g. "claude". */
  command: string;
  /** Build argv to install / replace one MCP server entry. */
  addArgs(name: string, spec: McpServerSpec): string[];
  /** Build argv to list MCP servers (output parsed best-effort). */
  listArgs?(name?: string): string[];
  /** Build argv to remove one MCP server entry. */
  removeArgs?(name: string): string[];
}

/**
 * Result returned by `install()` to the bin entry point. `path` is the file
 * the adapter wrote (or the host CLI wrote for us); `backup` is a `.bak.*`
 * sibling when one was created.
 */
export interface InstallOutcome {
  host: HostSpec;
  path?: string;
  backup?: string;
  alreadyExisted: boolean;
}

export interface DoctorFinding {
  level: "ok" | "warn" | "error";
  scope: string;       // "credentials" | "api" | "host:claude-desktop" | …
  message: string;
}
