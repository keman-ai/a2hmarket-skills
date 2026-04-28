import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as undici from "undici";

/*
 * login.ts exercises four external surfaces:
 *   - undici.request (poll loop)
 *   - open() (best-effort browser launch)
 *   - fs writeFileSync + chmod (credentials.json)
 *   - process.exit (timeout path)
 *
 * We mock the first two and redirect A2H_HOME into a tmp dir so real $HOME
 * stays untouched. process.exit is spied via `vi.spyOn(process, "exit")`
 * and thrown-from to abort the async flow cleanly.
 */

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

vi.mock("open", () => ({
  default: vi.fn(async () => ({} as unknown)),
}));

const requestMock = undici.request as unknown as ReturnType<typeof vi.fn>;

function mockResponse(statusCode: number, bodyText: string) {
  return {
    statusCode,
    body: {
      text: async () => bodyText,
    },
  };
}

let tmp: string;
let originalHome: string | undefined;
let originalApi: string | undefined;
let originalUser: string | undefined;
let originalFront: string | undefined;
let originalArgv: string[];

beforeEach(() => {
  vi.useFakeTimers();
  tmp = mkdtempSync(join(tmpdir(), "a2h-login-test-"));
  originalHome = process.env.A2H_HOME;
  originalApi = process.env.A2H_API_BASE;
  originalUser = process.env.A2H_USER_BASE;
  originalFront = process.env.A2H_FRONT_BASE;
  originalArgv = process.argv;

  process.env.A2H_HOME = tmp;
  // Deterministic URLs — bypass prod defaults so tests never accidentally
  // hit the network in case the mock is misconfigured.
  process.env.A2H_API_BASE = "http://localhost:8821/a2hmarket-concierge";
  process.env.A2H_USER_BASE = "http://localhost:8802/findu-user";
  process.env.A2H_FRONT_BASE = "http://localhost:5173";
  process.argv = ["node", "test"];

  requestMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(tmp, { recursive: true, force: true });
  process.argv = originalArgv;
  if (originalHome === undefined) delete process.env.A2H_HOME;
  else process.env.A2H_HOME = originalHome;
  if (originalApi === undefined) delete process.env.A2H_API_BASE;
  else process.env.A2H_API_BASE = originalApi;
  if (originalUser === undefined) delete process.env.A2H_USER_BASE;
  else process.env.A2H_USER_BASE = originalUser;
  if (originalFront === undefined) delete process.env.A2H_FRONT_BASE;
  else process.env.A2H_FRONT_BASE = originalFront;
  vi.clearAllMocks();
});

/**
 * Advance fake timers step-by-step so each `setTimeout(5s)` resolves and the
 * next poll `await` returns. We do this in a loop because vi.runAllTimersAsync
 * can fight against dependent awaits.
 */
async function flushPolls(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(5000);
  }
}

