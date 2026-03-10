const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { WebSocket } = require("ws");
const {
  resolveOpenclawConfigPath,
  resolveOpenclawStateDir,
} = require("../config/openclaw-paths");

const PROTOCOL_VERSION = 3;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
// Gateway 白名单要求 client.id 为 GATEWAY_CLIENT_IDS 之一，使用 node-host 表示 Node 后端
const CLIENT_ID = "node-host";
const CLIENT_VERSION = "1.0.0";
const CLIENT_MODE = "backend";
const ROLE = "operator";
// sessions.patch（session bootstrap）需 operator.admin
const SCOPES = ["operator.admin", "operator.read", "operator.write"];

// ---------------------------------------------------------------------------
// Crypto helpers (Ed25519 device auth)
// ---------------------------------------------------------------------------

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function derivePublicKeyRaw(publicKeyPem) {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function publicKeyRawBase64Url(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function signPayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

function buildSignPayloadV3({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce, platform, deviceFamily }) {
  const scopeStr = scopes.join(",");
  const tokenStr = token ?? "";
  const platformStr = (platform ?? "").toLowerCase();
  const familyStr = (deviceFamily ?? "").toLowerCase();
  return ["v3", deviceId, clientId, clientMode, role, scopeStr, String(signedAtMs), tokenStr, nonce, platformStr, familyStr].join("|");
}

// ---------------------------------------------------------------------------
// Config loaders
// ---------------------------------------------------------------------------

function resolveOpenclawDir(openclawDir) {
  return resolveOpenclawStateDir(openclawDir);
}

function loadDeviceIdentity(openclawDir) {
  const p = path.join(resolveOpenclawDir(openclawDir), "identity", "device.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadGatewayConfig(openclawDir) {
  const p = resolveOpenclawConfigPath(openclawDir);
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  const gw = cfg.gateway || {};
  const port = gw.port || 18789;
  const token = gw.auth?.token || "";
  return { url: `ws://127.0.0.1:${port}`, token };
}

function loadDeviceAuthToken(openclawDir, role) {
  const p = path.join(resolveOpenclawDir(openclawDir), "identity", "device-auth.json");
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.tokens?.[role]?.token || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GatewayClient
// ---------------------------------------------------------------------------

class GatewayClient extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} [options.openclawDir] - Override ~/.openclaw
   * @param {number} [options.requestTimeoutMs]
   * @param {object} [options.logger] - { info, warn, error, debug }
   */
  constructor(options) {
    super();
    const opts = options || {};
    this._openclawDir = resolveOpenclawDir(opts.openclawDir);
    this._requestTimeoutMs = opts.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this._logger = opts.logger || { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

    this._ws = null;
    this._connected = false;
    this._connectPromise = null;
    this._intentionalClose = false;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._reqIdCounter = 0;
    this._pendingRequests = new Map();

    this._device = null;
    this._gwCfg = null;
    this._authToken = null;

    this._channelStatus = {};
    this._sessionSnapshot = null;
    this._serverVersion = "";
    this._connId = "";
  }

  // ---- public getters -----------------------------------------------------

  isConnected() {
    return this._connected;
  }

  getChannelStatus() {
    return { ...this._channelStatus };
  }

  getSessionSnapshot() {
    return this._sessionSnapshot;
  }

  // ---- lifecycle ----------------------------------------------------------

  async connect() {
    if (this._connected) return;
    if (this._connectPromise) return this._connectPromise;

    this._intentionalClose = false;
    this._loadConfig();
    this._connectPromise = this._doConnect();
    try {
      await this._connectPromise;
    } finally {
      this._connectPromise = null;
    }
  }

  disconnect() {
    this._intentionalClose = true;
    this._clearReconnectTimer();
    this._rejectAllPending("client disconnected");
    if (this._ws) {
      try { this._ws.close(1000); } catch {}
      this._ws = null;
    }
    this._connected = false;
  }

  // ---- RPC methods --------------------------------------------------------

  /**
   * Equivalent to `openclaw agent --session-key <key> --message <msg>`
   * sourceSessionKey: 若 Gateway 支持，回复会路由回该 session（reply routing）
   */
  async chatSend({ sessionKey, message, idempotencyKey, sourceSessionKey }) {
    const key = idempotencyKey || `a2h_${crypto.randomUUID()}`;
    const params = { sessionKey, message, idempotencyKey: key };
    if (sourceSessionKey) params.sourceSessionKey = sourceSessionKey;
    return this._request("chat.send", params);
  }

  /**
   * Equivalent to `openclaw message send --channel <ch> --target <to> [--message <msg>] [--media <url>]`
   */
  async send({ channel, to, message, mediaUrl, accountId, threadId, idempotencyKey }) {
    const key = idempotencyKey || `a2h_${crypto.randomUUID()}`;
    const params = { channel, to, idempotencyKey: key };
    if (message) params.message = message;
    if (mediaUrl) params.mediaUrl = mediaUrl;
    if (accountId) params.accountId = accountId;
    if (threadId) params.threadId = threadId;
    return this._request("send", params);
  }

  /**
   * Equivalent to `openclaw sessions --json`
   */
  async sessionsList() {
    return this._request("sessions.list", {});
  }

  /**
   * Equivalent to `openclaw gateway call sessions.patch --params <json>`
   */
  async sessionsPatch({ key, label }) {
    const params = { key };
    if (label != null && String(label).trim()) params.label = String(label).trim();
    return this._request("sessions.patch", params);
  }

  // ---- internals ----------------------------------------------------------

  _loadConfig() {
    this._device = loadDeviceIdentity(this._openclawDir);
    this._gwCfg = loadGatewayConfig(this._openclawDir);
    const deviceToken = loadDeviceAuthToken(this._openclawDir, ROLE);
    this._authToken = this._gwCfg.token || deviceToken || undefined;
  }

  _nextReqId() {
    return `a2h_${++this._reqIdCounter}_${Date.now()}`;
  }

  _request(method, params) {
    return new Promise((resolve, reject) => {
      const wsOpen = this._ws && this._ws.readyState === WebSocket.OPEN;
      const allowConnect = method === "connect";
      if (!wsOpen || (!this._connected && !allowConnect)) {
        return reject(new Error(`gateway not connected (method=${method})`));
      }
      const id = this._nextReqId();
      const timer = setTimeout(() => {
        if (this._pendingRequests.has(id)) {
          this._pendingRequests.delete(id);
          reject(new Error(`request ${method} timed out after ${this._requestTimeoutMs}ms`));
        }
      }, this._requestTimeoutMs);

      this._pendingRequests.set(id, { resolve, reject, timer });
      const frame = JSON.stringify({ type: "req", id, method, params });
      try {
        this._ws.send(frame);
      } catch (err) {
        this._pendingRequests.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  _doConnect() {
    return new Promise((resolve, reject) => {
      const gwUrl = this._gwCfg.url;
      this._logger.debug(`gateway connecting to ${gwUrl}`);
      const ws = new WebSocket(gwUrl, { maxPayload: 25 * 1024 * 1024 });
      this._ws = ws;

      let settled = false;
      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      ws.on("open", () => {
        this._logger.debug("gateway ws open, waiting for challenge");
      });

      ws.on("message", async (data) => {
        let parsed;
        try { parsed = JSON.parse(data.toString()); } catch { return; }

        if (parsed.type === "res" && parsed.id) {
          const pending = this._pendingRequests.get(parsed.id);
          if (pending) {
            this._pendingRequests.delete(parsed.id);
            clearTimeout(pending.timer);
            if (parsed.ok) {
              pending.resolve(parsed.payload);
            } else {
              pending.reject(new Error(JSON.stringify(parsed.error || parsed.payload)));
            }
          }
          return;
        }

        if (parsed.type === "event") {
          if (parsed.event === "connect.challenge") {
            try {
              await this._handleChallenge(parsed.payload?.nonce);
              this._connected = true;
              this._reconnectAttempt = 0;
              if (!settled) { settled = true; resolve(); }
              this.emit("connected", { serverVersion: this._serverVersion, connId: this._connId });
            } catch (err) {
              this._logger.error(`gateway auth failed: ${err.message}`);
              fail(err);
              ws.close();
            }
            return;
          }

          if (parsed.event === "health") {
            this._updateHealth(parsed.payload);
          }

          this.emit("event", parsed);
        }
      });

      ws.on("error", (err) => {
        this._logger.error(`gateway ws error: ${err.message}`);
        fail(err);
      });

      ws.on("close", (code, reason) => {
        const wasConnected = this._connected;
        this._connected = false;
        this._rejectAllPending("ws closed");
        fail(new Error(`ws closed code=${code}`));

        if (wasConnected) {
          this.emit("disconnected", { code, reason: reason?.toString() || "" });
        }

        if (!this._intentionalClose) {
          this._scheduleReconnect();
        }
      });
    });
  }

  async _handleChallenge(nonce) {
    if (!nonce) throw new Error("challenge missing nonce");

    const signedAtMs = Date.now();
    const platform = process.platform;

    const payloadStr = buildSignPayloadV3({
      deviceId: this._device.deviceId,
      clientId: CLIENT_ID,
      clientMode: CLIENT_MODE,
      role: ROLE,
      scopes: SCOPES,
      signedAtMs,
      token: this._authToken ?? null,
      nonce,
      platform,
      deviceFamily: undefined,
    });

    const signature = signPayload(this._device.privateKeyPem, payloadStr);

    const connectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: { id: CLIENT_ID, version: CLIENT_VERSION, platform, mode: CLIENT_MODE },
      caps: [],
      role: ROLE,
      scopes: SCOPES,
      auth: this._authToken ? { token: this._authToken } : undefined,
      device: {
        id: this._device.deviceId,
        publicKey: publicKeyRawBase64Url(this._device.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      },
    };

    const helloOk = await this._request("connect", connectParams);
    this._serverVersion = helloOk?.server?.version || "";
    this._connId = helloOk?.server?.connId || "";

    if (helloOk?.snapshot?.health) {
      this._updateHealth(helloOk.snapshot.health);
    }
    if (helloOk?.snapshot?.health?.sessions) {
      this._sessionSnapshot = helloOk.snapshot.health.sessions;
    }

    this._logger.info(`gateway connected server=${this._serverVersion} connId=${this._connId.slice(0, 8)}`);
  }

  _updateHealth(health) {
    if (!health) return;
    if (health.channels) {
      this._channelStatus = {};
      for (const [ch, info] of Object.entries(health.channels)) {
        this._channelStatus[ch] = {
          configured: Boolean(info?.configured),
          running: Boolean(info?.running),
          connected: Boolean(info?.connected),
        };
      }
    }
    if (health.sessions) {
      this._sessionSnapshot = health.sessions;
    }
    this.emit("health", health);
  }

  _rejectAllPending(reason) {
    for (const [id, entry] of this._pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this._pendingRequests.clear();
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    this._reconnectAttempt++;
    const delay = Math.min(1000 * 2 ** Math.min(this._reconnectAttempt - 1, 10), MAX_RECONNECT_DELAY_MS);
    this._logger.info(`gateway reconnecting in ${delay}ms (attempt=${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(async () => {
      if (this._intentionalClose) return;
      try {
        this._loadConfig();
        await this._doConnect();
      } catch (err) {
        this._logger.warn(`gateway reconnect failed: ${err.message}`);
        if (!this._intentionalClose) {
          this._scheduleReconnect();
        }
      }
    }, delay);
  }
}

module.exports = { GatewayClient };
