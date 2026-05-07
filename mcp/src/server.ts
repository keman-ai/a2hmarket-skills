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
          "PAT not found in this MCP server's environment. Tell the user to run " +
          "`a2h-mcp-install` (one-shot install + login) or `a2h-mcp-login` (login only) in a " +
          "terminal. Never ask the user to paste a PAT into chat.",
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
              "Not logged in. The agent should run one of these commands in a terminal " +
              "(NOT ask the user to paste a token in chat):\n\n" +
              "  Option A — fresh setup:\n" +
              "    npm install -g @a2hmarket/a2h-mcp\n" +
              "    a2h-mcp-install\n\n" +
              "  Option B — already installed, just need to (re)login:\n" +
              "    a2h-mcp-login\n\n" +
              "  Option C — managed/headless env (MaxClaw etc., bash exec yields fast):\n" +
              "    a2h-mcp-login start         # mints code + URL, exits immediately\n" +
              "    # show URL to user → wait for them to confirm in browser →\n" +
              "    a2h-mcp-login finish        # polls briefly, exit 0/2/3\n\n" +
              "After the PAT is saved to ~/.a2h/credentials.json, restart this MCP server (or new chat session) so it picks up the credentials.",
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
