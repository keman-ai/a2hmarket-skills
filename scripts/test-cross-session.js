#!/usr/bin/env node
/**
 * 跨 session 通信验证脚本
 *
 * 流程：
 *   1. 连接 Gateway
 *   2. 用 PeerSessionManager 自举一个 peer 专属 session
 *   3. 在该 session 中交互 3 轮消息
 *   4. 列出所有 session，寻找飞书 session
 *   5. 向飞书 session 发送摘要（直接 chat.send）
 *   6. 若无飞书 session，回退到 main session
 *
 * 用法：
 *   node scripts/test-cross-session.js
 */

const { GatewayClient } = require("../runtime/js/src/gateway/gateway-client");
const { PeerSessionManager, peerSessionKey } = require("../runtime/js/src/gateway/peer-session-manager");

const TEST_PEER_ID = "ag_test_peer";
const TEST_SESSION_KEY = peerSessionKey(TEST_PEER_ID);  // agent:main:a2hmarket:ag_test_peer
const MAIN_SESSION_KEY = "agent:main:main";

const logger = {
  info: (...args) => console.log("[info]", ...args),
  warn: (...args) => console.warn("[warn]", ...args),
  error: (...args) => console.error("[error]", ...args),
  debug: () => {},
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const gw = new GatewayClient({ logger });

  // ---- Step 1: 连接 Gateway ----
  logger.info("Step 1: 连接 Gateway ...");
  await gw.connect();
  logger.info("Gateway 已连接\n");

  // ---- Step 2: 用 PeerSessionManager 自举 peer 专属 session ----
  logger.info(`Step 2: 通过 PeerSessionManager 自举 peer session key=${TEST_SESSION_KEY} ...`);
  const peerMgr = new PeerSessionManager(gw, logger);
  await peerMgr.ensureSession(TEST_SESSION_KEY);
  // 再调一次确认幂等性（第二次应直接从缓存命中，不再发网络请求）
  await peerMgr.ensureSession(TEST_SESSION_KEY);
  logger.info(`peer session 自举完成，验证幂等性 OK\n`);

  // ---- Step 3: 在测试 session 中交互 3 轮 ----
  const messages = [
    "【跨 session 测试 Round 1】这是来自 a2hmarket:test session 的第一条消息。请确认收到。",
    "【跨 session 测试 Round 2】模拟市场消息处理：收到对手 ag_test 的报价 200 元/小时。",
    "【跨 session 测试 Round 3】模拟市场消息处理：双方已就价格达成一致，准备创建订单。",
  ];

  for (let i = 0; i < messages.length; i++) {
    logger.info(`Step 3.${i + 1}: 向测试 session 发送消息 ...`);
    await gw.chatSend({ sessionKey: TEST_SESSION_KEY, message: messages[i] });
    logger.info(`  已发送: ${messages[i].slice(0, 60)}...`);
    await sleep(1000);
  }
  logger.info("");

  // ---- Step 4: 列出所有 session，寻找飞书 session ----
  logger.info("Step 4: 列出所有 session ...");
  const listResult = await gw.sessionsList();
  const sessions = Array.isArray(listResult?.sessions) ? listResult.sessions : [];
  logger.info(`共 ${sessions.length} 个 session：`);
  for (const s of sessions) {
    const key = s.key || "(no key)";
    const id = s.sessionId || "(no id)";
    const label = s.label || "";
    logger.info(`  key=${key}  id=${id.slice(0, 8)}...  label=${label}`);
  }
  logger.info("");

  // 寻找飞书 session（key 中包含 feishu/lark）
  const feishuSession = sessions.find((s) => {
    const k = String(s.key || "").toLowerCase();
    return k.includes("feishu") || k.includes("lark");
  });

  // ---- Step 5: 发送摘要 ----
  const summary = [
    "【关键事件摘要 - 跨 session 通信测试】",
    `peer_session: ${TEST_SESSION_KEY}`,
    `peer_id: ${TEST_PEER_ID}`,
    "",
    "模拟结果: 双方已就价格达成一致，准备创建订单。",
    "(本条消息由 peer session 跨 session 发送到此 session，验证通知链路。)",
  ].join("\n");

  if (feishuSession) {
    const feishuKey = feishuSession.key;
    logger.info(`Step 5: 找到飞书 session key=${feishuKey}`);

    // 通过 chat.send 直接注入到飞书 session，在飞书侧会触发通知
    logger.info("  通过 chat.send 发送摘要到飞书 session ...");
    try {
      await gw.chatSend({ sessionKey: feishuKey, message: summary });
      logger.info("  ✅ 已发送摘要到飞书 session\n");
    } catch (err) {
      logger.error(`  chat.send 到飞书 session 失败: ${err.message}\n`);
    }
  } else {
    logger.info("Step 5: 未找到飞书 session，改为发送到 main session ...");
    try {
      await gw.chatSend({ sessionKey: MAIN_SESSION_KEY, message: summary });
      logger.info("  ✅ 已发送摘要到 main session\n");
    } catch (err) {
      logger.error(`  发送到 main session 失败: ${err.message}\n`);
    }
  }

  // ---- 清理 ----
  logger.info("测试完成，断开 Gateway。");
  gw.disconnect();
}

main().catch((err) => {
  console.error("[fatal]", err.message || err);
  process.exit(1);
});
