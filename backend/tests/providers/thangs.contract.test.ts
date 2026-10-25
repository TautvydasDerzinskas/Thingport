import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { readConnection } from "../../src/providers/connections";
import { getThangsConnection, setUserThangsSession } from "../../src/providers/thangs/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import {
  binary,
  json,
  loadFixture,
  stl,
  text,
  threeMf,
  zip,
  cloudflareChallenge,
  type FetchHandler,
  expectStatus,
} from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Thangs end to end: details need no sign-in; the download link and the purchases need the user's access token (a JWT
// sent as a Bearer one, 401 when it's turned down), which the refresh token renews. Files are on Google Cloud Storage.
// Answers are the recorded shapes in fixtures/providers/thangs.

function jwt(payload: Record<string, unknown>): string {
  return `eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.c2ln`;
}

const THANGS_USER = "6509374";
const HOUR = 3600;
const now = Math.floor(Date.now() / 1000);
const ACCESS = jwt({ iss: "www.thangs.com", sub: THANGS_USER, exp: now + 24 * HOUR, username: "maker" });
const RENEWED = jwt({ iss: "www.thangs.com", sub: THANGS_USER, exp: now + 48 * HOUR, username: "maker" });
const REFRESH = jwt({ iss: "www.thangs.com/api/auth/refresh-tokens", sub: THANGS_USER, exp: now + 300 * 24 * HOUR });
const MODEL_ID = "1060509";
const MODEL_URL = `https://thangs.com/designer/Cinderwing3D/3d-model/Crystal%20Dragon-${MODEL_ID}`;
const LIKES_URL = "https://thangs.com/mythangs/liked-models";
const COLLECTION_ID = "493183";

/** Scenarios beyond the contract's "ok", "rejected" and "list":
 *  - "renewed": only the renewed token downloads (the stored one is out or stale);
 *  - "refresh-rejected": the refresh token is turned down too;
 *  - "limit", "paid", "membership", "print-only", "missing", "blocked", "no-model-files": the model or the download
 *    is of that kind. */
function handlerFor(scenario: string): FetchHandler {
  const modelFixture =
    scenario === "paid"
      ? "model-paid"
      : scenario === "membership"
        ? "model-membership"
        : scenario === "print-only"
          ? "model-print-only"
          : "model-detail";
  return async ({ url, headers }) => {
    if (url.hostname === "storage.googleapis.com" && url.pathname.endsWith(".zip")) {
      return binary(
        scenario === "no-model-files"
          ? await zip("thangs-readme", { "README.txt": Buffer.from("just words") })
          : await zip("thangs-model", {
              "Crystal Dragon.3mf": await threeMf("thangs-dragon"),
              "Crystal Dragon.stl": stl("dragon"),
            }),
      );
    }
    if (!url.pathname.startsWith("/api/")) return undefined;
    const path = url.pathname.slice("/api".length);
    if (path === `/models/v2/${MODEL_ID}`) {
      if (scenario === "missing") return text("Forbidden", 403);
      if (scenario === "blocked") return text("slow down", 429);
      return json(loadFixture("thangs", modelFixture));
    }
    if (path === "/auth/v2/refresh-tokens") {
      if (scenario === "refresh-rejected") return text("Unauthorized", 401);
      return json(JSON.parse(JSON.stringify(loadFixture("thangs", "refresh-token")).replace("{token}", RENEWED)));
    }
    if (path === `/v2/models/${MODEL_ID}/download-url`) {
      if (scenario === "rejected" || scenario === "refresh-rejected") return text("Unauthorized", 401);
      if (scenario === "renewed" && headers.authorization !== `Bearer ${RENEWED}`) return text("Unauthorized", 401);
      if (scenario === "limit") return json(loadFixture("thangs", "download-limit"));
      if (scenario === "paid" || scenario === "membership") return text("Forbidden", 403);
      return json(loadFixture("thangs", "download-url"));
    }
    if (path === "/users/current/purchases") return json(loadFixture("thangs", "purchases"));
    if (path === `/users/v4/${THANGS_USER}/likes`) return json(loadFixture("thangs", "likes"));
    if (path === `/collections/${COLLECTION_ID}`) {
      if (scenario === "gone") return json({ message: "Invalid collectionId" }, 404);
      return json(loadFixture("thangs", "collection"));
    }
    return undefined;
  };
}

