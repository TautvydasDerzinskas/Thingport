import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";

const ACCESS_TOKEN = "test-access-token";
const FLARESOLVERR_URL = "http://fake-flaresolverr.test/v1";

function cloudflareChallengeResponse(): Response {
  return new Response("<!doctype html><html><body>Just a moment...</body></html>", {
    status: 429,
    headers: { server: "cloudflare", "cf-mitigated": "challenge", "content-type": "text/html" },
  });
}

/** FlareSolverr's Chrome renders JSON inside its JSON-viewer <pre>. */
function flaresolverrEnvelope(thingJson: unknown): Response {
  const rendered = `<html><head></head><body><pre>${JSON.stringify(thingJson)}</pre></body></html>`;
  return new Response(JSON.stringify({ status: "ok", solution: { status: 200, response: rendered } }), {
    status: 200,
    headers: { "content-type": "application/json" },
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

  it("solves a Cloudflare challenge via FlareSolverr, then reuses the proxy for later calls to the same host", async () => {
    // config.ts reads this on first import, hence the dynamic import below. A saved setting would override it.
    await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
    process.env.FLARESOLVERR_URL = FLARESOLVERR_URL;
    vi.resetModules();
    const { resolveThingiverseThing } = await import("../src/providers/thingiverse/api");

    let directCalls = 0;
    let flaresolverrCalls = 0;
    global.fetch = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async (input) => {
      const url = String(input);
      if (url.startsWith(FLARESOLVERR_URL)) {
        flaresolverrCalls++;
        return flaresolverrEnvelope({ name: "Rate Limited Thing", zip_data: { files: [], images: [] } });
      }
      if (url.startsWith("https://api.thingiverse.com/")) {
        directCalls++;
        return cloudflareChallengeResponse();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const first = await resolveThingiverseThing("999", ACCESS_TOKEN);
    expect(first?.meta.title).toBe("Rate Limited Thing");
    expect(directCalls).toBe(1);
    expect(flaresolverrCalls).toBe(1);

    // The host just challenged us, so this call should go straight through FlareSolverr.
    const second = await resolveThingiverseThing("1000", ACCESS_TOKEN);
    expect(second?.meta.title).toBe("Rate Limited Thing");
    expect(directCalls).toBe(1);
    expect(flaresolverrCalls).toBe(2);
  });
});
