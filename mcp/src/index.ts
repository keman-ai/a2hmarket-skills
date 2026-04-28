import { start } from "./server.js";

start().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[a2h-mcp] fatal: ${msg}\n`);
  process.exit(1);
});
