const fs = require("node:fs");
const path = require("node:path");
const { loadCredentials, fetchJson, postJson, postJsonToHost, putBinary, outputOk, outputError } = require("./api-client");
const { parseOptions } = require("./arg-parser");

const PROFILE_API_PATH = "/findu-user/api/v1/user/profile/public";
const CHANGE_REQUEST_PATH = "/findu-user/api/v1/user/profile/change-requests";

// OSS 签名服务：独立域名，签名路径需带 /findu-oss 前缀
const OSS_BASE_URL = "https://agent-api.qianmiao.life/findu-oss";
const OSS_SIGN_API_PATH = "/api/v1/oss_signurl/upload/sign";
const OSS_SIGN_SIGN_PATH = "/findu-oss/api/v1/oss_signurl/upload/sign";

const ALLOWED_MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  a2hmarket profile get",
      "  a2hmarket profile upload-qrcode --file <local-file-path>",
      "  a2hmarket profile delete-qrcode",
      "",
      "获取或更新当前 Agent 的收款二维码。",
    ].join("\n") + "\n"
  );
}

// ---------------------------------------------------------------------------
// profile get
// ---------------------------------------------------------------------------

async function cmdGet(creds) {
  const raw = await fetchJson({ creds, apiPath: PROFILE_API_PATH });
  const data = {
    nickname: raw.nickname || null,
    avatarUrl: raw.avatarUrl || null,
    bio: raw.bio || null,
    abilities: raw.abilities || [],
    realnameStatus: raw.realnameStatus ?? null,
    paymentQrcodeUrl: raw.paymentQrcodeUrl || null,
  };
  if (!data.paymentQrcodeUrl) {
    data._hint = "paymentQrcodeUrl 为空，可通过 `profile upload-qrcode --file <path>` 上传收款码";
  }
  outputOk("profile.get", data);
}

// ---------------------------------------------------------------------------
// profile upload-qrcode
// ---------------------------------------------------------------------------

async function cmdUploadQrcode(creds, opts) {
  const filePath = opts["file"] || opts["f"];
  if (!filePath) {
    outputError("profile.upload-qrcode", {
      message: "--file 不能为空，请传入本地收款码图片路径（支持 jpg / png / webp）",
      platformCode: "INVALID_ARGUMENT",
    });
    return 1;
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    outputError("profile.upload-qrcode", {
      message: `文件不存在: ${absPath}`,
      platformCode: "FILE_NOT_FOUND",
    });
    return 1;
  }

  const ext = path.extname(absPath).toLowerCase();
  const mimeType = ALLOWED_MIME_TYPES[ext];
  if (!mimeType) {
    outputError("profile.upload-qrcode", {
      message: `不支持的文件格式 "${ext}"，仅支持 jpg / jpeg / png / webp`,
      platformCode: "INVALID_ARGUMENT",
    });
    return 1;
  }

  const binary = fs.readFileSync(absPath);
  if (binary.length === 0) {
    outputError("profile.upload-qrcode", {
      message: "文件内容为空，请检查文件是否正确",
      platformCode: "INVALID_ARGUMENT",
    });
    return 1;
  }

  const fileName = `payment-${Date.now()}${ext}`;

  // Step 1: 获取 OSS 上传签名
  const ossSignData = await postJsonToHost({
    creds,
    baseUrl: OSS_BASE_URL,
    apiPath: OSS_SIGN_API_PATH,
    signPath: OSS_SIGN_SIGN_PATH,
    body: {
      upload_type: "profile",
      upload_subtype: "payment",
      file_name: fileName,
      file_size: binary.length,
      file_type: mimeType,
    },
  });

  const uploadUrl = ossSignData.upload_url;
  const signedHeaders = ossSignData.signed_headers || {};
  const objectKey = ossSignData.object_key || null;

  if (!uploadUrl) {
    throw new Error("OSS 签名接口未返回 upload_url，请稍后重试");
  }

  // Step 2: 直传文件到 OSS
  await putBinary({ uploadUrl, headers: signedHeaders, binary });

  // Step 3: 最终公开 URL = upload_url 去掉 query string
  const finalUrl = (() => {
    const u = new URL(uploadUrl);
    u.search = "";
    u.hash = "";
    return u.toString();
  })();

  // Step 4: 提交 paymentQrcodeUrl 变更
  const changeData = await postJson({
    creds,
    apiPath: CHANGE_REQUEST_PATH,
    body: { key: "paymentQrcodeUrl", value: finalUrl },
  });

  outputOk("profile.upload-qrcode", {
    paymentQrcodeUrl: finalUrl,
    objectKey,
    changeRequestId: changeData?.changeRequestId ?? null,
    changeStatus: changeData?.status ?? null,
  });
  return 0;
}

// ---------------------------------------------------------------------------
// profile delete-qrcode
// ---------------------------------------------------------------------------

async function cmdDeleteQrcode(creds) {
  const changeData = await postJson({
    creds,
    apiPath: CHANGE_REQUEST_PATH,
    body: { key: "paymentQrcodeUrl", value: "" },
  });

  outputOk("profile.delete-qrcode", {
    paymentQrcodeUrl: null,
    changeRequestId: changeData?.changeRequestId ?? null,
    changeStatus: changeData?.status ?? null,
  });
  return 0;
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

async function runProfileCli(args) {
  const sub = args[0];
  const options = parseOptions(args.slice(1));
  if (!sub || options.help || options.h) {
    printUsage();
    return 1;
  }

  const action = `profile.${sub}`;
  try {
    const creds = loadCredentials();
    if (sub === "get") {
      await cmdGet(creds);
      return 0;
    }
    if (sub === "upload-qrcode") {
      return await cmdUploadQrcode(creds, options);
    }
    if (sub === "delete-qrcode") {
      await cmdDeleteQrcode(creds);
      return 0;
    }
    process.stderr.write(`unknown profile sub-command: ${sub}\n`);
    printUsage();
    return 1;
  } catch (err) {
    outputError(action, err);
    return 1;
  }
}

module.exports = { runProfileCli };
