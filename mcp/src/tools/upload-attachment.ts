import { readFile, stat } from "node:fs/promises";
import { basename, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import type { ToolContext } from "./send-message.js";

/**
 * Hard cap on attachment size. Server multipart limit is ~20MB; we enforce
 * client-side too so `readFile` doesn't pull a multi-GB file into memory
 * before the server even gets a chance to reject it.
 */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Paths the agent is NEVER allowed to read via `upload_attachment`,
 * regardless of how the input is shaped. The threat is prompt injection:
 * an adversarial chat message instructs our agent to upload a sensitive
 * file (the user's PAT, SSH keys, AWS creds, etc.). Even though the MCP
 * server runs as the user and could theoretically open these files, this
 * specific tool path is reserved for user-supplied attachments only.
 *
 * Order:
 *   1. Resolve the path (collapses `..`, `~`, symlinks-in-name, etc.) so a
 *      crafted relative path like `~/.a2h/../../etc/shadow` can't dodge.
 *   2. Match against the denylist patterns. Any prefix match denies.
 *
 * If you legitimately need to upload from one of these locations, copy the
 * file to `/tmp/` or `~/Downloads/` first and pass that path.
 */
const DENY_PREFIXES_LITERAL = [
  // Our own credentials.
  resolvePath(homedir(), ".a2h"),
  // SSH / GPG / age private keys.
  resolvePath(homedir(), ".ssh"),
  resolvePath(homedir(), ".gnupg"),
  resolvePath(homedir(), ".age"),
  // Cloud provider credentials.
  resolvePath(homedir(), ".aws"),
  resolvePath(homedir(), ".azure"),
  resolvePath(homedir(), ".config", "gcloud"),
  // Package manager auth (npm, pypi, ruby gems).
  resolvePath(homedir(), ".npmrc"),
  resolvePath(homedir(), ".pypirc"),
  resolvePath(homedir(), ".gem", "credentials"),
  // Generic `.netrc` (used by curl, git, hg for HTTP basic auth).
  resolvePath(homedir(), ".netrc"),
  // Shell histories (often contain pasted secrets).
  resolvePath(homedir(), ".bash_history"),
  resolvePath(homedir(), ".zsh_history"),
  resolvePath(homedir(), ".python_history"),
  // Linux secrets.
  "/etc/shadow",
  "/etc/sudoers",
  "/etc/ssh",
  "/proc",
  "/sys",
  // macOS keychain.
  resolvePath(homedir(), "Library", "Keychains"),
];

function isPathDenied(absPath: string): string | null {
  for (const deny of DENY_PREFIXES_LITERAL) {
    if (absPath === deny || absPath.startsWith(deny + "/")) {
      return deny;
    }
  }
  return null;
}

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
      "Upload a single file to A2H so it becomes an attachment the AI can see. Call once per file " +
      "BEFORE send_message_to_ai. Two input shapes: " +
      "(1) { filePath: '/abs/path/to/x.png' } — when the host can write the file to disk. mimeType " +
      "is optional; server infers from extension if omitted. " +
      "(2) { base64: 'iVBORw0...', mimeType: 'image/png', originalName: 'x.png' } — when host " +
      "exposes attachments inline. mimeType AND originalName are both required for base64. " +
      "Returns { url, mediaType, mimeType, fileSize, originalName, ... } — paste the WHOLE object " +
      "(not just url) into send_message_to_ai's `attachments` array. " +
      "mediaType is auto-derived from mimeType (image/* → 1, audio/* → 2, video/* → 3, else 4); " +
      "pass the mediaType arg to override. Single-file cap is ~20MB (server multipart limit); on " +
      "413 / 'multipart too large' tell user to compress or split.",
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
      // Resolve to absolute first so denylist comparison can't be dodged with
      // relative paths or `..` segments. resolvePath() also collapses
      // /a/b/../c → /a/c without touching the filesystem.
      const abs = resolvePath(filePath);
      const denyMatch = isPathDenied(abs);
      if (denyMatch) {
        throw new Error(
          `upload_attachment: refusing to read sensitive path "${abs}" ` +
            `(matches denylist entry "${denyMatch}"). If this is a legitimate file, ` +
            `copy it to /tmp/ or ~/Downloads/ first.`,
        );
      }
      const stats = await stat(abs);
      if (!stats.isFile()) {
        throw new Error(`upload_attachment: ${abs} is not a regular file`);
      }
      if (stats.size > MAX_BYTES) {
        throw new Error(
          `upload_attachment: file is ${stats.size} bytes, max is ${MAX_BYTES} ` +
            `(20MB). Compress or split before uploading.`,
        );
      }
      bytes = new Uint8Array(await readFile(abs));
      originalName =
        typeof args.originalName === "string" && args.originalName.trim().length > 0
          ? args.originalName
          : basename(abs);
      mimeType =
        typeof args.mimeType === "string" && args.mimeType.trim().length > 0
          ? args.mimeType
          : guessMimeFromName(originalName);
    } else if (base64) {
      bytes = Uint8Array.from(Buffer.from(base64, "base64"));
      if (bytes.byteLength === 0) {
        throw new Error("upload_attachment: base64 decoded to empty bytes");
      }
      if (bytes.byteLength > MAX_BYTES) {
        throw new Error(
          `upload_attachment: base64 decoded to ${bytes.byteLength} bytes, max is ${MAX_BYTES} (20MB). Compress before uploading.`,
        );
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
