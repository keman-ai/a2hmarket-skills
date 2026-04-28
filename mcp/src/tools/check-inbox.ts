import type { A2hApiClient } from "../api-client.js";

/**
 * `check_inbox` MCP tool.
 *
 * 给 sandbox 类 agent 平台用（MaxClaw / 类似）: 宿主进程生命周期不稳 + SSE 长连不可靠,
 * 必须靠**定时拉取**才能收到 AI 主动推送。宿主（如 MaxClaw）用 cron 每 1 分钟调一次
 * `a2h.check_inbox`, 拿到 events 后发到聊天界面。
 *
 * 后端一次性 drain（拉走即删），**不要二次调**。如果 hasMore=true 立刻再调一次直到空。
 *
 * 事件形状（和 SSE 推的 notifications/a2h/event payload 一致）:
 *   { messageId, senderAgentId, content, attachments, timestamp, ... }
 */
export const checkInboxTool = {
  name: "check_inbox",
  descriptor: {
    name: "check_inbox",
    description:
      "Pull all pending A2H AI assistant messages that arrived since the last call. " +
      "Safe to call from a scheduled job (e.g. MaxClaw cron every 1 minute). " +
      "Returns { events: [...], hasMore: boolean, count: number }. " +
      "If hasMore is true, call again immediately until it's empty.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max events per call (default 50, capped at 100).",
        },
      },
      required: [],
    },
  },
  handler: async (
    args: Record<string, unknown>,
    ctx: { api: A2hApiClient },
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    const limit = typeof args.limit === "number" ? args.limit : 50;
    const result = await ctx.api.pullEvents(limit);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
    };
  },
};
