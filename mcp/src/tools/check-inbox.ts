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
      "Pull pending replies from the A2H AI assistant. Server one-shot drains the queue (events you " +
      "receive will NOT come back next call), so you must consume each event in this response. " +
      "Two patterns to call this: " +
      "(A) Right after send_message_to_ai → poll every ~3s, up to ~40 times (~120s). Stop polling on " +
      "first response with non-empty `events`. If still empty after 40 attempts, tell the user 'A2H " +
      "assistant didn't reply yet, please try again' — never fabricate a reply. " +
      "(B) Standalone (sandbox / cron / 'check if anything arrived') → call once, render whatever's there. " +
      "Returns { events: [...], hasMore: boolean, count: number }. If hasMore=true, call again " +
      "IMMEDIATELY (no sleep) until hasMore=false to drain. " +
      "Each event shape: { messageId, senderAgentId, content, attachments?, timestamp, ... }. " +
      "RENDERING events to the user: " +
      "(1) write the `content` text first as the assistant's reply. " +
      "(2) for each item in `attachments` (each has { url, mediaType, mimeType, originalName, ... }), " +
      "render by mediaType — 1=image: markdown ![{originalName or '图片'}]({url}); 2=audio: " +
      "[🎵 {originalName or '音频'}]({url}); 3=video: [🎬 {originalName or '视频'}]({url}); " +
      "4=other file: [📎 {originalName}]({url}). NEVER paste raw event JSON to the user, NEVER omit " +
      "the url, NEVER substitute placeholders for missing media. The url is on a public CDN " +
      "(media.a2hmarket.ai / avatar.a2hmarket.ai) and renders directly in any markdown surface.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max events per call (default 50, capped at 100). Use 10 for fast polling, 50+ for cron drains.",
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
