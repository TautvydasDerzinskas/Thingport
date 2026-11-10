import { describe, expect, it } from "vitest";
import { canTurnOn, checkReachability, probeProof } from "../src/federation/reachability";
import type { AddressKind } from "../src/federation/addresses";
import { FederationFetchError } from "../src/federation/fetch";
import type { ReachabilityKind } from "../src/federation/settings";

// The check without a network: the Public URL, what its host resolves to, and what answers the probe there.
function check(options: { url: string; kind?: AddressKind; answer?: "self" | "other" | "none" }) {
  return checkReachability({
    publicUrl: async () => options.url,
    classify: async () => ({ kind: options.kind ?? "local", addresses: ["192.0.2.10"] }),
    fetch: (async (input: string | URL | Request) => {
      if (options.answer === "none") throw new TypeError("fetch failed");
      const nonce = String(input).split("/").pop()!;
      const proof = options.answer === "other" ? "not-it" : probeProof(nonce);
      return new Response(JSON.stringify({ proof }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
}

describe("checkReachability", () => {
  it("needs a Public URL", async () => {
    expect((await check({ url: "" })).kind).toBe("not_set");
  });

  it("is local when the address leads back here on a private network", async () => {
    const result = await check({ url: "http://192.168.1.30:8000", kind: "local", answer: "self" });
    expect(result).toMatchObject({ kind: "local", url: "http://192.168.1.30:8000", addresses: ["192.0.2.10"] });
  });

  it("is public when the address leads back here on a public one", async () => {
    expect((await check({ url: "https://things.example.org", kind: "public", answer: "self" })).kind).toBe("public");
  });

  it("says when something else answers at the address", async () => {
    expect((await check({ url: "https://things.example.org", kind: "public", answer: "other" })).kind).toBe(
      "elsewhere",
    );
  });

  it("lets a public address that can't loop back through, unconfirmed", async () => {
    expect((await check({ url: "https://things.example.org", kind: "public", answer: "none" })).kind).toBe(
      "public_unverified",
    );
  });

  it("calls a private address that doesn't answer unreachable", async () => {
    expect((await check({ url: "http://192.168.1.30:8000", kind: "local", answer: "none" })).kind).toBe("unreachable");
  });

  it("never probes an address on this machine", async () => {
    let probed = false;
    const result = await checkReachability({
      publicUrl: async () => "http://127.0.0.1:8000",
      classify: async () => ({ kind: "never", addresses: ["127.0.0.1"] }),
      fetch: (async () => {
        probed = true;
        return new Response("{}");
      }) as typeof fetch,
    });
    expect(result).toMatchObject({ kind: "unreachable", reason: "reserved" });
    expect(probed).toBe(false);
  });

  it("counts an answer cut off on the way as none, not as someone else's", async () => {
    const result = await checkReachability({
      publicUrl: async () => "https://things.example.org",
      classify: async () => ({ kind: "public", addresses: ["192.0.2.10"] }),
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"proof":'));
              controller.error(new Error("Body timeout"));
            },
          }),
        ),
    });
    expect(result.kind).toBe("public_unverified");
  });

  it("turns on unreached too, as links still work, but not without a Public URL or with one on this machine", () => {
    const kinds: ReachabilityKind[] = ["local", "public", "public_unverified", "elsewhere", "unreachable"];
    expect(kinds.map((kind) => canTurnOn({ kind }))).toEqual(kinds.map(() => true));
    expect(canTurnOn({ kind: "not_set" })).toBe(false);
    expect(canTurnOn({ kind: "unreachable", reason: "reserved" })).toBe(false);
  });
});

// A failed request as federationFetch throws one: Node's code on the cause.
function failing(code: string, message: string) {
  return async () => {
    throw new FederationFetchError(message, "network", undefined, {
      cause: Object.assign(new Error(message), { code }),
    });
  };
}

function probing(fetch: (url: string, init: RequestInit) => Promise<Response>, kind: AddressKind = "local") {
  return checkReachability({
    publicUrl: async () => "https://thingport.lan",
    classify: async () => ({ kind, addresses: ["192.168.1.20"] }),
    fetch,
    timeoutMs: 50,
  });
}

describe("why the Public URL didn't lead back here", () => {
  it("tells a certificate nothing trusts from no answer, without Node's hint about its own options", async () => {
    const said =
      "self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca";
    const result = await probing(failing("DEPTH_ZERO_SELF_SIGNED_CERT", said));
    expect(result).toMatchObject({ kind: "unreachable", reason: "certificate", detail: "self-signed certificate" });
  });

  it("tells a refused connection", async () => {
    const result = await probing(failing("ECONNREFUSED", "connect ECONNREFUSED 192.168.1.20:443"));
    expect(result).toMatchObject({ kind: "unreachable", reason: "refused" });
  });

  it("tells a name that doesn't resolve here", async () => {
    const result = await checkReachability({
      publicUrl: async () => "https://thingport.lan",
      classify: async () => {
        throw Object.assign(new Error("getaddrinfo ENOTFOUND thingport.lan"), { code: "ENOTFOUND" });
      },
    });
    expect(result).toMatchObject({ kind: "unreachable", reason: "not_found", addresses: [] });
  });

  it("tells nothing answering in time", async () => {
    const result = await probing(
      (_url, init) =>
        new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    expect(result).toMatchObject({ kind: "unreachable", reason: "timeout" });
  });

  it("tells a redirect, which isn't followed", async () => {
    const result = await probing(async () =>
      Response.redirect("https://login.thingport.lan/?next=%2Fapi%2Ffederation%2Fprobe", 302),
    );
    expect(result).toMatchObject({
      kind: "unreachable",
      reason: "redirect",
      detail: "https://login.thingport.lan/?next=%2Fapi%2Ffederation%2Fprobe",
    });
  });

  it("says what something else answered with", async () => {
    const result = await probing(async () => new Response("<h1>Bad gateway</h1>", { status: 502 }));
    expect(result).toMatchObject({ kind: "elsewhere", detail: "HTTP 502" });
  });

  it("keeps a public address that failed from inside unconfirmed, whatever failed: a router may answer for it", async () => {
    const result = await probing(failing("DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate"), "public");
    expect(result).toMatchObject({ kind: "public_unverified", reason: "certificate" });
  });
});
