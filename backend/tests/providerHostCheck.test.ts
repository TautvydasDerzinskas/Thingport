import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// Provider hosts are matched on a dot boundary: `makerworld.com` and its subdomains are MakerWorld, a look-alike
// such as `fake-makerworld.com` is just another site -- and never gets the user's stored MakerWorld cookie.

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

const { createApp } = await import("../src/app");
const { prisma } = await import("../src/db");
const { hostIs } = await import("../src/utils/urlUtils");
const { parseMakerworldModelUrl } = await import("../src/providers/makerworld/api");
const { parseMakerworldCollectionUrl } = await import("../src/providers/makerworld/collections");
const { setUserMakerworldCookie } = await import("../src/providers/makerworld/session");

const LOOK_ALIKES = ["fake-makerworld.com", "evilmakerworld.com", "makerworld.com.evil.example"];

describe("hostIs", () => {
  it("matches the domain and its subdomains, in any case", () => {
    expect(hostIs("makerworld.com", "makerworld.com")).toBe(true);
    expect(hostIs("www.makerworld.com", "makerworld.com")).toBe(true);
    expect(hostIs("attacker.makerworld.com", "makerworld.com")).toBe(true);
    expect(hostIs("MakerWorld.com", "makerworld.com")).toBe(true);
  });

  it("doesn't match a look-alike", () => {
    for (const host of LOOK_ALIKES) expect(hostIs(host, "makerworld.com")).toBe(false);
  });
});

describe("MakerWorld URL parsing", () => {
  it("accepts makerworld.com and its subdomains", () => {
    expect(parseMakerworldModelUrl("https://makerworld.com/en/models/123#profileId-9")).toEqual({
      designId: "123",
      requestedInstanceId: "9",
    });
    expect(parseMakerworldModelUrl("https://www.makerworld.com/en/models/123")?.designId).toBe("123");
    expect(parseMakerworldCollectionUrl("https://makerworld.com/en/collections/456")).toEqual({ collectionId: "456" });
  });

  it("doesn't take a look-alike domain for MakerWorld", () => {
    for (const host of LOOK_ALIKES) {
      expect(parseMakerworldModelUrl(`https://${host}/models/1`)).toBeNull();
      expect(parseMakerworldCollectionUrl(`https://${host}/collections/1`)).toBeNull();
    }
  });
});

describe("importing with a stored MakerWorld cookie", () => {
  const app = createApp();
  const stamp = Date.now();
  const SECRET = "stored-secret";
  let token: string;

  // A one-facet ASCII STL is enough: the import only needs a model file back.
  const modelFile = Buffer.from(
    "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n",
  );

  type Call = { url: string; headers: Record<string, string> };
  function stubFetch(): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, headers: { ...(init?.headers as Record<string, string> | undefined) } });
        return new Response(modelFile, {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": 'attachment; filename="part.stl"',
          },
        });
      }),
    );
    return calls;
  }

  beforeAll(async () => {
    const email = `provider-host-check-${stamp}@example.com`;
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Host Check Test", email, password: "password123" });
    token = res.body.token;
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    // No `token=` in it, so a real MakerWorld link takes the page path (with the cookie) rather than the cloud API.
    await setUserMakerworldCookie(user.id, `session=${SECRET}; other=${SECRET}-2`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("doesn't send the cookie to a look-alike domain", async () => {
    const calls = stubFetch();
    await request(app)
      .post("/api/import")
      .set({ Authorization: `Bearer ${token}` })
      .send({ url: "https://fake-makerworld.com/models/1" });

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(new URL(call.url).hostname).toBe("fake-makerworld.com");
      expect(JSON.stringify(call.headers)).not.toContain(SECRET);
    }
  });

  it("rejects arbitrary MakerWorld subdomains before sending the saved cookie", async () => {
    const calls = stubFetch();
    await request(app)
      .post("/api/import")
      .set({ Authorization: `Bearer ${token}` })
      .send({ url: "https://attacker.makerworld.com/en/models/123" });

    expect(calls).toEqual([]);
  });

  it("still sends it to makerworld.com and www.makerworld.com", async () => {
    for (const host of ["makerworld.com", "www.makerworld.com"]) {
      const calls = stubFetch();
      await request(app)
        .post("/api/import")
        .set({ Authorization: `Bearer ${token}` })
        .send({ url: `https://${host}/en/models/${(stamp % 1_000_000) + host.length}` });

      const page = calls.find((call) => new URL(call.url).hostname === host);
      expect(page?.headers.Cookie).toContain(SECRET);
      vi.unstubAllGlobals();
    }
  });

  it("doesn't send the cookie to MakerWorld over HTTP", async () => {
    for (const host of ["makerworld.com", "www.makerworld.com"]) {
      const calls = stubFetch();
      await request(app)
        .post("/api/import")
        .set({ Authorization: `Bearer ${token}` })
        .send({ url: `http://${host}/en/models/${(stamp % 1_000_000) + host.length + 100}` });

      const page = calls.find((call) => call.url.startsWith(`http://${host}/`));
      expect(page).toBeDefined();
      expect(JSON.stringify(page?.headers)).not.toContain(SECRET);
      vi.unstubAllGlobals();
    }
  });
});
