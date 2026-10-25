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

import { fetchViaFlaresolverr, shouldProxyHost } from "../src/services/flaresolverr";
import { openImportResponse } from "../src/services/importService";

import { setFlaresolverrProviders } from "../src/services/settingsService";
import { fetchJsonFromUrl } from "../src/services/importResolvers";

afterEach(async () => {
  vi.restoreAllMocks();
  await setFlaresolverrProviders({ makerworld: true });
});

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
    "https://constructor/en/models/1",
    "https://__proto__/en/models/1",
    "https://evil.makerworld.com/en/models/1",
    "http://makerworld.com/en/models/1",
    "https://makerworld.com:8443/en/models/1",
    "https://user@makerworld.com/en/models/1",
    "https://makerworld.com/redirect?url=http://127.0.0.1",
    "https://makerworld.com/en/models/%2fredirect",
    "https://api.thingiverse.com/users/%2e%2e/redirect",
    "https://api.thingiverse.com/things/123?key=secret",
    "https://api.thingiverse.com/things/123?access_token=one&access_token=two",
    "https://api.thingiverse.com/things/123?access_token=",
    "https://api.thingiverse.com/things/123?access_token=%0asecret",
    "https://api.thingiverse.com/redirect?access_token=secret",
    "https://www.thingiverse.com/thing:123?access_token=secret",
    "https://www.myminifactory.com/object/3d-print-123?key=secret",
    "https://www.myminifactory.com/api/v2/objects/123?access_token=secret",
    "https://www.myminifactory.com/api/v2/objects/123?key=one&key=two",
    "https://www.myminifactory.com/api/data-library/me?key=secret",
    "https://api.bambulab.com/v1/design-service/my/favorites/listlite?query=",
  ])("rejects untrusted solver destination %s", async (url) => {
    const sent = vi.spyOn(globalThis, "fetch");
    expect(await fetchViaFlaresolverr(url)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it.each([
    "https://makerworld.com/api/v1/design-service/favorites/123/designs?seed=0&collectionId=123&limit=20&offset=0",
    "https://api.thingiverse.com/things/123",
    "https://api.thingiverse.com/things/123?access_token=opaque%2B%2F%3Dtoken",
    "https://www.myminifactory.com/api/v2/objects/123?key=opaque%2B%2F%3Dkey",
    "https://www.myminifactory.com/api/v2/objects/123",
    "https://thangs.com/api/models/v2/123?likes=false",
    "https://www.printables.com/model/123-test",
  ])("preserves canonical provider request %s", async (url) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", solution: { response: "page" } })),
    );
    expect(await fetchViaFlaresolverr(url)).toEqual({ status: 200, body: "page" });
  });

  it("disabling a provider stops solver calls even with a warm page proxy cache", async () => {
    const sent = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(JSON.stringify({ status: "ok", solution: { response: '{"id":1}' } })),
      );
    const url = "https://makerworld.com/en/models/1";
    expect(await fetchViaFlaresolverr(url)).not.toBeNull();
    expect(shouldProxyHost("makerworld.com")).toBe(true);
    await setFlaresolverrProviders({ makerworld: false });
    sent.mockClear();
    expect(await fetchJsonFromUrl(url)).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not allow callers to seed cookies for routes without that declared permission", async () => {
    const sent = vi.spyOn(globalThis, "fetch");
    expect(await fetchViaFlaresolverr("https://api.thingiverse.com/things/123", "token=secret")).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it("seeds cookies only for an allowed provider host", async () => {
    const sent = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", solution: { status: 200, response: "page" } })));
    expect(await fetchViaFlaresolverr("https://makerworld.com/en/models/1", "token=saved-secret; theme=dark")).toEqual({
      status: 200,
      body: "page",
    });
    const body = JSON.parse(sent.mock.calls[0][1]?.body as string);
    expect(body.cookies).toEqual([
      { name: "token", value: "saved-secret", domain: "makerworld.com", path: "/", secure: true },
      { name: "theme", value: "dark", domain: "makerworld.com", path: "/", secure: true },
    ]);
  });

  it("declines cookies for a non-allowlisted destination before sending a request", async () => {
    const sent = vi.spyOn(globalThis, "fetch");
    expect(await fetchViaFlaresolverr("https://attacker.example/model", "token=saved-secret")).toBeNull();
    expect(sent).not.toHaveBeenCalled();
  });

  it("accepts encoded provider slugs and strips unrelated query parameters", async () => {
    const sent = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok", solution: { response: "page" } })));
    expect(
      await fetchViaFlaresolverr(
        "https://makerworld.com/en/models/123-%E4%BD%A0?from=search&utm_source=test&next=http://127.0.0.1",
      ),
    ).toEqual({ status: 200, body: "page" });
    expect(JSON.parse(sent.mock.calls[0][1]?.body as string).url).toBe(
      "https://makerworld.com/en/models/123-%E4%BD%A0",
    );
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
