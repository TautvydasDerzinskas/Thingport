import { afterEach, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => [],
  },
}));
vi.mock("../src/providers/makerworld/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/providers/makerworld/api")>()),
  resolveMakerworldViaCloudApi: vi
    .fn<typeof import("../src/providers/makerworld/api").resolveMakerworldViaCloudApi>()
    .mockResolvedValue(null),
}));

import { openImportResponse } from "../src/services/importService";
import { resolveMakerworldViaCloudApi } from "../src/providers/makerworld/api";

afterEach(() => vi.unstubAllGlobals());

it("canonicalizes www before the authenticated MakerWorld page fallback", async () => {
  const apex = "https://makerworld.com/en/models/123-slug?from=search#profileId-456";
  const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input).startsWith("https://www.makerworld.com/")) {
      return new Response(null, { status: 301, headers: { Location: apex } });
    }
    return new Response("model bytes", { headers: { "content-type": "application/octet-stream" } });
  });
  vi.stubGlobal("fetch", transport);

  const opened = await openImportResponse(apex.replace("makerworld.com", "www.makerworld.com"), {
    makerworld_cookie: "token=fallback-secret",
  });

  expect(resolveMakerworldViaCloudApi).toHaveBeenCalled();
  expect(opened.finalUrl).toBe(apex);
  expect(await opened.response.text()).toBe("model bytes");
  expect(transport).toHaveBeenCalledExactlyOnceWith(
    apex,
    expect.objectContaining({
      redirect: "manual",
      headers: expect.objectContaining({ Cookie: "token=fallback-secret" }),
    }),
  );
});

it.each([
  ["https://www.makerworld.com/files/model.3mf", 0],
  ["https://www.makerworld.com/en/models/123-slug", 1],
] as const)("preserves the origin for %s at depth %s", async (url, depth) => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("model bytes", { headers: { "content-type": "application/octet-stream" } }));
  vi.stubGlobal("fetch", transport);

  const opened = await openImportResponse(url, { makerworld_cookie: "token=fallback-secret" }, null, depth);

  expect(opened.finalUrl).toBe(url);
  expect(transport).toHaveBeenCalledExactlyOnceWith(
    url,
    expect.objectContaining({
      redirect: "manual",
      headers: expect.objectContaining({ Cookie: "token=fallback-secret" }),
    }),
  );
});
