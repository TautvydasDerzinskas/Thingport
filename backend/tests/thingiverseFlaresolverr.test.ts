import { afterEach, describe, expect, it, vi } from "vitest";
import { Impit } from "impit";
import * as browserTransport from "../src/utils/browserFetch";

const config = vi.hoisted(() => ({ url: "https://fake-flaresolverr.test/v1" as string | null }));
vi.mock("../src/services/settingsService", async (original) => ({
  ...(await original<typeof import("../src/services/settingsService")>()),
  getFlaresolverrUrl: async () => config.url,
}));

import { checkThingiverseAccessToken, resolveThingiverseThing } from "../src/providers/thingiverse/api";
import { checkMyminifactoryApiKey, resolveMyminifactoryObject } from "../src/providers/myminifactory/api";

const SOLVER = "https://fake-flaresolverr.test/v1";
const TOKEN = "opaque+/=token&value";

afterEach(() => {
  vi.restoreAllMocks();
  config.url = SOLVER;
});

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

  it.each([401, 403])("preserves ordinary API denial HTTP %s even behind Cloudflare", async (status) => {
    const sent = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "access_denied" }), { status, headers: { server: "cloudflare" } }),
      );
    expect(await check(TOKEN)).toBe(_name === "MyMiniFactory" && status === 403 ? "unreachable" : "rejected");
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("does not solve when no solver URL is configured", async () => {
    config.url = null;
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
    expect(await check(TOKEN)).toBe(
      status === 429 ? "blocked" : _name === "MyMiniFactory" && status === 403 ? "unreachable" : "rejected",
    );
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

describe.each([
  ["Thingiverse", checkThingiverseAccessToken],
  ["MyMiniFactory", checkMyminifactoryApiKey],
] as const)("%s API error classification", (_name, check) => {
  it("aborts a stalled API body through the real browser transport", async () => {
    const real = await vi.importActual<typeof import("../src/utils/browserFetch")>("../src/utils/browserFetch");
    vi.spyOn(browserTransport, "browserFetch").mockImplementation(real.browserFetch);
    const timeout = AbortSignal.timeout;
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout(5));
    let aborted = false;
    vi.spyOn(Impit.prototype, "fetch").mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                controller.error(signal.reason);
              },
              { once: true },
            );
          },
        }),
      );
    });
    expect(await check(TOKEN)).toBe("unreachable");
    expect(aborted).toBe(true);
  });

  it("solves a Cloudflare HTML 403 without cf-mitigated", async () => {
    const sent = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) =>
        String(input) === SOLVER
          ? new Response(JSON.stringify({ status: "ok", solution: { status: 200, response: '{"id":1}' } }))
          : new Response("<html>Just a moment...</html>", { status: 403, headers: { server: "cloudflare" } }),
      );
    expect(await check(TOKEN)).toBe("ok");
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("reports an unsolved Cloudflare HTML 403 as blocked", async () => {
    config.url = null;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>Just a moment...</html>", { status: 403, headers: { server: "cloudflare" } }),
    );
    expect(await check(TOKEN)).toBe("blocked");
  });

  it.each([false, true])("keeps a missing HTML resource distinct from auth (solver: %s)", async (solver) => {
    const response = "<html>Not found</html>";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === SOLVER
        ? new Response(JSON.stringify({ status: "ok", solution: { status: 404, response } }))
        : new Response(response, { status: solver ? 429 : 404 }),
    );
    const resolve = _name === "MyMiniFactory" ? resolveMyminifactoryObject : resolveThingiverseThing;
    expect(await resolve("123", TOKEN)).toBeNull();
    expect(await check(TOKEN)).toBe("unreachable");
  });

  it.each([false, true])("reports an HTML upstream outage as unreachable (solver: %s)", async (solver) => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === SOLVER
        ? new Response(
            JSON.stringify({ status: "ok", solution: { status: 503, response: "<html>Unavailable</html>" } }),
          )
        : new Response("<html>Unavailable</html>", { status: solver ? 429 : 503 }),
    );
    expect(await check(TOKEN)).toBe("unreachable");
  });
});

describe("provider-specific forbidden responses", () => {
  it.each([false, true])(
    "keeps a nonpublic MyMiniFactory object distinct from a rejected key (solver: %s)",
    async (solver) => {
      const response = JSON.stringify({ error: "access_denied", error_description: "Object is not public." });
      vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
        String(input) === SOLVER
          ? new Response(JSON.stringify({ status: "ok", solution: { status: 403, response } }))
          : new Response(response, { status: solver ? 429 : 403 }),
      );
      expect(await resolveMyminifactoryObject("123", TOKEN)).toBeNull();
    },
  );

  it("does not call an unknown Thingiverse HTML 403 a rejected token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>Forbidden</html>", { status: 403 }));
    expect(await checkThingiverseAccessToken(TOKEN)).toBe("blocked");
  });
});
