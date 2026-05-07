#!/usr/bin/env node
import("../dist/install.js")
  .then((m) => m.main(process.argv.slice(2)))
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[a2h-mcp-install] ${msg}\n`);
    process.exit(1);
  });
