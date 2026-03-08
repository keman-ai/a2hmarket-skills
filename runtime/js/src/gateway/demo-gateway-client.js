#!/usr/bin/env node
/**
 * Lightweight demo: connect to OpenClaw Gateway via WebSocket and send a message.
 *
 * Usage:
 *   node demo-gateway-client.js [--message "hello"] [--session-key "agent:main:main"]
 *
 * Reads device identity from ~/.openclaw/identity/device.json
 * Reads gateway token from ~/.openclaw/openclaw.json
 * Reads device auth token from ~/.openclaw/identity/device-auth.json
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { WebSocket } = require("ws");

const OPENCLAW_DIR = path.join(process.env.HOME || "~", ".openclaw");
const PROTOCOL_VERSION = 3;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// --- crypto helpers ---

function base64UrlEncode(buf) {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
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

// --- config loaders ---

function loadDeviceIdentity() {
  const p = path.join(OPENCLAW_DIR, "identity", "device.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadGatewayConfig() {
  const p = path.join(OPENCLAW_DIR, "openclaw.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  const gw = cfg.gateway || {};
  const port = gw.port || 18789;
  const token = gw.auth?.token || "";
  return { url: `ws://127.0.0.1:${port}`, token };
}

function loadDeviceAuthToken(role) {
  const p = path.join(OPENCLAW_DIR, "identity", "device-auth.json");
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return data.tokens?.[role]?.token || null;
  } catch {
    return null;
  }
}

// --- main ---

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    message: "Hello from a2hmarket gateway demo!",
    sessionKey: "agent:main:main",
    mode: "chat",       // "chat" = chat.send, "send" = message send to channel
    channel: "",        // feishu, whatsapp, etc.
    to: "",             // target id (e.g. ou_xxx for feishu)
    mediaUrl: "",       // optional image URL
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--message" && args[i + 1]) opts.message = args[++i];
    if (args[i] === "--session-key" && args[i + 1]) opts.sessionKey = args[++i];
    if (args[i] === "--mode" && args[i + 1]) opts.mode = args[++i];
    if (args[i] === "--channel" && args[i + 1]) opts.channel = args[++i];
    if (args[i] === "--to" && args[i + 1]) opts.to = args[++i];
    if (args[i] === "--media-url" && args[i + 1]) opts.mediaUrl = args[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const device = loadDeviceIdentity();
  const gwCfg = loadGatewayConfig();

  console.log(`[demo] gateway url: ${gwCfg.url}`);
  console.log(`[demo] device id: ${device.deviceId.slice(0, 16)}...`);
  console.log(`[demo] mode: ${opts.mode}`);
  if (opts.mode === "send") {
    console.log(`[demo] channel: ${opts.channel}`);
    console.log(`[demo] to: ${opts.to}`);
  } else {
    console.log(`[demo] target session: ${opts.sessionKey}`);
  }
  console.log(`[demo] message: ${opts.message}`);
  if (opts.mediaUrl) console.log(`[demo] media: ${opts.mediaUrl}`);
  console.log();

  const role = "operator";
  const scopes = ["operator.read", "operator.write"];
  const deviceToken = loadDeviceAuthToken(role);
  const authToken = gwCfg.token || deviceToken || undefined;

  const ws = new WebSocket(gwCfg.url, { maxPayload: 25 * 1024 * 1024 });
  let reqIdCounter = 0;
  const pendingRequests = new Map();

  function nextReqId() {
    return `demo_${++reqIdCounter}_${Date.now()}`;
  }

  function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextReqId();
      pendingRequests.set(id, { resolve, reject });
      const frame = JSON.stringify({ type: "req", id, method, params });
      ws.send(frame);
      console.log(`[demo] >>> ${method} (id=${id})`);
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`request ${method} timed out`));
        }
      }, 30000);
    });
  }

  ws.on("open", () => {
    console.log("[demo] WebSocket connected, waiting for challenge...");
  });

  ws.on("message", async (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return;
    }

    // Handle response frames
    if (parsed.type === "res" && parsed.id) {
      const pending = pendingRequests.get(parsed.id);
      if (pending) {
        pendingRequests.delete(parsed.id);
        if (parsed.ok) {
          pending.resolve(parsed.payload);
        } else {
          pending.reject(new Error(JSON.stringify(parsed.error || parsed.payload)));
        }
      }
      return;
    }

    // Handle event frames
    if (parsed.type === "event") {
      if (parsed.event === "connect.challenge") {
        const nonce = parsed.payload?.nonce;
        if (!nonce) {
          console.error("[demo] challenge missing nonce!");
          ws.close();
          return;
        }
        console.log(`[demo] received challenge nonce: ${nonce.slice(0, 16)}...`);

        // Build connect request
        const signedAtMs = Date.now();
        const platform = process.platform;
        const clientId = "gateway-client";
        const clientMode = "backend";

        const payloadStr = buildSignPayloadV3({
          deviceId: device.deviceId,
          clientId,
          clientMode,
          role,
          scopes,
          signedAtMs,
          token: authToken ?? null,
          nonce,
          platform,
          deviceFamily: undefined,
        });

        const signature = signPayload(device.privateKeyPem, payloadStr);

        const connectParams = {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: {
            id: clientId,
            version: "0.1.0",
            platform,
            mode: clientMode,
          },
          caps: [],
          role,
          scopes,
          auth: authToken ? { token: authToken } : undefined,
          device: {
            id: device.deviceId,
            publicKey: publicKeyRawBase64Url(device.publicKeyPem),
            signature,
            signedAt: signedAtMs,
            nonce,
          },
        };

        try {
          const helloOk = await sendRequest("connect", connectParams);
          console.log("[demo] connected!");
          console.log(`[demo] server: ${helloOk.server?.version}, connId: ${helloOk.server?.connId?.slice(0, 8)}...`);
          console.log();

          if (opts.mode === "send" && opts.channel && opts.to) {
            // Direct channel send (e.g. feishu, whatsapp)
            console.log(`[demo] sending to channel=${opts.channel} to=${opts.to}...`);
            const sendParams = {
              to: opts.to,
              channel: opts.channel,
              message: opts.message || undefined,
              mediaUrl: opts.mediaUrl || undefined,
              idempotencyKey: `demo_${crypto.randomUUID()}`,
            };
            const sendResult = await sendRequest("send", sendParams);
            console.log("[demo] send result:", JSON.stringify(sendResult, null, 2));
          } else {
            // Session chat.send
            console.log(`[demo] sending chat.send to session=${opts.sessionKey}...`);
            const idempotencyKey = `demo_${crypto.randomUUID()}`;
            const chatParams = {
              sessionKey: opts.sessionKey,
              message: opts.message,
              idempotencyKey,
            };
            const chatResult = await sendRequest("chat.send", chatParams);
            console.log("[demo] chat.send result:", JSON.stringify(chatResult, null, 2));
          }
        } catch (err) {
          console.error("[demo] error:", err.message);
        }

        // Keep listening for events for a bit, then close
        console.log();
        console.log("[demo] listening for reply events for 15s...");
        setTimeout(() => {
          console.log("[demo] done. closing.");
          ws.close();
        }, 15000);
        return;
      }

      // Print other events (like chat updates)
      if (parsed.event === "chat.update" || parsed.event === "chat.turn.complete") {
        const p = parsed.payload;
        if (p?.text) {
          console.log(`[demo] <<< [${parsed.event}] ${p.text.slice(0, 200)}`);
        } else if (p?.type) {
          console.log(`[demo] <<< [${parsed.event}] type=${p.type}`);
        } else {
          console.log(`[demo] <<< [${parsed.event}]`);
        }
      } else {
        console.log(`[demo] <<< event: ${parsed.event}`);
      }
    }
  });

  ws.on("error", (err) => {
    console.error("[demo] ws error:", err.message);
  });

  ws.on("close", (code, reason) => {
    console.log(`[demo] ws closed: code=${code} reason=${reason?.toString() || ""}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
