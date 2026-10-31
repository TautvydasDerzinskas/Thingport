import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns/promises";
import { fetchWithGuard, rawFetch } from "../src/services/guardedFetch";
import { browserFetch } from "../src/utils/browserFetch";
import { fetchViaFlaresolverr, shouldProxyHost } from "../src/services/flaresolverr";

// These tests exercise the real redirect and URL/DNS guards without opening a database or solver connection.
vi.mock("../src/services/flaresolverr", () => ({
  CLOUDFLARE_BLOCKED_CODE: "CLOUDFLARE_BLOCKED",
  fetchViaFlaresolverr: vi.fn<typeof fetchViaFlaresolverr>().mockResolvedValue(null),
  shouldProxyHost: vi.fn<typeof shouldProxyHost>().mockReturnValue(false),
  looksLikeCloudflareBlock: (headers: Headers) => headers.has("cf-mitigated"),
}));
vi.mock("../src/utils/browserFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/utils/browserFetch")>()),
  browserFetch: vi.fn<typeof browserFetch>(),
}));

const savedHeaders = { Cookie: "token=saved-secret", Accept: "text/html" };

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function captureRequests(...responses: Response[]) {
  const sent: { url: string; headers: Headers; init: RequestInit }[] = [];
  const transport = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url, init) => {
    // Snapshot here: the redirect guard mutates its headers for the next request.
    sent.push({ url, headers: new Headers(init.headers), init });
    return responses.shift() || new Response("public content");
  });
  vi.stubGlobal("fetch", transport);
  vi.mocked(browserFetch).mockImplementation((url, init) => transport(url, init as RequestInit));
  return sent;
}

beforeEach(() => {
  vi.spyOn(dns, "resolve4").mockResolvedValue(["8.8.8.8"] as never);
  vi.spyOn(dns, "resolve6").mockResolvedValue([] as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(shouldProxyHost).mockReturnValue(false);
  vi.mocked(fetchViaFlaresolverr).mockResolvedValue(null);
});

describe("shared link import credential boundary", () => {
  it.each([
    "https://attacker.makerworld.com/download",
    "https://nested.www.makerworld.com/download",
    "https://makerworld.com.attacker.example/download",
    "https://fake-makerworld.com/download",
    "https://makerworld.com:8443/download",
    "http://makerworld.com/download",
    "https://8.8.8.8/download",
  ])("loads %s anonymously with a saved sign-in", async (url) => {
    const sent = captureRequests();
    const response = await rawFetch(url, savedHeaders);
    expect(await response.text()).toBe("public content");
    expect(sent).toHaveLength(1);
    expect(sent[0].headers.has("cookie")).toBe(false);
    expect(sent[0].headers.get("accept")).toBe("text/html");
    expect(sent[0].init).toMatchObject({ redirect: "manual", dispatcher: expect.anything() });
    expect(savedHeaders.Cookie).toBe("token=saved-secret");
  });

  it("follows a non-model www link off-site after dropping its saved cookie", async () => {
    const sent = captureRequests(redirect("https://8.8.8.8/file.stl"));
    expect(await (await rawFetch("https://www.makerworld.com/download", savedHeaders)).text()).toBe("public content");
    expect(sent).toHaveLength(2);
    expect(sent[0].headers.get("cookie")).toBe(savedHeaders.Cookie);
    expect(sent[1].headers.has("cookie")).toBe(false);
  });

  it.each(["cookie", "CoOkIe"])("strips case-insensitive %s and authorization headers", async (name) => {
    const sent = captureRequests();
    await rawFetch("https://attacker.makerworld.com/download", {
      [name]: savedHeaders.Cookie,
      aUtHoRiZaTiOn: "Bearer secret",
      "pRoXy-AuThOrIzAtIoN": "Basic secret",
      Accept: "text/html",
    });
    expect(Object.fromEntries(sent[0].headers)).toEqual({ accept: "text/html" });
  });

  it.each(["makerworld.com", "www.makerworld.com"])("keeps a sign-in on same-origin %s redirects", async (host) => {
    const sent = captureRequests(redirect("/en/models/1"));
    await rawFetch(`https://${host}/start`, { cookie: savedHeaders.Cookie });
    expect(sent.map(({ headers }) => headers.get("cookie"))).toEqual([savedHeaders.Cookie, savedHeaders.Cookie]);
    expect(sent.every(({ init }) => init.redirect === "manual")).toBe(true);
    expect(sent.every(({ init }) => "dispatcher" in init)).toBe(true);
  });

  it.each([
    "https://attacker.makerworld.com/download",
    "https://8.8.8.8/download",
    "https://www.makerworld.com/download",
    "http://makerworld.com/download",
    "https://makerworld.com:8443/download",
  ])("never restores credentials after a redirect through %s", async (destination) => {
    const sent = captureRequests(redirect(destination), redirect("https://makerworld.com/en/models/1"));
    await rawFetch("https://makerworld.com/download", {
      CoOkIe: savedHeaders.Cookie,
      Authorization: "Bearer secret",
      "Proxy-Authorization": "Basic secret",
      Accept: "text/html",
    });
    expect(sent).toHaveLength(3);
    expect(sent[0].headers.get("cookie")).toBe(savedHeaders.Cookie);
    expect(sent[0].headers.get("authorization")).toBe("Bearer secret");
    for (const { headers } of sent.slice(1)) {
      expect(Object.fromEntries(headers)).toEqual({ accept: "text/html" });
    }
  });

  it("keeps the browser transport available to anonymous redirects", async () => {
    const sent = captureRequests(redirect("https://cdn.thingiverse.com/file.stl"));
    await rawFetch("https://makerworld.com/download", savedHeaders);
    expect(browserFetch).toHaveBeenCalledOnce();
    expect(sent[1].url).toBe("https://cdn.thingiverse.com/file.stl");
    expect(sent[1].headers.has("cookie")).toBe(false);
    expect(sent[1].init.redirect).toBe("manual");
  });

  it.each(["http://127.0.0.1/admin", "https://user:password@makerworld.com/download"])(
    "rejects invalid destination %s before network access",
    async (url) => {
      const sent = captureRequests();
      await expect(rawFetch(url, savedHeaders)).rejects.toThrow(/Local addresses|Credentials in URL/);
      expect(sent).toEqual([]);
    },
  );

  it("validates DNS even for the initial credential-bearing MakerWorld request", async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(["127.0.0.1"] as never);
    const sent = captureRequests();
    await expect(rawFetch("https://makerworld.com/en/models/1", savedHeaders)).rejects.toThrow("Local addresses");
    expect(sent).toEqual([]);
  });

  it.each(["http://127.0.0.1/admin", "https://private.example/admin"])(
    "blocks a signed-in redirect to %s before a private request",
    async (destination) => {
      vi.mocked(dns.resolve4)
        .mockResolvedValueOnce(["8.8.8.8"] as never)
        .mockResolvedValue(["10.0.0.1"] as never);
      const cancel = vi.fn<() => void>();
      const sent = captureRequests(
        new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: destination } }),
      );
      await expect(rawFetch("https://makerworld.com/download", savedHeaders)).rejects.toThrow("Local addresses");
      expect(sent).toHaveLength(1);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
});

