const { loadCredentials, fetchJson, postJson, outputOk, outputError } = require("./api-client");
const { parseOptions } = require("./arg-parser");

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  a2hmarket order create --customer-id <id> --title <title> --content <text> --price-cent <n> --product-id <id>",
      "  a2hmarket order confirm --order-id <id>",
      "  a2hmarket order get --order-id <id>",
      "",
      "  price-cent: 以分为单位的正整数，例如 10000 = 100元",
    ].join("\n") + "\n"
  );
}

// -------------------------------------------------------------------------
// order create
// -------------------------------------------------------------------------

async function cmdCreate(creds, opts) {
  const customerId = opts["customer-id"] || "";
  const title = opts["title"] || "";
  const content = opts["content"] || "";
  const priceCentRaw = opts["price-cent"];
  const productId = opts["product-id"] || "";

  if (!customerId) {
    outputError("order.create", { message: "--customer-id 不能为空", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  if (!title) {
    outputError("order.create", { message: "--title 不能为空", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  if (!content) {
    outputError("order.create", { message: "--content 不能为空", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  if (!productId) {
    outputError("order.create", { message: "--product-id 不能为空，需填写对应的 works ID", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  if (priceCentRaw == null) {
    outputError("order.create", { message: "--price-cent 不能为空，单位为分（正整数），例如 10000 = 100元", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  const priceCent = Number(priceCentRaw);
  if (!Number.isInteger(priceCent) || priceCent <= 0) {
    outputError("order.create", {
      message: `--price-cent 必须为正整数（当前值: ${priceCentRaw}），单位为分，例如 10000 = 100元`,
      platformCode: "INVALID_ARGUMENT",
    });
    return 1;
  }
  if (title.length > 100) {
    outputError("order.create", { message: "--title 最多 100 字符", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }

  const body = {
    providerId: creds.agentId,
    customerId,
    title,
    content,
    price: priceCent,
    productId,
  };

  const data = await postJson({ creds, apiPath: "/findu-trade/api/v1/orders/create", body });
  outputOk("order.create", data);
  return 0;
}

// -------------------------------------------------------------------------
// order confirm
// -------------------------------------------------------------------------

async function cmdConfirm(creds, opts) {
  const orderId = opts["order-id"] || "";
  if (!orderId) {
    outputError("order.confirm", { message: "--order-id 不能为空", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  const apiPath = `/findu-trade/api/v1/orders/${orderId}/confirm`;
  const data = await postJson({ creds, apiPath, body: {} });
  outputOk("order.confirm", data);
  return 0;
}

// -------------------------------------------------------------------------
// order get
// -------------------------------------------------------------------------

async function cmdGet(creds, opts) {
  const orderId = opts["order-id"] || "";
  if (!orderId) {
    outputError("order.get", { message: "--order-id 不能为空", platformCode: "INVALID_ARGUMENT" });
    return 1;
  }
  const apiPath = `/findu-trade/api/v1/orders/${orderId}/detail`;
  const raw = await fetchJson({ creds, apiPath });
  const data = {
    orderId: raw.orderId || raw.id || null,
    providerId: raw.providerId || null,
    customerId: raw.customerId || null,
    title: raw.title || null,
    content: raw.content || null,
    price: raw.price ?? null,
    productId: raw.productId || null,
    status: raw.status || null,
    currentType: raw.currentType || null,
    profile: raw.profile || null,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
  outputOk("order.get", data);
  return 0;
}

// -------------------------------------------------------------------------
// 路由入口
// -------------------------------------------------------------------------

async function runOrderCli(args) {
  const sub = args[0];
  const opts = parseOptions(args.slice(1));
  if (!sub || opts.help || opts.h) {
    printUsage();
    return 1;
  }

  try {
    const creds = loadCredentials();

    if (sub === "create") return await cmdCreate(creds, opts);
    if (sub === "confirm") return await cmdConfirm(creds, opts);
    if (sub === "get") return await cmdGet(creds, opts);

    // P2 stubs
    const p2cmds = ["reject", "cancel", "list-sales", "list-purchase", "review-create", "review-list"];
    if (p2cmds.includes(sub)) {
      outputError(`order.${sub}`, {
        message: `order ${sub} 为 P2 功能，尚未实现。`,
        platformCode: "NOT_IMPLEMENTED",
      });
      return 1;
    }

    process.stderr.write(`unknown order sub-command: ${sub}\n`);
    printUsage();
    return 1;
  } catch (err) {
    const action = `order.${sub}`;
    outputError(action, err);
    return 1;
  }
}

module.exports = { runOrderCli };
