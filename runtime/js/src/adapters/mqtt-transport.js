const { EventEmitter } = require("node:events");

function buildBrokerUrl(cfg) {
  if (cfg.mqttEndpoint && cfg.mqttEndpoint.startsWith("mqtt")) return cfg.mqttEndpoint;
  if (!cfg.mqttEndpoint) {
    throw new Error("missing A2HMARKET_MQTT_ENDPOINT");
  }
  return `${cfg.mqttProtocol || "mqtts"}://${cfg.mqttEndpoint}:${cfg.mqttPort || 8883}`;
}

function createDefaultClientFactory() {
  let mqttLib = null;
  try {
    // Optional dependency: install `mqtt` when enabling A2A runtime in production.
    mqttLib = require("mqtt");
  } catch (err) {
    throw new Error(
      `mqtt package not installed. run 'npm install mqtt' in a2hmarket directory. detail=${err && err.message ? err.message : String(err)}`
    );
  }
  return (url, opts) => mqttLib.connect(url, opts);
}

class MqttTransport extends EventEmitter {
  constructor({ cfg, tokenClient, logger, clientFactory }) {
    super();
    this.cfg = cfg;
    this.tokenClient = tokenClient;
    this.logger = logger;
    this.clientFactory = clientFactory || createDefaultClientFactory();
    this.client = null;
    this.currentAgentId = "";
    this.currentAgentSecret = "";
    this.currentClientId = "";
    this.shouldReconnect = false;
    this.reconnectTimer = null;
    // Track reconnect frequency to reduce log noise
    this.lastConnectTime = 0;
    this.lastDisconnectTime = 0;
    this.consecutiveQuickDisconnects = 0;
    this.connectionGeneration = 0;
  }

  clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  scheduleReconnect(reason) {
    if (!this.shouldReconnect || !this.currentAgentId || !this.currentAgentSecret) {
      return;
    }

    const reconnectDelayMs = this.cfg.mqttReconnectPeriodMs || 5000;
    this.clearReconnectTimer();
    this.logger.info(`mqtt scheduling reconnect in ${reconnectDelayMs}ms reason=${reason} with token refresh`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.shouldReconnect) {
        this.logger.debug("mqtt reconnect cancelled (client closed)");
        return;
      }

      try {
        this.logger.info("mqtt manual reconnect starting");
        await this.connect({
          agentId: this.currentAgentId,
          agentSecret: this.currentAgentSecret,
          forceRefresh: true,
        });
        this.logger.info("mqtt manual reconnect successful");
      } catch (err) {
        this.logger.error(`mqtt manual reconnect failed: ${err.message}`);
        this.scheduleReconnect("connect_failed");
      }
    }, reconnectDelayMs);
  }

  bindClientEvents(client) {
    let clientConnected = false;
    let clientConnectedAt = 0;

    client.on("message", (topic, payload) => {
      if (this.client !== client) return;
      const body = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload || "");
      this.logger.info(`mqtt message received topic=${topic} size=${body.length}b payload=${body.slice(0, 500)}`);
      this.emit("message", { topic, payload: body });
    });

    client.on("connect", (packet) => {
      if (this.client !== client) return;
      const now = Date.now();
      const sessionPresent = Boolean(packet && packet.sessionPresent);
      const timeSinceLastConnect = this.lastConnectTime ? now - this.lastConnectTime : 0;
      clientConnected = true;
      clientConnectedAt = now;
      this.lastConnectTime = now;

      // Log normally on first connect or after stable period, suppress on rapid reconnects
      if (timeSinceLastConnect === 0 || timeSinceLastConnect > 30000) {
        this.logger.info(`mqtt connected session_present=${sessionPresent ? "1" : "0"}`);
      } else {
        this.logger.debug(`mqtt reconnected session_present=${sessionPresent ? "1" : "0"} (${(timeSinceLastConnect / 1000).toFixed(1)}s)`);
      }
      this.emit("connect", { sessionPresent });
    });

    client.on("error", (err) => {
      if (this.client !== client) return;
      this.logger.warn(`mqtt error: ${err && err.message ? err.message : String(err)}`);
      if (this.listenerCount("error") > 0) {
        this.emit("error", err);
      }
    });

    client.on("close", () => {
      if (this.client !== client) return;
      this.client = null;

      const now = Date.now();
      const connectedDuration = clientConnectedAt ? now - clientConnectedAt : 0;
      this.lastDisconnectTime = now;

      // Detect frequent disconnects (< 15s connected)
      if (connectedDuration > 0 && connectedDuration < 15000) {
        this.consecutiveQuickDisconnects++;
        if (this.consecutiveQuickDisconnects === 3) {
          this.logger.warn(
            `mqtt frequent disconnects detected (avg ${(connectedDuration / 1000).toFixed(1)}s) - possible broker limitation. suppressing further disconnect logs.`
          );
        }
        // Suppress logs after detecting pattern
        if (this.consecutiveQuickDisconnects < 3) {
          this.logger.warn(`mqtt disconnected after ${(connectedDuration / 1000).toFixed(1)}s`);
        } else if (this.consecutiveQuickDisconnects > 3 && this.consecutiveQuickDisconnects % 10 === 0) {
          // Log every 10 disconnects after initial detection
          this.logger.debug(`mqtt still disconnecting frequently (${this.consecutiveQuickDisconnects} times)`);
        }
      } else {
        // Only reset counter if we had a stable connection (> 15s)
        if (connectedDuration >= 15000) {
          this.consecutiveQuickDisconnects = 0;
        }
        // Log normally for unknown duration or stable disconnects
        if (connectedDuration === 0) {
          this.logger.warn("mqtt disconnected (duration unknown)");
        } else {
          this.logger.warn(`mqtt disconnected after ${(connectedDuration / 1000).toFixed(1)}s`);
        }
      }

      if (clientConnected) {
        this.emit("disconnect");
      }
      this.scheduleReconnect("close");
    });
  }

  async connect({ agentId, agentSecret, forceRefresh }) {
    const connectionGeneration = ++this.connectionGeneration;
    this.clearReconnectTimer();

    // Close existing client to prevent resource leak
    if (this.client) {
      const previousClient = this.client;
      this.client = null;
      this.logger.info("mqtt closing existing client before reconnect");
      try {
        previousClient.end(true);
      } catch (err) {
        this.logger.warn(`mqtt failed to close existing client: ${err.message}`);
      }
    }
    
    this.currentAgentId = agentId;
    this.currentAgentSecret = agentSecret;
    const token = await this.tokenClient.getToken({
      agentId,
      agentSecret,
      clientId: this.tokenClient.buildClientId(agentId),
      forceRefresh: Boolean(forceRefresh),
    });
    if (connectionGeneration !== this.connectionGeneration) {
      throw new Error("mqtt connect aborted");
    }
    this.currentClientId = token.client_id;

    const url = buildBrokerUrl(this.cfg);
    this.logger.info(
      `mqtt connect endpoint=${this.cfg.mqttEndpoint} client_id=${token.client_id} token_source=${token.source}`
    );

    const client = this.clientFactory(url, {
      clientId: token.client_id,
      username: token.username,
      password: token.password,
      reconnectPeriod: 0,  // Disable automatic reconnect - we'll handle it manually
      connectTimeout: this.cfg.mqttConnectTimeoutMs,
      protocolVersion: 4,
      // Keep session across transient disconnects so qos1 messages are not dropped while offline.
      clean: false,
      keepalive: 60,
      rejectUnauthorized: false,
    });
    this.client = client;
    this.bindClientEvents(client);

    try {
      await new Promise((resolve, reject) => {
        const onConnect = () => {
          cleanup();
          resolve();
        };
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const onClose = () => {
          cleanup();
          reject(new Error("mqtt connection closed before connect"));
        };
        const cleanup = () => {
          client.off("connect", onConnect);
          client.off("error", onError);
          client.off("close", onClose);
        };
        client.on("connect", onConnect);
        client.on("error", onError);
        client.on("close", onClose);
      });
    } catch (err) {
      if (this.client === client) {
        this.client = null;
      }
      try {
        client.end(true);
      } catch {
        // ignore
      }
      throw err;
    }
    if (connectionGeneration !== this.connectionGeneration) {
      if (this.client === client) {
        this.client = null;
      }
      try {
        client.end(true);
      } catch {
        // ignore
      }
      throw new Error("mqtt connect aborted");
    }

    this.shouldReconnect = true;  // Enable automatic reconnection
    return {
      clientId: token.client_id,
      tokenSource: token.source,
    };
  }

  async subscribeIncoming(agentId) {
    if (!this.client) throw new Error("mqtt client is not connected");
    const topic = `${this.cfg.mqttTopicId}/p2p/${this.tokenClient.buildClientId(agentId)}`;
    await new Promise((resolve, reject) => {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) return reject(err);
        return resolve();
      });
    });
    this.logger.info(`mqtt subscribed topic=${topic}`);
    return topic;
  }

  async publishToAgent(targetAgentId, envelope, qos) {
    if (!this.client) throw new Error("mqtt client is not connected");
    const targetClientId = this.tokenClient.buildClientId(targetAgentId);
    const topic = `${this.cfg.mqttTopicId}/p2p/${targetClientId}`;
    const payload = JSON.stringify(envelope);
    this.logger.info(
      `mqtt message sending target_id=${targetAgentId} topic=${topic} qos=${qos == null ? 1 : qos} size=${payload.length}b message_id=${envelope.message_id || '-'} message_type=${envelope.message_type || '-'}`
    );
    this.logger.debug(`mqtt message payload: ${payload.slice(0, 1000)}`);
    await new Promise((resolve, reject) => {
      this.client.publish(topic, payload, { qos: qos == null ? 1 : qos }, (err) => {
        if (err) {
          this.logger.error(`mqtt publish failed: ${err.message}`);
          return reject(err);
        }
        this.logger.info(`mqtt message sent successfully message_id=${envelope.message_id || '-'}`);
        return resolve();
      });
    });
    return { topic };
  }

  close() {
    this.shouldReconnect = false;  // Disable automatic reconnection
    this.connectionGeneration += 1;
    this.clearReconnectTimer();
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    try {
      client.end(true);
    } catch {
      // ignore
    }
  }
}

module.exports = {
  MqttTransport,
  buildBrokerUrl,
};
