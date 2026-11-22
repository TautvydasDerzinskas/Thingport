import { describe, expect, it, vi } from "vitest";

// No pacing between MakerWorld calls: config.ts reads it on load, so it's hoisted.
vi.hoisted(() => {
  process.env.IMPORT_MAKERWORLD_CALL_DELAY_MS = "0";
});
vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

import { getMakerworldConnection, setUserMakerworldCookie } from "../../src/providers/makerworld/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import {
  assertThat,
  binary,
  cloudflareChallenge,
  expectStatus,
  html,
  json,
  loadFixture,
  threeMf,
  type FetchHandler,
} from "./support";

// MakerWorld end to end, through the shared link import: with the user's cookie its cloud API (api.bambulab.com, the
// cookie's `token` sent as a bearer one, 401 when it's turned down) reads the design and signs each print profile's
// 3MF; collections are read from makerworld.com's own API, public ones without a sign-in. Answers are the recorded
// shapes in fixtures/providers/makerworld (its own suites' makerworldProfilesImport and collectionSync).

const BEARER = "test-bearer";
const DESIGN_ID = "1452153";
const MODEL_URL = `https://makerworld.com/en/models/${DESIGN_ID}-articulated-phoenix`;
const COLLECTION_ID = "2846512";
const COLLECTION_URL = `https://makerworld.com/en/collections/${COLLECTION_ID}-phoenix-flock`;

/** A profile's 3MF, signed, as the page's own "Download 3MF" asks for it. */
const profileDownload = (instanceId: string) =>
  json({ url: `https://s3.example.com/phoenix-${instanceId}.3mf?sig=1`, name: `phoenix-${instanceId}.3mf` });

function handlerFor(scenario: string): FetchHandler {
  return async ({ url, headers }) => {
    if (url.hostname === "s3.example.com") return binary(await threeMf(url.pathname));
    if (url.hostname === "api.bambulab.com") {
      assertThat(headers.authorization === `Bearer ${BEARER}`, "the cookie's token is sent as a bearer one");
      if (url.pathname === `/v1/design-service/design/${DESIGN_ID}`) {
        if (scenario === "rejected") return json({ error: "unauthorized" }, 401);
        if (scenario === "missing") return json({}, 404);
        return json(loadFixture("makerworld", "design"));
      }
      const profile = url.pathname.match(/^\/v1\/design-service\/instance\/(\d+)\/f3mf$/);
      return profile ? profileDownload(profile[1]) : undefined;
    }
    // Its pictures, on makerworld.bblmw.com, fall through to the stub's own PNG.
    if (url.hostname !== "makerworld.com") return undefined;
    // Without a sign-in an import reads the model's page, its design in the page data, and downloads as anyone.
    if (url.pathname.startsWith(`/en/models/${DESIGN_ID}`)) {
      const nextData = { props: { pageProps: { design: loadFixture("makerworld", "design") } } };
      return html(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`);
    }
    const anonymous = url.pathname.match(/^\/api\/v1\/design-service\/instance\/(\d+)\/f3mf$/);
    if (anonymous) return profileDownload(anonymous[1]);
    // A creator's full profile is behind Cloudflare for a server; the design's own summary of them stands in.
    if (url.pathname.startsWith("/api/v1/design-user-service/user/profile/")) return cloudflareChallenge();
    if (url.pathname === `/api/v1/design-service/favorites/${COLLECTION_ID}`) {
      return scenario === "gone" ? json({ error: "not found" }, 404) : json(loadFixture("makerworld", "collection"));
    }
    if (url.pathname === `/api/v1/design-service/favorites/${COLLECTION_ID}/designs`) {
      return json(loadFixture("makerworld", "collection-designs"));
    }
    return undefined;
  };
}

const spec: ProviderContractSpec = {
  id: "makerworld",
  name: "MakerWorld",
  modelUrl: MODEL_URL,
  expected: {
    externalId: DESIGN_ID,
    title: "Articulated Phoenix",
    notesIncludes: "A phoenix.",
    author: "Deus Cat",
    tags: ["Phoenix"],
    category: { name: "Creatures", parent: "Miniatures" },
    // Its cover; a profile's own picture goes on that profile's plate instead.
    galleryImages: 1,
    // The default profile, the one a plain link brings.
    plateInstanceIds: ["2"],
    plateFilenames: ["phoenix-2.3mf"],
  },
  connect: async (userId) => {
    await setUserMakerworldCookie(userId, `token=${BEARER}`);
  },
  disconnect: async (userId) => {
    await setUserMakerworldCookie(userId, null);
  },
  createHandler: handlerFor,
  credentials: { sessionCode: "MAKERWORLD_AUTH", connection: getMakerworldConnection },
  reimport: {
    profile: {
      url: `${MODEL_URL}#profileId-1`,
      plateInstanceIds: ["2", "1"],
    },
  },
  list: {
    endpoint: "/api/import/collection/entries",
    url: COLLECTION_URL,
    title: "Phoenix flock",
    importedId: DESIGN_ID,
    freshId: "1452154",
  },
  // A public collection, which lists without a sign-in; a private one would need its owner's.
  listing: {
    sync: { externalId: COLLECTION_ID, sourceUrl: `https://makerworld.com/en/collections/${COLLECTION_ID}` },
    ids: [DESIGN_ID, "1452154"],
    needsSignIn: false,
  },
  skip: {
    missingCredentials:
      "without a sign-in an import falls back to the model's public page and its anonymous download (pinned below), so nothing is refused",
    rejectedCredentials:
      "a sign-in turned down on a single import is a 400 MAKERWORLD_AUTH (pinned below) but isn't marked expired: only a batch import or a sync marks it",
    fillGaps:
      'a model MakerWorld no longer has is a 400 "Couldn\'t read this model from MakerWorld", not a 404: details.read throws where it would answer null',
  },
};

const ctx = describeProviderContract(spec);

describe("MakerWorld specifics", () => {
  it("imports without a sign-in from the model's public page, as anyone downloads it", async () => {
    const stub = ctx.stub("ok");
    const res = await ctx.importUrl();
    expectStatus(res, 200);
    expect(res.body.import_outcome).toBe("created");
    // Never the cloud API, which is what takes the sign-in.
    expect(stub.callsTo("api.bambulab.com")).toHaveLength(0);
    expect(stub.callsTo("makerworld.com").map((call) => call.url.pathname)).toContain(
      `/en/models/${DESIGN_ID}-articulated-phoenix`,
    );
    expect(res.body.plates.map((plate: { profile_id: string | null }) => plate.profile_id)).toEqual(["2"]);
  });

  it("answers a sign-in MakerWorld turns down with 400 MAKERWORLD_AUTH, importing nothing", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("rejected");
    const res = await ctx.importUrl();
    expectStatus(res, 400);
    expect(res.body.code).toBe("MAKERWORLD_AUTH");
    expect(await ctx.prints()).toHaveLength(0);
  });
});
