/**
 * PeerSessionManager
 *
 * 为每个对手 Agent 维护一个专用 session（key = agent:main:a2hmarket:{peerId}）。
 * 只在第一次收到某对手消息时自举（sessions.patch），后续复用，不重复调用。
 */

const PEER_SESSION_PREFIX = "agent:main:a2hmarket:";

/**
 * 根据对手 agent_id 计算专用 session key。
 * peer_id 中的非法字符统一替换为下划线，保证 key 合法。
 */
function peerSessionKey(peerId) {
  const safe = String(peerId || "unknown").trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
  return `${PEER_SESSION_PREFIX}${safe}`;
}

class PeerSessionManager {
  /**
   * @param {object} gatewayClient - GatewayClient 实例
   * @param {object} logger
   */
  constructor(gatewayClient, logger) {
    this._gw = gatewayClient;
    this._logger = logger;
    // 已成功自举的 session key 集合
    this._bootstrapped = new Set();
    // 正在自举中的 Promise，防止并发重复调用
    this._pending = new Map();
  }

  /**
   * 确保给定 session key 已在 OpenClaw 中自举（幂等）。
   * @param {string} sessionKey
   */
  async ensureSession(sessionKey) {
    if (this._bootstrapped.has(sessionKey)) return;

    // 如果已经有并发正在自举，等它结束
    if (this._pending.has(sessionKey)) {
      await this._pending.get(sessionKey);
      return;
    }

    const p = this._doBootstrap(sessionKey);
    this._pending.set(sessionKey, p);
    try {
      await p;
    } finally {
      this._pending.delete(sessionKey);
    }
  }

  async _doBootstrap(sessionKey) {
    try {
      const result = await this._gw.sessionsPatch({ key: sessionKey });
      const sessionId = String(result?.entry?.sessionId || "").slice(0, 8);
      this._bootstrapped.add(sessionKey);
      this._logger.info(`peer session bootstrapped key=${sessionKey} id=${sessionId}...`);
    } catch (err) {
      this._logger.warn(
        `peer session bootstrap failed key=${sessionKey}: ${err && err.message ? err.message : String(err)}`
      );
    }
  }
}

module.exports = { peerSessionKey, PEER_SESSION_PREFIX, PeerSessionManager };
