import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/settingsService", () => ({
  getFlaresolverrUrl: async () => "http://fake-flaresolverr.test/v1",
}));

const ACCESS_TOKEN = "test-access-token";
const FLARESOLVERR_URL = "http://fake-flaresolverr.test/v1";

function cloudflareChallengeResponse(): Response {
  return new Response("<!doctype html><html><body>Just a moment...</body></html>", {
    status: 429,
    headers: { server: "cloudflare", "cf-mitigated": "challenge", "content-type": "text/html" },
  });
}

describe("fetchThingiverseApiJson FlareSolverr fallback", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.FLARESOLVERR_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    if (originalEnv === undefined) delete process.env.FLARESOLVERR_URL;
    else process.env.FLARESOLVERR_URL = originalEnv;
    vi.resetModules();
  });

  it("does not send the API access token to browser navigation when Cloudflare blocks the API", async () => {
    process.env.FLARESOLVERR_URL = FLARESOLVERR_URL;
    vi.resetModules();
    const { resolveThingiverseThing } = await import("../src/providers/thingiverse/api");

    let directCalls = 0;
    let flaresolverrCalls = 0;
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith(FLARESOLVERR_URL)) {
        flaresolverrCalls++;
        throw new Error("Credential-bearing URLs must not reach the solver");
      }
      if (url.startsWith("https://api.thingiverse.com/")) {
        directCalls++;
        return cloudflareChallengeResponse();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    await expect(resolveThingiverseThing("999", ACCESS_TOKEN)).rejects.toThrow(/Cloudflare/);
    await expect(resolveThingiverseThing("1000", ACCESS_TOKEN)).rejects.toThrow(/Cloudflare/);
    expect(directCalls).toBe(2);
    expect(flaresolverrCalls).toBe(0);
  });
});