describe("login.main (authcode flow)", () => {
  it("writes credentials when poll returns patToken", async () => {
    requestMock.mockResolvedValueOnce(
      mockResponse(
        200,
        JSON.stringify({
          code: "OK",
          data: {
            userId: "u_1",
            agentId: "ag_mcp_1",
            patToken: "a2h_pat_abc",
            patTokenName: "A2H Skill (authcode)",
          },
        }),
      ),
    );
    const { main } = await import("../src/login.js");
    const p = main();
    await flushPolls(1);
    await p;

    const credFile = join(tmp, "credentials.json");
    expect(existsSync(credFile)).toBe(true);
    const creds = JSON.parse(readFileSync(credFile, "utf-8"));
    expect(creds.token).toBe("a2h_pat_abc");
    expect(creds.agentId).toBe("ag_mcp_1");
    expect(creds.tokenName).toBe("A2H Skill (authcode)");
    expect(typeof creds.createdAt).toBe("string");

    // Exactly one poll was made.
    expect(requestMock).toHaveBeenCalledTimes(1);
    const [url] = requestMock.mock.calls[0];
    expect(url).toMatch(
      /^http:\/\/localhost:8802\/findu-user\/api\/v1\/public\/user\/agent\/auth\?code=SKILL-/,
    );
  });

  it("keeps polling on 404", async () => {
    // Two 404s then a success — login.main should call request 3 times.
    requestMock
      .mockResolvedValueOnce(mockResponse(404, "not found"))
      .mockResolvedValueOnce(mockResponse(404, "not found"))
      .mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            code: "OK",
            data: { agentId: "ag_x", patToken: "pat_x" },
          }),
        ),
      );
    const { main } = await import("../src/login.js");
    const p = main();
    await flushPolls(3);
    await p;

    expect(requestMock).toHaveBeenCalledTimes(3);
    const creds = JSON.parse(
      readFileSync(join(tmp, "credentials.json"), "utf-8"),
    );
    expect(creds.token).toBe("pat_x");
  });

  it("keeps polling when data is null (not yet confirmed)", async () => {
    requestMock
      .mockResolvedValueOnce(
        mockResponse(200, JSON.stringify({ code: "OK", data: null })),
      )
      .mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            code: "OK",
            data: { agentId: "ag_y", patToken: "pat_y" },
          }),
        ),
      );
    const { main } = await import("../src/login.js");
    const p = main();
    await flushPolls(2);
    await p;

    expect(requestMock).toHaveBeenCalledTimes(2);
    const creds = JSON.parse(
      readFileSync(join(tmp, "credentials.json"), "utf-8"),
    );
    expect(creds.token).toBe("pat_y");
  });

  it("keeps polling when data.patToken is missing (old openclaw shape)", async () => {
    requestMock
      .mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            code: "OK",
            // agentId populated but no patToken → back-compat legacy shape
            data: { agentId: "ag_z", secret: "shh" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            code: "OK",
            data: { agentId: "ag_z", patToken: "pat_z" },
          }),
        ),
      );
    const { main } = await import("../src/login.js");
    const p = main();
    await flushPolls(2);
    await p;

    expect(requestMock).toHaveBeenCalledTimes(2);
    const creds = JSON.parse(
      readFileSync(join(tmp, "credentials.json"), "utf-8"),
    );
    expect(creds.token).toBe("pat_z");
  });

  it("swallows network / JSON errors and keeps polling", async () => {
    requestMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(mockResponse(200, "not-json-at-all"))
      .mockResolvedValueOnce(
        mockResponse(
          200,
          JSON.stringify({
            code: "OK",
            data: { agentId: "ag_n", patToken: "pat_n" },
          }),
        ),
      );
    const { main } = await import("../src/login.js");
    const p = main();
    await flushPolls(3);
    await p;

    expect(requestMock).toHaveBeenCalledTimes(3);
    const creds = JSON.parse(
      readFileSync(join(tmp, "credentials.json"), "utf-8"),
    );
    expect(creds.token).toBe("pat_n");
  });

  it("exits with code 1 after 60 unsuccessful polls (timeout)", async () => {
    // Every poll returns 404. After 60 attempts login should process.exit(1).
    requestMock.mockResolvedValue(mockResponse(404, "not found"));
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        throw new Error("__exit__");
      }) as unknown as (code?: number) => never);

    const { main } = await import("../src/login.js");
    // Attach a .catch immediately so the eventual rejection (when process.exit
    // is stubbed to throw) is consumed — otherwise vitest reports an unhandled
    // promise rejection even though the test itself asserts correctly.
    let caught: unknown = null;
    const p = main().catch((e) => {
      caught = e;
    });
    await flushPolls(60);
    await p;

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("__exit__");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(requestMock).toHaveBeenCalledTimes(60);
    // Credentials file should NOT have been written.
    expect(existsSync(join(tmp, "credentials.json"))).toBe(false);
    exitSpy.mockRestore();
  });
});
