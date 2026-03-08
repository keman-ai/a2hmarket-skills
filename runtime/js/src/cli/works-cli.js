const { loadCredentials, fetchJson, postJson, outputOk, outputError } = require("./api-client");
const { parseOptions } = require("./arg-parser");

const SEARCH_API = "/findu-match/api/v1/inner/match/works_search";
const PUBLISH_API = "/findu-user/api/v1/user/works/change-requests";
const LIST_API_BASE = "/findu-user/api/v1/user/works/public";

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  a2hmarket works search --keyword <text> [--type <2|3>] [--city <city>] [--page <n>] [--page-size <n>]",
      "  a2hmarket works publish --type <2|3> --title <title> --content <text> [--expected-price <text>] [--service-method <online|offline>] [--service-location <loc>] [--picture <url>]... --confirm-human-reviewed true",
      "  a2hmarket works list [--type <2|3>] [--page <n>] [--page-size <n>]",
      "",
      "  type: 2=需求帖  3=服务帖",
    ].join("\n") + "\n"
  );
}

// -------------------------------------------------------------------------
// works search
// -------------------------------------------------------------------------

async function cmdSearch(creds, opts) {
  const keyword = opts["keyword"] || opts["k"] || "";
  const type = opts["type"] != null ? Number(opts["type"]) : undefined;
  const city = opts["city"] || undefined;
  // pageNum 从 0 开始（API 约定），CLI --page 从 1 开始，转换时减 1
  const page = opts["page"] != null ? Math.max(0, Number(opts["page"]) - 1) : 0;
  const pageSize = opts["page-size"] != null ? Number(opts["page-size"]) : 10;

  const body = { serviceInfo: keyword, pageNum: page, pageSize };
  if (type !== undefined) body.type = type;
  if (city) body.city = city;

  const data = await postJson({ creds, apiPath: SEARCH_API, body });
  outputOk("works.search", data);
}

// -------------------------------------------------------------------------
// works publish
// -------------------------------------------------------------------------

async function cmdPublish(creds, opts) {
  if (!opts["confirm-human-reviewed"] || String(opts["confirm-human-reviewed"]).toLowerCase() !== "true") {
    outputError("works.publish", {
      message:
        "必须显式声明 --confirm-human-reviewed true 才能发布帖子。请确认帖子内容已经过人工审阅再发布。",
      platformCode: "CONFIRMATION_REQUIRED",
    });
    return 1;
  }

  const type = opts["type"] != null ? Number(opts["type"]) : null;
  if (!type || (type !== 2 && type !== 3)) {
    outputError("works.publish", {
      message: "--type 必须为 2（需求帖）或 3（服务帖）",
      platformCode: "INVALID_ARGUMENT",
    });
    return 1;
  }

  const title = opts["title"] || "";
  const content = opts["content"] || "";
  if (!title) {
    outputError("works.publish", { message: "--title 不能为空", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  if (!content) {
    outputError("works.publish", { message: "--content 不能为空", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  if (content.length > 2000) {
    outputError("works.publish", {
      message: "--content 最多 2000 字符",
      platformCode: "INVALID_ARGUMENT",
    });
    return 1;
  }

  const body = { type, title, content };
  if (opts["expected-price"]) body.expectedPrice = opts["expected-price"];
  if (opts["service-method"]) body.serviceMethod = opts["service-method"];
  if (opts["service-location"]) body.serviceLocation = opts["service-location"];
  // --picture 可多次使用（parseOptions 只会取最后一个值，此处尝试收集所有）
  // 由于 parseOptions 不支持 array，这里仅取最后出现的值
  if (opts["picture"]) body.pictures = [opts["picture"]];

  const data = await postJson({ creds, apiPath: PUBLISH_API, body });
  outputOk("works.publish", data);
  return 0;
}

// -------------------------------------------------------------------------
// works list
// -------------------------------------------------------------------------

async function cmdList(creds, opts) {
  const type = opts["type"] != null ? Number(opts["type"]) : undefined;
  const page = opts["page"] != null ? Number(opts["page"]) : 1;
  const pageSize = opts["page-size"] != null ? Number(opts["page-size"]) : 20;

  const qs = new URLSearchParams({ pageNum: String(page), pageSize: String(pageSize) });
  if (type !== undefined) qs.set("type", String(type));

  const apiPath = `${LIST_API_BASE}?${qs.toString()}`;
  // 签名路径不含查询参数
  const data = await fetchJson({ creds, apiPath, signPath: LIST_API_BASE });
  outputOk("works.list", data);
}

// -------------------------------------------------------------------------
// 路由入口
// -------------------------------------------------------------------------

async function runWorksCli(args) {
  const sub = args[0];
  const opts = parseOptions(args.slice(1));
  if (!sub || opts.help || opts.h) {
    printUsage();
    return 1;
  }

  try {
    const creds = loadCredentials();

    if (sub === "search") {
      await cmdSearch(creds, opts);
      return 0;
    }
    if (sub === "publish") {
      return await cmdPublish(creds, opts);
    }
    if (sub === "list") {
      await cmdList(creds, opts);
      return 0;
    }
    if (sub === "get") {
      outputError("works.get", {
        message: "works get 为 P2 功能，尚未实现。",
        platformCode: "NOT_IMPLEMENTED",
      });
      return 1;
    }

    process.stderr.write(`unknown works sub-command: ${sub}\n`);
    printUsage();
    return 1;
  } catch (err) {
    const action = `works.${sub}`;
    outputError(action, err);
    return 1;
  }
}

module.exports = { runWorksCli };
