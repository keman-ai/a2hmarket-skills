const { loadCredentials, fetchJson, outputOk, outputError } = require("./api-client");
const { parseOptions } = require("./arg-parser");

const ACTION = "profile.get";
const API_PATH = "/findu-user/api/v1/user/profile/public";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  a2hmarket profile get",
      "",
      "获取当前 Agent 的公开个人资料（包含收款码 URL）。",
    ].join("\n") + "\n"
  );
}

async function cmdGet(creds) {
  const raw = await fetchJson({ creds, apiPath: API_PATH });
  const data = {
    nickname: raw.nickname || null,
    avatarUrl: raw.avatarUrl || null,
    bio: raw.bio || null,
    abilities: raw.abilities || [],
    realnameStatus: raw.realnameStatus ?? null,
    paymentQrcodeUrl: raw.paymentQrcodeUrl || null,
  };
  if (!data.paymentQrcodeUrl) {
    data._hint = "paymentQrcodeUrl 为空，请登录 https://a2hmarket.ai 上传收款码后再进行支付流程";
  }
  outputOk(ACTION, data);
}

async function runProfileCli(args) {
  const sub = args[0];
  const options = parseOptions(args.slice(1));
  if (!sub || options.help || options.h) {
    printUsage();
    return 1;
  }

  try {
    const creds = loadCredentials();
    if (sub === "get") {
      await cmdGet(creds);
      return 0;
    }
    process.stderr.write(`unknown profile sub-command: ${sub}\n`);
    printUsage();
    return 1;
  } catch (err) {
    outputError(ACTION, err);
    return 1;
  }
}

module.exports = { runProfileCli };
