#!/usr/bin/env node

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.resolve(__dirname, "..", "scripts", "a2hmarket-ops.sh");

try {
  execFileSync("bash", [SCRIPT, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
} catch (err) {
  process.exitCode = (err && err.status) || 1;
}
