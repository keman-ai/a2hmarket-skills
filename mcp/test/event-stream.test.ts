import { describe, expect, it } from "vitest";

import { EventStreamClient } from "../src/event-stream.js";

/**
 * These tests exercise the SSE frame parser (`handleBlock`) without opening a
 * real network connection. The parser is the highest-risk piece of
 * event-stream.ts because a malformed dispatch corrupts every downstream tool
 * reply.
 *
 * We access the private `handleBlock` via a cast and listen to the `message`
 * event the same way `server.ts` does.
 */
function collect(client: EventStreamClient): unknown[] {
  const received: unknown[] = [];
  client.on("message", (payload) => {
    received.push(payload);
  });
  return received;
}

describe("EventStreamClient.handleBlock", () => {
  it("joins multi-line `data:` fields into a single JSON payload", () => {
    const client = new EventStreamClient("http://unused", "t");
    const received = collect(client);

    // SSE spec: adjacent `data:` lines in one event get joined by `\n`.
    const block =
      'data: {"type":"chat",\n' +
      'data:  "text":"hello\\nworld"}';
    (client as unknown as { handleBlock(b: string): void }).handleBlock(block);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ type: "chat", text: "hello\nworld" });
  });

  it("skips heartbeat comment lines starting with `:`", () => {
    const client = new EventStreamClient("http://unused", "t");
    const received = collect(client);

    // A pure heartbeat frame → no `data:` at all → nothing emitted.
    (client as unknown as { handleBlock(b: string): void }).handleBlock(
      ": keep-alive",
    );
    expect(received).toHaveLength(0);

    // Mixed frame: comment + real data → comment ignored, data emitted.
    (client as unknown as { handleBlock(b: string): void }).handleBlock(
      ': heartbeat\ndata: {"ok":true}',
    );
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ ok: true });
  });

  it("falls back to raw text when payload is not valid JSON", () => {
    const client = new EventStreamClient("http://unused", "t");
    const received = collect(client);

    (client as unknown as { handleBlock(b: string): void }).handleBlock(
      "data: not json",
    );
    expect(received).toEqual([{ text: "not json" }]);
  });
});
