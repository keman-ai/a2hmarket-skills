#!/usr/bin/env node
import("../dist/login.js").then((m) => m.main()).catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[a2h-mcp-login] fatal: ${msg}\n`);
  process.exit(1);
});
