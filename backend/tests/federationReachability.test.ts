import { describe, expect, it } from "vitest";
import { canTurnOn, checkReachability, probeProof } from "../src/federation/reachability";
import type { AddressKind } from "../src/federation/addresses";

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
    expect(result.kind).toBe("unreachable");
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

  it("only lets reachable results turn federation on", () => {
    expect(["local", "public", "public_unverified"].every((kind) => canTurnOn(kind as never))).toBe(true);
    expect(["not_set", "elsewhere", "unreachable"].some((kind) => canTurnOn(kind as never))).toBe(false);
  });
});