const spec: ProviderContractSpec = {
  id: "thangs",
  name: "Thangs",
  modelUrl: MODEL_URL,
  expected: {
    externalId: MODEL_ID,
    title: "Crystal Dragon",
    notesIncludes: "**Print-in-place** dragon",
    author: "Cinderwing3D",
    tags: ["Articulated", "Dragon"],
    category: { name: "Characters", parent: "Toys & Games" },
    // The designer's one photo; the video and the flagged picture are left out.
    galleryImages: 1,
    // A zip of model files: a plate each, none a profile's.
    plateInstanceIds: [null, null],
    plateFilenames: ["Crystal Dragon.3mf", "Crystal Dragon.stl"],
  },
  connect: async (userId) => {
    await setUserThangsSession(userId, {
      token: ACCESS,
      refreshToken: REFRESH,
      userId: THANGS_USER,
      expiresAt: new Date((now + 24 * HOUR) * 1000),
    });
  },
  disconnect: async (userId) => {
    await setUserThangsSession(userId, null);
  },
  createHandler: handlerFor,
  credentials: { sessionCode: "thangs_session", connection: getThangsConnection },
  reimport: {},
  list: {
    endpoint: "/api/import/thangs-list/entries",
    url: LIKES_URL,
    title: "Thangs likes",
    importedId: MODEL_ID,
    freshId: "1582292",
  },
  // Every file is the user's to download, so the sign-in is there; paid models they own stay in the listing.
  listing: {
    sync: {
      externalId: COLLECTION_ID,
      sourceUrl: "https://thangs.com/designer/tautvydasuk/collection/Thangs%20collection-493183",
    },
    ids: [MODEL_ID, "1582292"],
    needsSignIn: true,
  },
};

const ctx = describeProviderContract(spec);

const storedToken = async () =>
  (await readConnection<{ token: string | null }>(ctx.userId, "thangs"))?.secret?.token ?? null;
const pathsOf = (calls: { url: URL }[]) => calls.map((call) => call.url.pathname.replace(/^\/api/, ""));

