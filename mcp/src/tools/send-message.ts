import type { A2hApiClient } from "../api-client.js";
import type { Credentials } from "../config.js";

export interface ToolContext {
  api: A2hApiClient;
  creds: Credentials;
}

const descriptor = {
  name: "send_message_to_ai",
  description:
    "Send a user message (text + optional attachments) to the A2H Market AI assistant. " +
    "REPLY ARRIVES ASYNCHRONOUSLY — this call returns a messageId only; do NOT wait inside this call. " +
    "Standard pattern: " +
    "(1) if user's message has attachments, call upload_attachment for each first, collect the returned objects. " +
    "(2) call send_message_to_ai with { content: <user's literal text>, attachments: [<uploaded objects>] }. " +
    "(3) immediately start polling check_inbox every ~3s, up to ~40 times (~120s wall time); " +
    "stop on first non-empty events. " +
    "STRICT FIELD NAMES (not negotiable): use `content` (NOT message/text/body); use `attachments` (NOT files/media/uploads). " +
    "Pass through the user's original wording in `content` — don't paraphrase or translate. " +
    "Tell the user up front 'I'm asking the A2H assistant, expect 1–2 minutes' so the polling delay isn't surprising.",
  inputSchema: {
    type: "object" as const,
    properties: {
      content: {
        type: "string" as const,
        description: "The user message text",
      },
      attachments: {
        type: "array" as const,
        description:
          "Optional file attachments. Each item is the object returned by " +
          "upload_attachment ({url, mediaType, mimeType, fileSize, originalName}). " +
          "First call upload_attachment for each file, then drop the returned " +
          "objects here.",
        items: {
          type: "object" as const,
          properties: {
            url: { type: "string" as const },
            mediaType: {
              type: "integer" as const,
              description: "1=image, 2=audio, 3=video, 4=file",
            },
            mimeType: { type: "string" as const },
            fileSize: { type: "integer" as const },
            originalName: { type: "string" as const },
            thumbnailUrl: { type: "string" as const },
            durationMs: { type: "integer" as const },
            width: { type: "integer" as const },
            height: { type: "integer" as const },
          },
          required: ["url" as const],
        },
      },
    },
    required: ["content" as const],
  },
};

export const sendMessageTool = {
  name: descriptor.name,
  descriptor,
  handler: async (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    const content = args?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("content is required");
    }
    const attachments = Array.isArray(args?.attachments)
      ? (args.attachments as unknown[])
      : undefined;
    const result = await ctx.api.sendMessage(content, attachments);
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
