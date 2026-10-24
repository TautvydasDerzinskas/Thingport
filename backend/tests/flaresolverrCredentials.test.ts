import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/settingsService", async (original) => ({
  ...(await original<typeof import("../src/services/settingsService")>()),
  getFlaresolverrUrl: async () => "http://solver.example/v1",
}));
vi.mock("../src/utils/remoteRequest", () => ({
  remoteRequest: async () => new Response("forged challenge", { status: 403, headers: { server: "cloudflare" } }),
}));
vi.mock("../src/utils/urlUtils", async (original) => ({
  ...(await original<typeof import("../src/utils/urlUtils")>()),
  validateRemoteUrl: async (url: string) => url,
}));

import { fetchViaFlaresolverr } from "../src/services/flaresolverr";
import { openImportResponse } from "../src/services/importService";

afterEach(() => vi.restoreAllMocks());

describe("FlareSolverr credential boundary", () => {
  it("does not promote an arbitrary import URL to browser navigation on a forged Cloudflare block", async () => {
    const sent = vi.spyOn(globalThis, "fetch");
    await expect(
      openImportResponse("https://attacker.example/model", { url: "https://attacker.example/model" }),
    ).rejects.toMatchObject({ code: "CLOUDFLARE_BLOCKED" });
    expect(sent).not.toHaveBeenCalled();
  });

  it.each([
    "https://attacker.example/model",
    "https://evil.makerworld.com/en/models/1",
    "http://makerworld.com/en/models/1",
    "https://makerworld.com:8443/en/models/1",
    "https://user@makerworld.com/en/models/1",
    "https://makerworld.com/redirect?url=http://127.0.0.1",
    "https://makerworld.com/en/models/1?next=http://127.0.0.1",
    "https://makerworld.com/en/models/%2fredirect",
    "https://api.thingiverse.com/users/%2e%2e/redirect",
    "https://api.thingiverse.com/things/123?access_token=secret",
    "https://www.myminifactory.com/api/v2/objects/123?key=secret",
  ])("rejects untrusted solver destination %s", async (url) => {
    const sent = vi.spyOn(globalThis, "fetch");
    expect(await fetchViaFlaresolverr(url)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it.each([
    "https://makerworld.com/api/v1/design-service/favorites/123/designs?seed=0&collectionId=123&limit=20&offset=0",
    "https://api.thingiverse.com/things/123",
    "https://www.myminifactory.com/api/v2/objects/123",
    "https://thangs.com/api/models/v2/123?likes=false",
    "https://www.printables.com/model/123-test",
  ])("preserves canonical provider request %s", async (url) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", solution: { response: "page" } })),
    );
    expect(await fetchViaFlaresolverr(url)).toEqual({ status: 200, body: "page" });
  });

  it("declines authenticated browser navigation before sending the saved cookie", async () => {
    const sent = vi.spyOn(globalThis, "fetch");
    expect(await fetchViaFlaresolverr("https://makerworld.com/en/models/1", "token=saved-secret")).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it("preserves unauthenticated challenge solving without seeded cookies", async () => {
    const sent = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", solution: { status: 200, response: "page" } })));
    expect(await fetchViaFlaresolverr("https://makerworld.com/en/models/1")).toEqual({ status: 200, body: "page" });
    const body = JSON.parse(sent.mock.calls[0][1]?.body as string);
    expect(body).toMatchObject({ cmd: "request.get", url: "https://makerworld.com/en/models/1" });
    expect(body).not.toHaveProperty("cookies");
  });
});
