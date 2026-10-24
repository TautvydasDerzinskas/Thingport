import { afterEach, describe, expect, it, vi } from "vitest";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import net from "node:net";
import { isBlockedIp } from "../src/utils/urlUtils";
import { remoteRequest } from "../src/utils/remoteRequest";
import { browserFetch } from "../src/utils/browserFetch";

vi.mock("../src/utils/browserFetch", () => ({ browserFetch: vi.fn<typeof browserFetch>() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe.each([false, true])("remote request (browser=%s)", (browser) => {
  function transport() {
    const mocked = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
    vi.stubGlobal("fetch", mocked);
    return mocked;
  }

  it("blocks a public redirect to localhost before sending any private request", async () => {
    const cancel = vi.fn<() => void>();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 302,
      headers: { location: "http://127.0.0.1/admin" },
    });
    const request = transport().mockResolvedValueOnce(response);
    await expect(remoteRequest("https://8.8.8.8/start", {}, browser)).rejects.toThrow("Local addresses");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].redirect).toBe("manual");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("follows public relative redirects and preserves the final response", async () => {
    const final = new Response("public content");
    const request = transport()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/end" } }))
      .mockResolvedValueOnce(final);
    expect(await remoteRequest("https://8.8.8.8/start", {}, browser)).toBe(final);
    expect(request.mock.calls[1][0]).toBe("https://8.8.8.8/end");
  });

  it("rewrites POST to GET on 302 and preserves POST on 307", async () => {
    const request = transport()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/post" } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/get" } }))
      .mockResolvedValueOnce(new Response("ok"));
    await remoteRequest("https://8.8.8.8/start", { method: "POST", body: "payload" }, browser);
    expect(request.mock.calls[1][1]).toMatchObject({ method: "POST", body: "payload" });
    expect(request.mock.calls[2][1]).toMatchObject({ method: "GET", body: undefined });
  });

  it("caps redirect loops", async () => {
    const request = transport().mockImplementation(
      async () => new Response(null, { status: 302, headers: { location: "/loop" } }),
    );
    await expect(remoteRequest("https://8.8.8.8/start", {}, browser)).rejects.toThrow("Too many remote redirects");
    expect(request).toHaveBeenCalledTimes(11);
  });
});

describe("connection-time DNS policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "::1",
    "0:0:0:0:0:0:0:1",
    "febf::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "2002:7f00:1::",
    "2001::1",
  ])("blocks %s", (address) => {
    expect(isBlockedIp(address)).toBe(true);
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "blocks a rebind to %s at the real socket lookup",
    async (address) => {
      vi.spyOn(dnsPromises, "resolve4").mockResolvedValue(["8.8.8.8"] as never);
      vi.spyOn(dnsPromises, "resolve6").mockResolvedValue([] as never);
      const connection = vi.fn<(socket: net.Socket) => void>();
      const server = net.createServer(connection);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as net.AddressInfo).port;
      const lookup = vi.spyOn(dns, "lookup").mockImplementation(((
        _host: string,
        _options: unknown,
        callback: (error: Error | null, records: dns.LookupAddress[]) => void,
      ) => {
        callback(null, [{ address, family: net.isIP(address) }]);
      }) as typeof dns.lookup);
      try {
        await expect(remoteRequest(`http://rebind.example:${port}/`)).rejects.toThrow("fetch failed");
        expect(lookup).toHaveBeenCalledOnce();
        expect(connection).not.toHaveBeenCalled();
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it("re-evaluates the browser exception on every redirect", async () => {
    vi.spyOn(dnsPromises, "resolve4").mockResolvedValue(["8.8.8.8"] as never);
    vi.spyOn(dnsPromises, "resolve6").mockResolvedValue([] as never);
    vi.mocked(browserFetch).mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://8.8.8.8/file" } }),
    );
    const native = vi
      .fn<(url: string, init: RequestInit & { dispatcher?: unknown }) => Promise<Response>>()
      .mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", native);
    await remoteRequest("https://www.thingiverse.com/start", {}, true);
    expect(browserFetch).toHaveBeenCalledOnce();
    expect(native).toHaveBeenCalledOnce();
    expect(native.mock.calls[0][1].dispatcher).toBeDefined();
  });

  it.each([
    "https://evil.thingiverse.com/file",
    "http://www.thingiverse.com/file",
    "https://www.thingiverse.com:8443/file",
  ])("uses guarded transport for %s", async (url) => {
    vi.spyOn(dnsPromises, "resolve4").mockResolvedValue(["8.8.8.8"] as never);
    vi.spyOn(dnsPromises, "resolve6").mockResolvedValue([] as never);
    const native = vi
      .fn<(url: string, init: RequestInit & { dispatcher?: unknown }) => Promise<Response>>()
      .mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", native);
    await remoteRequest(url, {}, true);
    expect(browserFetch).not.toHaveBeenCalled();
    expect(native.mock.calls[0][1].dispatcher).toBeDefined();
  });
});
