import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { uploadAttachmentTool } from "../../src/tools/upload-attachment.js";
import type { Credentials } from "../../src/config.js";

const creds: Credentials = {
  token: "a2h_pat_x",
  agentId: "ag_1",
  tokenName: "test",
  createdAt: "2026-04-24T00:00:00Z",
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "a2h-upload-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("uploadAttachmentTool — security guards", () => {
  it("refuses paths inside ~/.a2h/ (would expose our own credentials.json)", async () => {
    const fakeCreds = join(homedir(), ".a2h", "__test_should_be_blocked.json");
    // We don't actually create the file — the path check fires before stat().
    const api = { uploadAttachment: vi.fn() };
    await expect(
      uploadAttachmentTool.handler(
        { filePath: fakeCreds },
        { api: api as never, creds },
      ),
    ).rejects.toThrow(/refusing to read sensitive path|denylist/);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it("refuses paths inside ~/.ssh/", async () => {
    const api = { uploadAttachment: vi.fn() };
    await expect(
      uploadAttachmentTool.handler(
        { filePath: join(homedir(), ".ssh", "id_rsa") },
        { api: api as never, creds },
      ),
    ).rejects.toThrow(/refusing to read sensitive path/);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it("refuses /etc/shadow", async () => {
    const api = { uploadAttachment: vi.fn() };
    await expect(
      uploadAttachmentTool.handler(
        { filePath: "/etc/shadow" },
        { api: api as never, creds },
      ),
    ).rejects.toThrow(/refusing to read sensitive path/);
  });

  it("refuses path traversal attempts that resolve into denied dirs", async () => {
    // ~/Downloads/../.ssh/id_rsa resolves to ~/.ssh/id_rsa.
    const api = { uploadAttachment: vi.fn() };
    await expect(
      uploadAttachmentTool.handler(
        {
          filePath: join(homedir(), "Downloads", "..", ".ssh", "id_rsa"),
        },
        { api: api as never, creds },
      ),
    ).rejects.toThrow(/refusing to read sensitive path/);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it("rejects files larger than 20MB without reading them into memory", async () => {
    // Create a sparse file 30MB in size by writing a single byte at offset.
    // Avoids holding 30MB in RAM in the test process.
    const big = join(tmp, "huge.bin");
    const fd = require("node:fs").openSync(big, "w");
    require("node:fs").writeSync(fd, Buffer.from([0]), 0, 1, 30 * 1024 * 1024);
    require("node:fs").closeSync(fd);

    const api = { uploadAttachment: vi.fn() };
    await expect(
      uploadAttachmentTool.handler(
        { filePath: big, mimeType: "application/octet-stream" },
        { api: api as never, creds },
      ),
    ).rejects.toThrow(/file is \d+ bytes, max is/);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it("accepts a normal-sized file under /tmp/", async () => {
    const small = join(tmp, "ok.png");
    writeFileSync(small, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const api = {
      uploadAttachment: vi.fn().mockResolvedValue({
        url: "https://media.a2hmarket.ai/x.png",
        mediaType: 1,
        mimeType: "image/png",
        fileSize: 4,
        originalName: "ok.png",
      }),
    };
    const out = await uploadAttachmentTool.handler(
      { filePath: small },
      { api: api as never, creds },
    );
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(out.content[0].type).toBe("text");
    expect(JSON.parse(out.content[0].text).url).toContain("media.a2hmarket.ai");
  });

  it("rejects base64 payloads that decode to >20MB without sending to backend", async () => {
    // Base64 expands ~4/3, so 30MB raw = ~40MB base64. Build cheaply.
    const raw = Buffer.alloc(30 * 1024 * 1024);
    const b64 = raw.toString("base64");
    const api = { uploadAttachment: vi.fn() };
    await expect(
      uploadAttachmentTool.handler(
        {
          base64: b64,
          mimeType: "application/octet-stream",
          originalName: "big.bin",
        },
        { api: api as never, creds },
      ),
    ).rejects.toThrow(/decoded to \d+ bytes, max is/);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it("rejects non-regular-file paths (e.g. directories)", async () => {
    const dir = join(tmp, "subdir");
    mkdirSync(dir);
    const api = { uploadAttachment: vi.fn() };
    await expect(
      uploadAttachmentTool.handler(
        { filePath: dir },
        { api: api as never, creds },
      ),
    ).rejects.toThrow(/is not a regular file/);
  });
});
