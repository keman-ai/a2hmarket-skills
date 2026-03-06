const { listAccountIds, resolveAccount } = require("../../runtime/js/src/channel/plugin-config");
const {
  isOutboundTargetAllowed,
  normalizeInboundEnvelope,
  startChannelConnection,
} = require("../../runtime/js/src/channel/plugin-runtime");

const CHANNEL_ID = "a2hmarket";
const activeConnections = new Map();

function createNoopLogger() {
  const noop = () => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };
}

function getLogger(source) {
  if (source && typeof source.info === "function") {
    return source;
  }
  if (source && source.logger && typeof source.logger.info === "function") {
    return source.logger;
  }
  return createNoopLogger();
}

function assertAccount(account) {
  if (!account) {
    throw new Error("a2hmarket account is required");
  }
  if (account.enabled === false) {
    throw new Error("a2hmarket account is disabled");
  }
  if (!account.agentId) {
    throw new Error("a2hmarket account.agentId is required");
  }
  if (!account.agentSecret) {
    throw new Error("a2hmarket account.agentSecret is required");
  }
}

async function createConnection(account, deps) {
  assertAccount(account);
  const logger = getLogger(deps);
  const connection = await startChannelConnection({
    account,
    logger,
    onEnvelope: (envelope) => {
      const normalized = normalizeInboundEnvelope({
        channelId: CHANNEL_ID,
        accountId: account.accountId,
        envelope,
      });
      if (deps && typeof deps.emit === "function") {
        deps.emit("message", {
          accountId: account.accountId,
          envelope,
          normalized,
        });
      } else if (deps && typeof deps.emitMessage === "function") {
        deps.emitMessage(normalized);
      }
    },
  });

  if (connection.transport && typeof connection.transport.on === "function") {
    connection.transport.on("disconnect", () => {
      if (deps && typeof deps.onDisconnect === "function") {
        deps.onDisconnect();
      }
    });
    connection.transport.on("error", (error) => {
      if (deps && typeof deps.onError === "function") {
        deps.onError(error);
      }
    });
  }

  return connection;
}

function toSafeErrorMessage(error) {
  const message = error && error.message ? String(error.message) : String(error || "");
  if (!message) {
    return "a2hmarket channel request failed";
  }
  if (message.includes("target.id is required")) {
    return message;
  }
  if (message.includes("account")) {
    return message;
  }
  if (message.includes("target not allowed")) {
    return message;
  }
  return "a2hmarket channel request failed";
}

const a2hmarketChannel = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "A2H Market",
    selectionLabel: "A2H Market (A2A/MQTT)",
    docsPath: "/channels/a2hmarket",
    blurb: "Connect OpenClaw to A2H Market over the native A2A channel.",
    aliases: ["a2h", "a2hmarket-a2a"],
    order: 90,
  },
  capabilities: {
    chatTypes: ["direct"],
    supports: {
      formatting: true,
    },
  },
  config: {
    listAccountIds,
    resolveAccount,
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ text, target, account, replyTo, logger }) => {
      let connection = null;
      let temporary = false;
      try {
        assertAccount(account);
        const targetAgentId = String(target && target.id ? target.id : "").trim();
        if (!targetAgentId) {
          throw new Error("target.id is required");
        }
        if (!isOutboundTargetAllowed(account, targetAgentId)) {
          throw new Error(`target not allowed: ${targetAgentId}`);
        }

        connection = activeConnections.get(account.accountId);
        if (!connection) {
          connection = await createConnection(account, { logger: getLogger(logger) });
          temporary = true;
        }

        const envelope = await connection.publishText({
          targetAgentId,
          text,
          replyTo,
        });
        if (temporary) {
          await connection.stop();
        }
        return {
          ok: true,
          messageId: envelope.message_id,
        };
      } catch (error) {
        const resolvedLogger = getLogger(logger);
        resolvedLogger.warn(
          `a2hmarket sendText failed: ${error && error.message ? error.message : String(error)}`
        );
        return {
          ok: false,
          error: toSafeErrorMessage(error),
        };
      } finally {
        if (temporary && connection) {
          await connection.stop();
        }
      }
    },
  },
  gateway: {
    start: async (account, deps) => {
      const connection = await createConnection(account, deps);
      activeConnections.set(account.accountId, connection);
      if (deps && typeof deps.onReady === "function") {
        deps.onReady();
      }
      return {
        stop: async () => {
          activeConnections.delete(account.accountId);
          await connection.stop();
        },
      };
    },
  },
  messaging: {
    onMessage: async (event, deps) => {
      if (!event || !event.normalized) {
        throw new Error("validated normalized event is required");
      }
      const normalized = event.normalized;
      if (deps && typeof deps.emitMessage === "function") {
        deps.emitMessage(normalized);
      }
      return normalized;
    },
  },
  security: {
    getDmPolicy: (account) => String(account.dmPolicy || "open"),
    getAllowFrom: (account) => (Array.isArray(account.allowFrom) ? account.allowFrom : []),
    checkGroupAccess: () => false,
  },
};

function register(api) {
  if (!api || typeof api.registerChannel !== "function") {
    throw new Error("OpenClaw plugin api.registerChannel is required");
  }
  api.registerChannel({ plugin: a2hmarketChannel });
}

module.exports = register;
module.exports.register = register;
module.exports.a2hmarketChannel = a2hmarketChannel;
