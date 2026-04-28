import { describe, expect, it, vi } from "vitest";

import { sendMessageTool } from "../../src/tools/send-message.js";
import type { Credentials } from "../../src/config.js";

const creds: Credentials = {
  token: "a2h_pat_x",
  agentId: "ag_1",
  tokenName: "test",
  createdAt: "2026-04-24T00:00:00Z",
};

describe("sendMessageTool", () => {
  it("descriptor exposes the expected shape", () => {
    expect(sendMessageTool.descriptor.name).toBe("send_message_to_ai");
    expect(sendMessageTool.descriptor.inputSchema.required).toContain(
      "content",
    );
  });

  it("delegates to api.sendMessage and wraps result as text", async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue({
        messageId: "m-42",
        sentAt: "2026-04-24T12:00:00Z",
      }),
    };
    const out = await sendMessageTool.handler(
      { content: "hello ai" },
      { api: api as never, creds },
    );
    // attachments is now an optional second arg; absent → undefined
    expect(api.sendMessage).toHaveBeenCalledWith("hello ai", undefined);
    expect(out.content).toHaveLength(1);
    expect(out.content[0].type).toBe("text");
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.messageId).toBe("m-42");
  });

  it("rejects blank content", async () => {
    const api = { sendMessage: vi.fn() };
    await expect(
      sendMessageTool.handler({ content: "   " }, { api: api as never, creds }),
    ).rejects.toThrow(/required/);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects non-string content", async () => {
    const api = { sendMessage: vi.fn() };
    await expect(
      sendMessageTool.handler({ content: 123 }, { api: api as never, creds }),
    ).rejects.toThrow(/required/);
  });
});
