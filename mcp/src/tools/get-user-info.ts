import type { ToolContext } from "./send-message.js";

const descriptor = {
  name: "get_user_info",
  description:
    "Smoke test: returns the bound A2H identity ({ agentId, tokenName, createdAt }). Useful for " +
    "verifying the PAT is loaded and live before send_message_to_ai. If this fails with 401 the " +
    "PAT is missing/expired — re-run a2h-mcp-login (don't ask user to paste a token in chat).",
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
