const { pull, ack, peek, get } = require("../inbox/inbox-service");
const { parseOptions } = require("./arg-parser");

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  a2hmarket inbox pull [--consumer <id>] [--cursor <n>] [--max <n>] [--wait-ms <n>] [--poll-interval-ms <n>] [--source-session-id <id>] [--source-session-key <key>] [--db-path <path>]",
      "  a2hmarket inbox ack --event-id <id> [--consumer <id>] [--source-session-id <id>] [--source-session-key <key>] [--db-path <path>]",
      "  a2hmarket inbox peek [--consumer <id>] [--db-path <path>]",
      "  a2hmarket inbox get --event-id <id> [--db-path <path>]",
    ].join("\n") + "\n"
  );
}

async function runInboxCli(args) {
  const command = args[0];
  const options = parseOptions(args.slice(1));
  if (!command || options.help || options.h) {
    printUsage();
    return 1;
  }

  try {
    if (command === "pull") {
      const result = await pull({
        dbPath: options["db-path"],
        consumerId: options.consumer,
        cursor: options.cursor,
        maxEvents: options.max,
        waitMs: options["wait-ms"],
        pollIntervalMs: options["poll-interval-ms"],
        sourceSessionId: options["source-session-id"],
        sourceSessionKey: options["source-session-key"],
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }

    if (command === "ack") {
      const result = await ack({
        dbPath: options["db-path"],
        consumerId: options.consumer,
        eventId: options["event-id"],
        sourceSessionId: options["source-session-id"],
        sourceSessionKey: options["source-session-key"],
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }

    if (command === "peek") {
      const result = await peek({
        dbPath: options["db-path"],
        consumerId: options.consumer,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }

    if (command === "get") {
      const result = await get({
        dbPath: options["db-path"],
        eventId: options["event-id"],
      });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return 0;
    }

    printUsage();
    return 1;
  } catch (err) {
    const payload = {
      ok: false,
      error: err && err.message ? err.message : String(err),
    };
    process.stderr.write(JSON.stringify(payload) + "\n");
    return 1;
  }
}

module.exports = {
  runInboxCli,
};
