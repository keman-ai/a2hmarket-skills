#!/usr/bin/env node

const { runInboxCli } = require("../runtime/js/src/cli/inbox-cli");
const { runListenerCli } = require("../runtime/js/src/cli/listener-cli");
const { runA2aCli } = require("../runtime/js/src/cli/a2a-cli");
const { runSyncCli } = require("../runtime/js/src/cli/sync-cli");
const { runProfileCli } = require("../runtime/js/src/cli/profile-cli");
const { runWorksCli } = require("../runtime/js/src/cli/works-cli");
const { runOrderCli } = require("../runtime/js/src/cli/order-cli");

function printUsage() {
  process.stdout.write(
    [
      "a2hmarket runtime cli",
      "",
      "Usage:",
      "  a2hmarket listener run [--once] [--verbose]",
      "  a2hmarket inbox pull [--consumer <id>] [--cursor <n>] [--max <n>] [--wait-ms <n>] [--poll-interval-ms <n>] [--db-path <path>]",
      "  a2hmarket inbox ack --event-id <id> [--consumer <id>] [--db-path <path>]",
      "  a2hmarket inbox peek [--consumer <id>] [--db-path <path>]",
      "  a2hmarket a2a send --target-agent-id <agent_id> (--text <message> | --payload-json <json>) [--message-type <type>] [--trace-id <id>] [--qos <0|1>] [--verbose]",
      "  a2hmarket sync [--only profile|works]",
      "",
      "  a2hmarket profile get",
      "",
      "  a2hmarket works search --keyword <text> [--type <2|3>] [--city <city>] [--page <n>] [--page-size <n>]",
      "  a2hmarket works publish --type <2|3> --title <title> --content <text> ... --confirm-human-reviewed true",
      "  a2hmarket works list [--type <2|3>] [--page <n>] [--page-size <n>]",
      "",
      "  a2hmarket order create --customer-id <id> --title <title> --content <text> --price-cent <n> --product-id <id>",
      "  a2hmarket order confirm --order-id <id>",
      "  a2hmarket order get --order-id <id>",
    ].join("\n") + "\n"
  );
}

async function main() {
  const args = process.argv.slice(2);
  const root = args[0];
  if (!root) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (root === "inbox") {
    const code = await runInboxCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (root === "listener") {
    const code = await runListenerCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (root === "a2a") {
    const code = await runA2aCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (root === "sync") {
    const code = await runSyncCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (root === "profile") {
    const code = await runProfileCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (root === "works") {
    const code = await runWorksCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (root === "order") {
    const code = await runOrderCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`[a2hmarket] fatal: ${err && err.message ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