describe("shared link import solver fallback", () => {
  it.each(["https://attacker.makerworld.com/download", "http://makerworld.com/download"])(
    "uses a warm solver route anonymously for %s",
    async (url) => {
      vi.mocked(shouldProxyHost).mockReturnValue(true);
      const sent = captureRequests();
      expect(await (await fetchWithGuard(url, { CoOkIe: savedHeaders.Cookie })).text()).toBe("public content");
      expect(fetchViaFlaresolverr).toHaveBeenCalledWith(url, null);
      expect(sent[0].headers.has("cookie")).toBe(false);
    },
  );

  it("keeps a generic subdomain's Cloudflare fallback anonymous", async () => {
    const url = "https://attacker.makerworld.com/download";
    captureRequests(new Response(null, { status: 403, headers: { "cf-mitigated": "challenge" } }));
    vi.mocked(fetchViaFlaresolverr).mockResolvedValue({ status: 200, body: "solved public content" });
    expect(await (await fetchWithGuard(url, savedHeaders)).text()).toBe("solved public content");
    expect(fetchViaFlaresolverr).toHaveBeenCalledWith(url, null);
  });

  it("preserves the allowed MakerWorld solver sign-in regardless of header casing", async () => {
    const url = "https://makerworld.com/en/models/1";
    vi.mocked(shouldProxyHost).mockReturnValue(true);
    vi.mocked(fetchViaFlaresolverr).mockResolvedValue({ status: 200, body: "signed-in page" });
    const sent = captureRequests();
    expect(await (await fetchWithGuard(url, { cookie: savedHeaders.Cookie })).text()).toBe("signed-in page");
    expect(fetchViaFlaresolverr).toHaveBeenCalledWith(url, savedHeaders.Cookie);
    expect(sent).toEqual([]);
  });
});
