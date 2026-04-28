import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ToolContext } from "./send-message.js";

/**
 * `upload_attachment` MCP tool —— send images / audio / video / files to the
 * A2H AI assistant.
 *
 * Two input shapes:
 *
 *   1. `{ filePath: "/abs/path/to/img.png" }` — read from disk (host must
 *      be able to write the file there first; works for hosts that can
 *      materialize an attachment to a local path).
 *   2. `{ base64: "iVBORw0...", mimeType: "image/png", originalName: "x.png" }`
 *      — for hosts that hand attachments to the model as inline base64.
 *
 * Either way, returns an attachment object you can drop into
 * `send_message_to_ai` `attachments: [...]`. Server auto-detects mediaType
 * from MIME (image/* → 1, audio/* → 2, video/* → 3, else 4); pass
 * `mediaType` explicitly to force one.
 *
 * NOTE: host caps file size around 20MB (server multipart limit); call this
 * once per file, then send a single message referencing all uploaded urls.
 */
export const uploadAttachmentTool = {
  name: "upload_attachment",
  descriptor: {
    name: "upload_attachment",
    description:
      "Upload a single file to A2H so it becomes an attachment with a public URL. " +
      "Pass either { filePath } or { base64, mimeType, originalName }. " +
      "Returns { url, mediaType, mimeType, fileSize, originalName } — paste " +
      "the whole object into send_message_to_ai's `attachments` array.",
    inputSchema: {
      type: "object" as const,
      properties: {
        filePath: {
          type: "string",
          description:
            "Absolute path to a local file. Used when the host can write attachments to disk.",
        },
        base64: {
          type: "string",
          description:
            "Base64-encoded file bytes. Used when the host hands attachments inline.",
        },
        mimeType: {
          type: "string",
          description:
            "Required when using base64 (e.g. image/png, audio/mp4). For filePath, server infers from extension if omitted.",
        },
        originalName: {
          type: "string",
          description:
            "Display filename (e.g. 'screenshot.png'). For filePath, defaults to the basename. For base64, this is required.",
        },
        mediaType: {
          type: "integer",
          description:
            "Optional override: 1=image, 2=audio, 3=video, 4=file. Server auto-derives from mimeType if omitted.",
        },
      },
      required: [] as string[],
    },
  },
  handler: async (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
    let bytes: Uint8Array;
    let originalName: string;
    let mimeType: string;

    const filePath = typeof args.filePath === "string" ? args.filePath : undefined;
    const base64 = typeof args.base64 === "string" ? args.base64 : undefined;
    const mediaTypeOverride =
      typeof args.mediaType === "number" ? args.mediaType : undefined;

    if (filePath) {
      bytes = new Uint8Array(await readFile(filePath));
      originalName =
        typeof args.originalName === "string" && args.originalName.trim().length > 0
          ? args.originalName
          : basename(filePath);
      mimeType =
        typeof args.mimeType === "string" && args.mimeType.trim().length > 0
          ? args.mimeType
          : guessMimeFromName(originalName);
    } else if (base64) {
      bytes = Uint8Array.from(Buffer.from(base64, "base64"));
      if (bytes.byteLength === 0) {
        throw new Error("upload_attachment: base64 decoded to empty bytes");
      }
      if (typeof args.originalName !== "string" || args.originalName.trim().length === 0) {
        throw new Error("upload_attachment: originalName is required when using base64");
      }
      originalName = args.originalName;
      if (typeof args.mimeType !== "string" || args.mimeType.trim().length === 0) {
        throw new Error("upload_attachment: mimeType is required when using base64");
      }
      mimeType = args.mimeType;
    } else {
      throw new Error("upload_attachment: must provide either filePath or base64");
    }

    const result = await ctx.api.uploadAttachment(
      bytes,
      originalName,
      mimeType,
      mediaTypeOverride,
    );
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

/** Best-effort MIME guess from filename extension. Server is the source of
 * truth, this is just a hint when the caller didn't provide one. */
function guessMimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    heic: "image/heic",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    pdf: "application/pdf",
    txt: "text/plain",
    json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}
