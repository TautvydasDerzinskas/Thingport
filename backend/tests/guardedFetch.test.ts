import dns from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rawFetch } from "../src/services/guardedFetch";

beforeEach(() => {
  vi.spyOn(dns, "resolve4").mockResolvedValue(["93.184.216.34"]);
  vi.spyOn(dns, "resolve6").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("rawFetch redirects", () => {
  it.each(["https://example.com/file", "https://www.thingiverse.com/file"])(
    "blocks private redirect destinations before requesting them from %s",
    async (source) => {
      const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
      await expect(rawFetch(source, {})).rejects.toThrow("Local addresses are not allowed");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
    },
  );

  it.each([
    "http://192.168.1.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/",
    "https://user:password@example.com/",
    "file:///etc/passwd",
  ])("rejects unsafe redirect %s before a second request", async (target) => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: target } }));
    await expect(rawFetch("https://example.com/file", {})).rejects.toThrow(
      /Local addresses|Credentials in URL|URL must start/,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("checks the redirect hostname's DNS records", async () => {
    vi.mocked(dns.resolve4).mockResolvedValueOnce(["93.184.216.34"]).mockResolvedValueOnce(["192.168.1.1"]);
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://internal.example/admin" } }));
    await expect(rawFetch("https://example.com/file", {})).rejects.toThrow("Local addresses are not allowed");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a private initial URL without a request", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private"));
    await expect(rawFetch("http://10.0.0.1/", {})).rejects.toThrow("Local addresses are not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("resolves relative redirects, retains same-origin cookies and reports the final URL", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "../final" } }))
      .mockResolvedValueOnce(new Response("file"));
    const response = await rawFetch("https://example.com/path/file", { Cookie: "session=secret" });
    expect(fetcher.mock.calls[1][0]).toBe("https://example.com/final");
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Cookie: "session=secret" });
    expect(response.url).toBe("https://example.com/final");
    expect(response.redirected).toBe(true);
    expect(await response.text()).toBe("file");
  });

  it("strips credentials case-insensitively on a cross-origin redirect", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "https://other.example/file" } }))
      .mockResolvedValueOnce(new Response("file"));
    const headers = {
      cOoKiE: "secret",
      AUTHORIZATION: "Bearer secret",
      "Proxy-Authorization": "secret",
      Accept: "*/*",
    };
    await rawFetch("https://example.com/file", headers);
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ Accept: "*/*" });
    expect(headers.cOoKiE).toBe("secret");
  });

  it("stops after the fetch-standard limit of twenty redirects", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
    await expect(rawFetch("https://example.com/loop", {})).rejects.toThrow("Too many redirects");
    expect(fetcher).toHaveBeenCalledTimes(21);
  });
});
