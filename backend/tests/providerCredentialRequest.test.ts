import { afterEach, describe, expect, it, vi } from "vitest";
import { assertCredentialDestination, credentialRequest } from "../src/providers/credentialRequest";
import { resolveCults3dDownload } from "../src/providers/cults3d/api";

import { checkEufymakeAuth } from "../src/providers/eufymake/api";
import { resolvePinshapeDownload } from "../src/providers/pinshape/api";

afterEach(() => vi.unstubAllGlobals());

describe("provider credential destinations", () => {
  it.each([
    ["makerworld-page", "https://makerworld.com/en/models/1"],
    ["makerworld-page", "https://www.makerworld.com/en/models/1"],
    ["makerworld-cloud", "https://api.bambulab.com/v1/design-service/design/1"],
    ["thingiverse-api", "https://api.thingiverse.com/things/1"],
    ["myminifactory-session", "https://www.myminifactory.com/api/v2/me"],
    ["snapmaker-api", "https://api-models.snapmaker.com/api/model/1"],
    ["makeronline-api", "https://www.makeronline.com/api/model/1"],
    ["crealitycloud-api", "https://www.crealitycloud.com/api/cxy/model/1"],
    ["nexprint-api", "https://www.nexprint.com/gateway/api/v1/model/1"],
    ["thangs-api", "https://thangs.com/api/models/1"],
    ["eufymake-api", "https://aiot-wapi-eu.ankermake.com/web/modelbase/list"],
    ["cults3d-api", "https://cults3d.com/graphql"],
    ["cgtrader-session", "https://www.cgtrader.com/items/1/free-downloads/1"],
    ["grabcad-session", "https://grabcad.com/community/api/v1/models/1"],
    ["makerables-api", "https://www.makerables.com/api/projects/1"],
    ["makerables-session", "https://www.makerables.com/auth/access-token"],
    ["toymakr3d-session", "https://www.toymakr3d.com/models/1"],
    ["pinshape-session", "https://pinshape.com/items/1"],
  ] as const)("permits %s at %s", (destination, url) => {
    expect(assertCredentialDestination(destination, url).href).toBe(url);
  });

  it.each([
    "http://cults3d.com/model/1",
    "https://fake-cults3d.com/model/1",
    "https://cults3d.com.evil.example/model/1",
    "https://cults3d.com:444/model/1",
    "https://user:password@cults3d.com/model/1",
  ])("rejects unsafe Cults3D session destination %s", (url) => {
    expect(() => assertCredentialDestination("cults3d-session", url)).toThrow("Refusing to send");
  });

  it.each([
    ["cgtrader-session", "https://www.cgtrader.com@attacker.example/items/1"],
    ["grabcad-session", "https://grabcad.com.attacker.example/community/api/v1/models/1"],
    ["makerables-api", "https://cdn.makerables.com/api/projects/1"],
    ["toymakr3d-session", "https://toymakr3d.com/models/1"],
    ["pinshape-session", "http://pinshape.com/items/1"],
  ] as const)("rejects %s at %s", (destination, url) => {
    expect(() => assertCredentialDestination(destination, url)).toThrow("Refusing to send");
  });

  it("keeps a Pinshape sign-in from a path that would change the host", async () => {
    const sent = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", sent);
    await expect(resolvePinshapeDownload("@attacker.example/download", "session=secret")).rejects.toThrow(
      "Refusing to send",
    );
    expect(sent).not.toHaveBeenCalled();
  });

  it.each(["attacker.makerworld.com", "nested.www.makerworld.com"])(
    "rejects saved MakerWorld cookies to %s before network access",
    async (host) => {
      const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
      await expect(
        credentialRequest(
          "makerworld-page",
          `https://${host}/en/models/1`,
          { headers: { Cookie: "token=saved-makerworld-secret" } },
          transport,
        ),
      ).rejects.toThrow("Refusing to send");
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it("blocks cross-origin redirects before the token reaches the next hop", async () => {
    const requests: string[] = [];
    let cancelled = false;
    const transport = vi.fn<(url: string) => Promise<Response>>(async (url: string) => {
      requests.push(url);
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 307, headers: { Location: "https://evil.example/receive" } },
      );
    });
    await expect(
      credentialRequest(
        "crealitycloud-api",
        "https://www.crealitycloud.com/api/cxy/profile",
        {
          method: "POST",
          headers: { __cxy_token_: "secret" },
          body: "{}",
        },
        transport,
      ),
    ).rejects.toThrow("Refusing to send");
    expect(requests).toEqual(["https://www.crealitycloud.com/api/cxy/profile"]);
    expect(cancelled).toBe(true);
    expect(transport).toHaveBeenCalledWith(requests[0], expect.objectContaining({ redirect: "manual" }));
  });

  it("follows a same-origin redirect with its credential", async () => {
    const transport = vi
      .fn<(url: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: "/api/next" } }))
      .mockResolvedValueOnce(new Response("ok"));
    const response = await credentialRequest(
      "snapmaker-api",
      "https://api-models.snapmaker.com/api/start",
      { headers: { Authorization: "Bearer secret" } },
      transport,
    );
    expect(await response.text()).toBe("ok");
    expect(transport.mock.calls[1][0]).toBe("https://api-models.snapmaker.com/api/next");
  });

  it("does not send a Cults3D session over HTTP", async () => {
    const sent = vi.spyOn(globalThis, "fetch");
    try {
      await expect(
        resolveCults3dDownload("http://cults3d.com/orders/1/download", {
          session: "secret",
          clearance: null,
          userAgent: null,
        }),
      ).rejects.toThrow("Refusing to send");
      expect(sent).not.toHaveBeenCalled();
    } finally {
      sent.mockRestore();
    }
  });
});

it("does not forward EufyMake tokens to another origin", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(null, { status: 307, headers: { location: "https://makeitreal.eufymake.com/capture" } }),
    );
  vi.stubGlobal("fetch", transport);
  await expect(checkEufymakeAuth({ token: "secret-token", gtoken: "secret-gtoken" })).resolves.toBe("unreachable");
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith(
    "https://aiot-wapi-eu.ankermake.com/web/modelbase/user/get_user_info",
    expect.objectContaining({
      redirect: "manual",
      headers: expect.objectContaining({ "X-Auth-Token": "secret-token", Gtoken: "secret-gtoken" }),
    }),
  );
});
