#!/usr/bin/env node
/**
 * 测试 Gateway 是否支持 sourceSessionKey 回复路由
 *
 * 问题背景：
 *   peer session AI 向飞书 session 发通知时，飞书用户的回复停留在飞书 session，
 *   无法自动路由到 a2hmarket:{agentId} peer session。
 *
 * 本脚本测试：
 *   1. 向飞书 session 发送一条带 sourceSessionKey 的消息
 *      （sourceSessionKey = peer session key）
 *   2. 观察 Gateway 是否接受该参数（不报错则协议层支持）
 *   3. 在飞书侧手动回复后，观察回复是否出现在 peer session（需人工验证）
 *
 * 用法：
 *   node scripts/test-reply-routing.js
 */

const { GatewayClient } = require("../runtime/js/src/gateway/gateway-client");
const { PeerSessionManager, peerSessionKey } = require("../runtime/js/src/gateway/peer-session-manager");

const TEST_PEER_ID = "ag_test_peer";
const PEER_SESSION_KEY = peerSessionKey(TEST_PEER_ID); // agent:main:a2hmarket:ag_test_peer

const logger = {
  info: (...args) => console.log("[info]", ...args),
  warn: (...args) => console.warn("[warn]", ...args),
  error: (...args) => console.error("[error]", ...args),
  debug: () => {},
};

async function main() {
  const gw = new GatewayClient({ logger });

  logger.info("Step 1: 连接 Gateway ...");
  await gw.connect();
  logger.info("Gateway 已连接\n");

  // Step 2: 自举 peer session
  logger.info(`Step 2: 自举 peer session key=${PEER_SESSION_KEY}`);
  const peerMgr = new PeerSessionManager(gw, logger);
  await peerMgr.ensureSession(PEER_SESSION_KEY);
  logger.info("peer session 自举完成\n");

  // Step 3: 列出 session，找飞书 session
  logger.info("Step 3: 列出所有 session ...");
  const listResult = await gw.sessionsList();
  const sessions = Array.isArray(listResult?.sessions) ? listResult.sessions : [];
  for (const s of sessions) {
    logger.info(`  key=${s.key}  id=${String(s.sessionId || "").slice(0, 8)}...`);
  }

  const feishuSession = sessions.find((s) => {
    const k = String(s.key || "").toLowerCase();
    return k.includes("feishu") || k.includes("lark");
  });

  if (!feishuSession) {
    logger.warn("未找到飞书 session，无法测试回复路由。脚本退出。");
    gw.disconnect();
    return;
  }

  const feishuKey = feishuSession.key;
  logger.info(`\n找到飞书 session: ${feishuKey}`);

  // Step 4: 向飞书 session 发通知，携带 sourceSessionKey
  const message = [
    `[A2H Market 回复路由测试]`,
    `peer_session: ${PEER_SESSION_KEY}`,
    ``,
    `你好！这是一条来自 peer session 的测试通知。`,
    `请在飞书中回复此消息。`,
    ``,
    `预期行为：你的回复应该出现在 peer session (${PEER_SESSION_KEY}) 中，`,
    `而不是停留在飞书 session 里。`,
  ].join("\n");

  logger.info(`\nStep 4: 向飞书 session 发送通知（携带 sourceSessionKey=${PEER_SESSION_KEY}）...`);
  try {
    await gw.chatSend({
      sessionKey: feishuKey,
      message,
      sourceSessionKey: PEER_SESSION_KEY,
    });
    logger.info("✅ chat.send 成功（Gateway 接受了 sourceSessionKey 参数）");
    logger.info("");
    logger.info("=== 下一步：人工验证 ===");
    logger.info("1. 在飞书中找到上面这条消息并回复任意内容");
    logger.info(`2. 检查 peer session (${PEER_SESSION_KEY}) 中是否出现你的回复`);
    logger.info("   → 若出现：Gateway 支持 sourceSessionKey 回复路由 ✅");
    logger.info("   → 若未出现：Gateway 不支持，需走应用层转发方案 ❌");
  } catch (err) {
    logger.error(`❌ chat.send 失败（Gateway 可能不接受 sourceSessionKey）: ${err.message}`);
    logger.info("");
    logger.info("结论：Gateway 不支持 sourceSessionKey，需走应用层转发方案。");
    logger.info("应用层方案：飞书 session SKILL 收到回复后主动 chat.send 到 peer session。");
  }

  gw.disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err.message || err);
  process.exit(1);
});
