import type { ToolContext } from "./send-message.js";

const descriptor = {
  name: "get_user_info",
  description:
    "Get current A2H user identity (agentId, token name, login time).",
  inputSchema: {
    type: "object" as const,
    properties: {},
    required: [] as string[],
  },
};

export const getUserInfoTool = {
  name: descriptor.name,
  descriptor,
  handler: async (
    _args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    // Optional metadata — present when creds came from a full credentials.json
    // (login flow), absent when using A2H_PAT env or a bare-token file. Server
    // is the source of truth for agentId; this tool is just a local echo for
    // debugging "am I logged in?".
    const payload = {
      agentId: ctx.creds.agentId ?? "",
      tokenName: ctx.creds.tokenName ?? "",
      createdAt: ctx.creds.createdAt ?? "",
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
    };
  },
};
