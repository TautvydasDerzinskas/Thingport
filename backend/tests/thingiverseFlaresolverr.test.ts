import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ enabled: true }));
vi.mock("../src/services/settingsService", () => ({
  getFlaresolverrUrl: async () => "http://fake-flaresolverr.test/v1",
  isFlaresolverrProviderEnabled: async () => config.enabled,
}));

import { checkThingiverseAccessToken } from "../src/providers/thingiverse/api";
import { checkMyminifactoryApiKey } from "../src/providers/myminifactory/api";

const SOLVER = "http://fake-flaresolverr.test/v1";
const TOKEN = "opaque+/=token&value";

beforeEach(() => {
  config.enabled = true;
});
afterEach(() => vi.restoreAllMocks());

describe.each([
  ["Thingiverse", checkThingiverseAccessToken, "access_token"],
  ["MyMiniFactory", checkMyminifactoryApiKey, "key"],
] as const)("%s API solver fallback", (_name, check, credential) => {
  it.each([429, 403])(
    "tries guarded direct transport before solving challenge HTTP %s, including a warm cache",
    async (status) => {
      const order: string[] = [];
      const solverRequests: { url: string; cookies?: unknown }[] = [];
      const redirects: (RequestRedirect | undefined)[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        if (String(input) === SOLVER) {
          order.push("solver");
          const body = JSON.parse(init!.body as string);
          solverRequests.push(body);
          return new Response(
            JSON.stringify({ status: "ok", solution: { status: 200, response: "<pre>{&quot;id&quot;:1}</pre>" } }),
          );
        }
        order.push("direct");
        redirects.push(init?.redirect);
        return new Response("challenge", { status, headers: { "cf-mitigated": "challenge" } });
      });
      expect(await check(TOKEN)).toBe("ok");
      expect(await check(TOKEN)).toBe("ok");
      expect(order).toEqual(["direct", "solver", "direct", "solver"]);
      expect(redirects).toEqual(["manual", "manual"]);
      expect(solverRequests.map((body) => new URL(body.url).searchParams.get(credential))).toEqual([TOKEN, TOKEN]);
      expect(solverRequests.every((body) => !("cookies" in body))).toBe(true);
    },
  );

  it.each([401, 403])("does not solve ordinary rejection HTTP %s even behind Cloudflare", async (status) => {
    const sent = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("denied", { status, headers: { server: "cloudflare" } }));
    expect(await check(TOKEN)).toBe("rejected");
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("honors disabled fallback", async () => {
    config.enabled = false;
    const sent = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("challenge", { status: 429 }));
    expect(await check(TOKEN)).toBe("blocked");
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429])("preserves solver rejection/challenge HTTP %s", async (status) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === SOLVER
        ? new Response(JSON.stringify({ status: "ok", solution: { status, response: "{}" } }))
        : new Response("challenge", { status: 429 }),
    );
    expect(await check(TOKEN)).toBe(status === 429 ? "blocked" : "rejected");
  });

  it("keeps a failed or malformed solve blocked", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === SOLVER
        ? new Response(JSON.stringify({ status: "ok", solution: { status: 200, response: "<html>challenge</html>" } }))
        : new Response("challenge", { status: 429 }),
    );
    expect(await check(TOKEN)).toBe("blocked");
  });
});
