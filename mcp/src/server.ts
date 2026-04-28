import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadCredentials, resolveApiBase } from "./config.js";
import { A2hApiClient } from "./api-client.js";
import { EventStreamClient } from "./event-stream.js";
import { sendMessageTool } from "./tools/send-message.js";
import { getUserInfoTool } from "./tools/get-user-info.js";
import { checkInboxTool } from "./tools/check-inbox.js";
import { uploadAttachmentTool } from "./tools/upload-attachment.js";

const SERVER_NAME = "a2h-mcp";
const SERVER_VERSION = "0.1.4";

/**
 * SSE 长连只对"长生命周期 MCP host"稳（CC / Cursor 本地进程）。MaxClaw / 其他
 * sandbox 平台进程可能被 kill + HTTP 代理对 SSE 不友好，必须走 pull 模式
 * （宿主 cron 定时调 {@code check_inbox}）。
 *
 * 默认**关闭** SSE，只暴露 pull 工具。CC 用户可手工 set A2H_SSE_MODE=1 启 SSE。
 */
const SSE_MODE = process.env.A2H_SSE_MODE === "1";

/**
 * Entry point for the stdio MCP server. If no credentials are present, only a
 * `login` helper tool is exposed. When authenticated the real tools plus a
 * concierge SSE subscription are wired up.
 */
export async function start(): Promise<void> {
  const creds = loadCredentials();
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  if (!creds) {
    registerUnauthenticated(server);
  } else {
    registerAuthenticated(server, creds);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function registerUnauthenticated(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "login",
        description:
          "Run this tool to authenticate with A2H Market. It will print a command to run in a separate terminal.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    if (name === "login") {
      return {
        content: [
          {
            type: "text",
            text:
              "Not logged in. Two options:\n\n" +
              "1. Open https://a2hmarket.ai/authcode?code=SKILL-<random> in a browser, " +
              "authorize, copy the token shown on the success page, and add to your MCP server config:\n" +
              "    env: { \"A2H_PAT\": \"a2h_pat_...\" }\n" +
              "   Then reload the MCP server.\n\n" +
              "2. Or run in a terminal: `npx -y -p @a2hmarket/a2h-mcp a2h-mcp-login` " +
              "(prints the URL, polls until you authorize, writes ~/.a2h/credentials.json).",
          },
        ],
      };
    }
    throw new Error(`Unknown tool: ${name}`);
  });
}

function registerAuthenticated(
  server: Server,
  creds: ReturnType<typeof loadCredentials> & object,
): void {
  const apiBase = resolveApiBase();
  const api = new A2hApiClient(apiBase, creds.token);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      sendMessageTool.descriptor,
      checkInboxTool.descriptor,
      uploadAttachmentTool.descriptor,
      getUserInfoTool.descriptor,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const ctx = { api, creds };
    if (name === sendMessageTool.name) {
      return await sendMessageTool.handler(args, ctx);
    }
    if (name === checkInboxTool.name) {
      return await checkInboxTool.handler(args, ctx);
    }
    if (name === uploadAttachmentTool.name) {
      return await uploadAttachmentTool.handler(args, ctx);
    }
    if (name === getUserInfoTool.name) {
      return await getUserInfoTool.handler(args, ctx);
    }
    throw new Error(`Unknown tool: ${name}`);
  });

  if (!SSE_MODE) {
    process.stderr.write(
      "[a2h-mcp] pull mode (default). Host should call `check_inbox` periodically (e.g. cron every 60s). Set A2H_SSE_MODE=1 to enable SSE push for long-lived hosts like Claude Code.\n",
    );
    return;
  }

  // SSE bridge → MCP notifications/a2h/event
  // NOTE: MCP 2024-11-05 reserves `notifications/message` for the server→client
  // logging channel with a strict `{level, logger?, data}` shape; strict hosts
  // drop non-conforming payloads. Use a custom method so unknown hosts just
  // ignore it instead of silently dropping on schema mismatch.
  const events = new EventStreamClient(apiBase, creds.token);
  events.on("message", (payload) => {
    void server.notification({
      method: "notifications/a2h/event",
      params: payload as Record<string, unknown>,
    });
  });
  events.on("error", (err: unknown) => {
    // Log to stderr; stdout is reserved for the JSON-RPC channel.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[a2h-mcp] event-stream error: ${msg}\n`);
  });
  events.start();
  process.stderr.write("[a2h-mcp] SSE mode enabled.\n");
}
