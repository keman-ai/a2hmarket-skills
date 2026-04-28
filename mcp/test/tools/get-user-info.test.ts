import { describe, expect, it } from "vitest";

import { getUserInfoTool } from "../../src/tools/get-user-info.js";
import type { Credentials } from "../../src/config.js";

const creds: Credentials = {
  token: "a2h_pat_x",
  agentId: "ag_42",
  tokenName: "my-mac",
  createdAt: "2026-04-24T10:00:00Z",
};

describe("getUserInfoTool", () => {
  it("exposes get_user_info descriptor", () => {
    expect(getUserInfoTool.descriptor.name).toBe("get_user_info");
    expect(getUserInfoTool.descriptor.inputSchema.required).toEqual([]);
  });

  it("returns agentId / tokenName / createdAt", async () => {
    const out = await getUserInfoTool.handler(
      {},
      { api: {} as never, creds },
    );
    expect(out.content).toHaveLength(1);
    const payload = JSON.parse(out.content[0].text);
    expect(payload.agentId).toBe("ag_42");
    expect(payload.tokenName).toBe("my-mac");
    expect(payload.createdAt).toBe("2026-04-24T10:00:00Z");
    expect(payload.token).toBeUndefined();
  });
});
