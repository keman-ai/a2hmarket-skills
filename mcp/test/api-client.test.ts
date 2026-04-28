import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { A2hApiClient } from "../src/api-client.js";
import * as undici from "undici";

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

const requestMock = undici.request as unknown as ReturnType<typeof vi.fn>;

function mockResponse(statusCode: number, bodyText: string) {
  return {
    statusCode,
    body: {
      text: async () => bodyText,
    },
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("A2hApiClient.sendMessage", () => {
  it("returns data on 200 ApiResponse envelope", async () => {
    requestMock.mockResolvedValueOnce(
      mockResponse(
        200,
        JSON.stringify({
          code: 0,
          message: "ok",
          data: { messageId: "msg-1", sentAt: "2026-04-24T00:00:00Z" },
        }),
      ),
    );
    const client = new A2hApiClient(
      "https://api.a2hmarket.ai/a2hmarket-concierge",
      "a2h_pat_abc",
    );
    const out = await client.sendMessage("hello");
    expect(out.messageId).toBe("msg-1");
    expect(out.sentAt).toBe("2026-04-24T00:00:00Z");

    const [url, opts] = requestMock.mock.calls[0];
    expect(url).toBe(
      "https://api.a2hmarket.ai/a2hmarket-concierge/api/v1/agent/messages",
    );
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer a2h_pat_abc");
    expect(JSON.parse(opts.body as string)).toEqual({
      content: "hello",
      attachments: undefined,
    });
  });

  it("throws on 401", async () => {
    requestMock.mockResolvedValueOnce(mockResponse(401, "unauthorized"));
    const client = new A2hApiClient("https://x", "bad");
    await expect(client.sendMessage("hi")).rejects.toThrow(/failed 401/);
  });

  it("throws on 500", async () => {
    requestMock.mockResolvedValueOnce(mockResponse(500, "boom"));
    const client = new A2hApiClient("https://x", "ok");
    await expect(client.sendMessage("hi")).rejects.toThrow(/failed 500/);
  });

  it("accepts response without ApiResponse envelope", async () => {
    requestMock.mockResolvedValueOnce(
      mockResponse(200, JSON.stringify({ messageId: "m", sentAt: "t" })),
    );
    const client = new A2hApiClient("https://x", "ok");
    const out = await client.sendMessage("hi");
    expect(out.messageId).toBe("m");
  });
});