describe("Thangs specifics", () => {
  describe("token refresh", () => {
    it("renews an access token that has run out before downloading, and keeps the renewed one", async () => {
      await setUserThangsSession(ctx.userId, {
        token: ACCESS,
        refreshToken: REFRESH,
        userId: THANGS_USER,
        expiresAt: new Date((now - HOUR) * 1000),
      });
      const stub = ctx.stub("renewed");
      const res = await ctx.importUrl();
      expectStatus(res, 200);
      const api = pathsOf(stub.calls.filter((call) => call.url.pathname.startsWith("/api/")));
      expect(api).toEqual([`/models/v2/${MODEL_ID}`, "/auth/v2/refresh-tokens", `/v2/models/${MODEL_ID}/download-url`]);
      expect(stub.calls.find((call) => call.url.pathname.endsWith("/refresh-tokens"))?.headers.cookie).toBe(
        `refreshToken=${REFRESH}`,
      );
      expect(await storedToken()).toBe(RENEWED);
      expect(await getThangsConnection(ctx.userId)).toBe("connected");
    });

    it("renews it once when Thangs turns the stored one down, and tries the download again", async () => {
      await spec.connect(ctx.userId);
      const stub = ctx.stub("renewed");
      const res = await ctx.importUrl();
      expectStatus(res, 200);
      expect(pathsOf(stub.calls.filter((call) => call.url.pathname.startsWith("/api/")))).toEqual([
        `/models/v2/${MODEL_ID}`,
        `/v2/models/${MODEL_ID}/download-url`,
        "/auth/v2/refresh-tokens",
        `/v2/models/${MODEL_ID}/download-url`,
      ]);
      expect(await storedToken()).toBe(RENEWED);
    });

    it("marks the sign-in rejected when the refresh token is turned down too", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("refresh-rejected");
      const res = await ctx.importUrl();
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("thangs_session");
      expect(await getThangsConnection(ctx.userId)).toBe("expired");
    });

    it("marks it rejected when an access token that has run out has nothing to renew it", async () => {
      await setUserThangsSession(ctx.userId, {
        token: ACCESS,
        refreshToken: null,
        userId: THANGS_USER,
        expiresAt: new Date((now - HOUR) * 1000),
      });
      // Without a refresh token the stored one is used until Thangs says no.
      ctx.stub("rejected");
      const res = await ctx.importUrl();
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("thangs_session");
      expect(await getThangsConnection(ctx.userId)).toBe("expired");
    });
  });

  describe("download limit", () => {
    it("reports THANGS_DOWNLOAD_LIMIT as 429, and keeps the sign-in", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("limit");
      const res = await ctx.importUrl();
      expectStatus(res, 429);
      expect(res.body.code).toBe("THANGS_DOWNLOAD_LIMIT");
      expect(await getThangsConnection(ctx.userId)).toBe("connected");
      expect(await ctx.prints()).toHaveLength(0);
    });
  });

  describe("paid and print-only models", () => {
    it("refuses a print-only model before asking for a download, and without needing a sign-in", async () => {
      await spec.disconnect(ctx.userId);
      const stub = ctx.stub("print-only");
      const res = await ctx.importUrl();
      expect(res.status).toBe(403);
      expect(res.body.detail).toMatch(/sold only as a print/);
      expect(pathsOf(stub.calls)).toEqual([`/models/v2/${MODEL_ID}`]);
    });

    it("refuses a paid model the user hasn't bought, naming its price", async () => {
      await spec.connect(ctx.userId);
      const stub = ctx.stub("paid");
      const res = await ctx.importUrl();
      expectStatus(res, 403);
      expect(res.body.detail).toMatch(/paid Thangs model \(\$4\)/);
      // Unlike print-only, the download is asked for: Thangs says whether the account bought it.
      expect(pathsOf(stub.calls)).toContain(`/v2/models/${MODEL_ID}/download-url`);
      expect(await prisma.print.count({ where: { userId: ctx.userId, sourceProvider: "thangs" } })).toBe(0);
    });

    it("refuses a membership-only model", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("membership");
      const res = await ctx.importUrl();
      expect(res.status).toBe(403);
      expect(res.body.detail).toMatch(/designer's membership only/);
    });
  });

  it("answers a model Thangs hides or doesn't have with 404", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("missing");
    expect((await ctx.importUrl()).status).toBe(404);
  });

  it("reports a block as 429 without a code", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("blocked");
    const res = await ctx.importUrl();
    expect(res.status).toBe(429);
    expect(res.body.code).toBeUndefined();
  });

  it("reports a block while filling a model's details as 429", async () => {
    const print = await prisma.print.create({
      data: {
        userId: ctx.userId,
        name: "Bare",
        nameNormalized: "bare",
        sourceProvider: "thangs",
        sourceExternalId: MODEL_ID,
      },
    });
    ctx.stub("blocked");
    expect((await ctx.post(`/api/print/${print.id}/fill-gaps`, {})).status).toBe(429);
  });

  it("refuses a download of nothing but files it can't import", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("no-model-files");
    const res = await ctx.importUrl();
    expect(res.status).toBe(400);
    expect(res.body.detail).toMatch(/no files Thingport can import/);
  });

  it("takes a Cloudflare challenge on a public read as a block, not a missing model", async () => {
    await spec.connect(ctx.userId);
    ctx.install(({ url }) => (url.pathname.startsWith("/api/models/") ? cloudflareChallenge() : undefined));
    const res = await ctx.importUrl();
    expect(res.status).toBe(429);
  });

  describe("likes list", () => {
    it("leaves out print-only models and paid ones the user hasn't bought", async () => {
      await spec.connect(ctx.userId);
      ctx.stub("list");
      const res = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
      expectStatus(res, 200);
      expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([MODEL_ID, "1582292"]);
    });

    it("needs the user's Thangs sign-in", async () => {
      await spec.disconnect(ctx.userId);
      ctx.stub("list");
      const res = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("thangs_session");
    });
  });
});
