import { afterEach, expect, it, vi } from "vitest";
import { verifyMakerworldCookie } from "../src/providers/makerworld/api";

afterEach(() => vi.unstubAllGlobals());

it("checks a pasted token against the Bambu Cloud preference API", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ uid: 123 }), { status: 200 }));
  vi.stubGlobal("fetch", transport);
  await expect(verifyMakerworldCookie("other=value; token=test-token; language=en")).resolves.toEqual({
    result: "valid",
  });
  expect(transport).toHaveBeenCalledWith(
    "https://api.bambulab.com/v1/design-user-service/my/preference",
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      redirect: "manual",
    }),
  );
});

it.each([{}, { uid: null }, { uid: "" }, { uid: "  " }, { uid: false }, { uid: {} }, { uid: 0 }, { uid: -1 }])(
  "cannot verify a successful response without a meaningful uid: %j",
  async (body) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "unverifiable", reason: "provider" });
  },
);

it.each([123, "user-123"])("accepts a meaningful uid %j", async (uid) => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ uid }))));
  await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "valid" });
});

it("rejects an explicit authentication failure", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 })));
  await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "invalid" });
});

it.each([403, 429, 500, 502, 503, 404])("does not reject the cookie on HTTP %i", async (status) => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status })));
  await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "unverifiable", reason: "provider" });
});

it("does not send credentials through a Cloudflare solver", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } }));
  vi.stubGlobal("fetch", transport);
  await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "unverifiable", reason: "provider" });
  expect(transport).toHaveBeenCalledTimes(1);
});

it("cannot verify malformed JSON", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>logged out</html>")));
  await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "unverifiable", reason: "provider" });
});

it("cannot verify a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
  await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "unverifiable", reason: "network" });
});

it("denies a redirect outside the credential host without sending the token there", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://makerworld.com/api/redirect" } }),
    );
  vi.stubGlobal("fetch", transport);
  await expect(verifyMakerworldCookie("test-token")).resolves.toEqual({ result: "unverifiable", reason: "network" });
  expect(transport).toHaveBeenCalledTimes(1);
});

it("rejects a cookie without a token before requesting the provider", async () => {
  const transport = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", transport);
  await expect(verifyMakerworldCookie("language=en; other=value")).resolves.toEqual({ result: "invalid" });
  expect(transport).not.toHaveBeenCalled();
});

it("extracts the first token from a pasted Cookie header", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ uid: "user-123" })));
  vi.stubGlobal("fetch", transport);
  await expect(verifyMakerworldCookie("Cookie: token=test-token; language=en")).resolves.toEqual({ result: "valid" });
  expect(transport).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
  );
});
