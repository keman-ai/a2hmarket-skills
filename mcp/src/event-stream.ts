import { EventEmitter } from "node:events";
import { request } from "undici";

/**
 * SSE client that subscribes to `GET /api/v1/agent/events/stream` on concierge
 * and emits `message` events for every `data:` line. Reconnects with
 * exponential backoff on error or disconnect.
 */
export class EventStreamClient extends EventEmitter {
  private stopped = false;
  private backoffMs = 1000;
  private readonly maxBackoffMs = 30_000;
  private abortController: AbortController | null = null;

  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {
    super();
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const connectStart = Date.now();
      try {
        await this.connectOnce();
      } catch (err) {
        this.emit("error", err);
      }
      if (this.stopped) {
        return;
      }
      // Only reset backoff if the connection stayed alive for a meaningful
      // window. Otherwise a fast-flapping server (immediate clean close or
      // instant handshake failure) would make us busy-spin reconnecting.
      const ranForMs = Date.now() - connectStart;
      if (ranForMs > 10_000) {
        this.backoffMs = 1000;
      }
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private async connectOnce(): Promise<void> {
    this.abortController = new AbortController();
    const url = `${this.base}/api/v1/agent/events/stream`;
    const { statusCode, body } = await request(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "text/event-stream",
      },
      signal: this.abortController.signal,
      // SSE is a long-lived stream: don't let undici's default 300s body
      // timeout kill it; keep a short handshake timeout so a hung TLS
      // negotiation doesn't block reconnect forever.
      bodyTimeout: 0,
      headersTimeout: 10_000,
    });
    if (statusCode !== 200) {
      const text = await body.text();
      throw new Error(`SSE failed ${statusCode}: ${text}`);
    }
    this.emit("open");

    let buf = "";
    for await (const chunk of body) {
      if (this.stopped) {
        return;
      }
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      // SSE events are separated by `\n\n`
      let idx = buf.indexOf("\n\n");
      while (idx !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        this.handleBlock(block);
        idx = buf.indexOf("\n\n");
      }
    }
  }

  private handleBlock(block: string): void {
    const dataLines: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.trimEnd();
      if (line.startsWith(":")) {
        // comment / heartbeat — ignore
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^\s/, ""));
      }
    }
    if (dataLines.length === 0) {
      return;
    }
    const payload = dataLines.join("\n");
    try {
      const parsed = JSON.parse(payload);
      this.emit("message", parsed);
    } catch {
      // raw text fallback
      this.emit("message", { text: payload });
    }
  }
}
