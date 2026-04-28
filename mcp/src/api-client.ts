import { request } from "undici";

/**
 * HTTP client talking to a2hmarket-concierge. Sends JSON + Bearer PAT.
 */
export class A2hApiClient {
  constructor(
    private readonly base: string,
    private readonly token: string,
  ) {}

  get apiBase(): string {
    return this.base;
  }

  get bearer(): string {
    return this.token;
  }

  /**
   * POST /api/v1/agent/messages — send a user message to the AI assistant.
   * Returns the `data` payload from the `ApiResponse` envelope (concierge
   * wraps responses with `ApiResponse<T>`).
   */
  async sendMessage(
    content: string,
    attachments?: unknown[],
  ): Promise<{ messageId: string; sentAt: string }> {
    const url = `${this.base}/api/v1/agent/messages`;
    const { statusCode, body } = await request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content, attachments }),
      // undici defaults to a 300s body timeout which is absurdly long for a
      // user-facing send. Bound both the handshake and body read explicitly.
      headersTimeout: 10_000,
      bodyTimeout: 30_000,
    });
    const text = await body.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`sendMessage failed ${statusCode}: ${text}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`sendMessage invalid JSON: ${text}`);
    }
    // concierge returns ApiResponse<T>; unwrap `data`.
    const data =
      parsed && typeof parsed === "object" && "data" in parsed
        ? (parsed as { data: unknown }).data
        : parsed;
    return data as { messageId: string; sentAt: string };
  }

  /**
   * GET /api/v1/agent/events/pull — sandbox-friendly pull (no long connection).
   * Drains up to `limit` events from the server-side offline queue and returns
   * them. Used by `check_inbox` tool which MaxClaw / similar cron-capable agent
   * hosts call on a schedule.
   */
  async pullEvents(
    limit: number = 50,
  ): Promise<{ events: unknown[]; hasMore: boolean; count: number }> {
    const capped = Math.max(1, Math.min(limit, 100));
    const url = `${this.base}/api/v1/agent/events/pull?limit=${capped}`;
    const { statusCode, body } = await request(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.token}` },
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    const text = await body.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`pullEvents failed ${statusCode}: ${text}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`pullEvents invalid JSON: ${text}`);
    }
    const data =
      parsed && typeof parsed === "object" && "data" in parsed
        ? (parsed as { data: unknown }).data
        : parsed;
    return data as { events: unknown[]; hasMore: boolean; count: number };
  }

  /**
   * POST /api/v1/agent/uploads — multipart upload of a single file. Returns
   * an AttachmentDTO-shaped object the caller can stick straight into
   * `sendMessage(content, [attachment])`.
   *
   * mediaType auto-derives from `mimeType` server-side (image/* → 1,
   * audio/* → 2, video/* → 3, else 4); pass `mediaTypeOverride` to force one.
   */
  async uploadAttachment(
    bytes: Uint8Array,
    originalName: string,
    mimeType: string,
    mediaTypeOverride?: number,
  ): Promise<{
    url: string;
    mediaType: number;
    mimeType: string;
    fileSize: number;
    originalName: string;
  }> {
    const url = `${this.base}/api/v1/agent/uploads`;
    const boundary = `----a2hmcp${Date.now()}${Math.random().toString(16).slice(2)}`;
    const parts: Array<Buffer | Uint8Array> = [];
    const enc = (s: string) => Buffer.from(s, "utf-8");

    // file part
    parts.push(
      enc(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${escapeHeaderValue(originalName)}"\r\n` +
          `Content-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`,
      ),
    );
    parts.push(bytes);
    parts.push(enc(`\r\n`));

    // optional mediaType override
    if (typeof mediaTypeOverride === "number") {
      parts.push(
        enc(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="mediaType"\r\n\r\n` +
            `${mediaTypeOverride}\r\n`,
        ),
      );
    }

    // explicit originalName (in case filename gets mangled by transport)
    parts.push(
      enc(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="originalName"\r\n\r\n` +
          `${originalName}\r\n`,
      ),
    );

    parts.push(enc(`--${boundary}--\r\n`));
    const bodyBuf = Buffer.concat(parts.map((p) => Buffer.from(p)));

    const { statusCode, body } = await request(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(bodyBuf.length),
      },
      body: bodyBuf,
      headersTimeout: 15_000,
      bodyTimeout: 60_000,
    });
    const text = await body.text();
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`uploadAttachment failed ${statusCode}: ${text}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`uploadAttachment invalid JSON: ${text}`);
    }
    const data =
      parsed && typeof parsed === "object" && "data" in parsed
        ? (parsed as { data: unknown }).data
        : parsed;
    return data as {
      url: string;
      mediaType: number;
      mimeType: string;
      fileSize: number;
      originalName: string;
    };
  }
}

/** Strip CR/LF + double-quotes so a filename can sit in a Content-Disposition header. */
function escapeHeaderValue(s: string): string {
  return s.replace(/[\r\n]/g, " ").replace(/"/g, "'");
}
