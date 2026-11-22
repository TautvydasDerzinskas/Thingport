import { describe, expect, it, vi } from "vitest";
import { thingiverseConnection } from "../../src/providers/thingiverse/connection";
import { setThingiverseAccessToken } from "../../src/providers/thingiverse/token";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { assertThat, binary, expectStatus, json, loadFixture, stl, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Thingiverse end to end: its official API reads everything with the instance's App Token (an admin's, passed as
// `access_token`, never a user's), and the files are on its CDN, open to anyone with the link. Answers are the recorded
// shapes in fixtures/providers/thingiverse (its own suites' thingiverseImport and thingiverseCollection).

const TOKEN = "test-access-token";
const THING_ID = "9990001";
const COLLECTION_ID = "40781574";
const COLLECTION_URL = `https://www.thingiverse.com/Derzinskas/collections/${COLLECTION_ID}/things`;

/** "rejected": Thingiverse turns the App Token down, 401 to every call. */
function handlerFor(scenario: string): FetchHandler {
  return async ({ url }) => {
    if (url.hostname === "cdn.thingiverse.com") {
      const name = url.pathname.split("/").pop()!;
      // Pictures fall through to the stub's own PNG; the PDF isn't a model file, so it's never asked for.
      return name.endsWith(".stl") ? binary(stl(name)) : undefined;
    }
    if (url.hostname !== "api.thingiverse.com") return undefined;
    assertThat(url.searchParams.get("access_token") === TOKEN, "every API call carries the instance's App Token");
    if (scenario === "rejected") return json({ error: "invalid" }, 401);
    switch (url.pathname) {
      case `/things/${THING_ID}`:
        return scenario === "missing" ? json({ error: "not found" }, 404) : json(loadFixture("thingiverse", "thing"));
      case `/things/${THING_ID}/categories`:
        return json(loadFixture("thingiverse", "thing-categories"));
      case `/collections/${COLLECTION_ID}`:
        return scenario === "gone" ? json({ error: "not found" }, 404) : json(loadFixture("thingiverse", "collection"));
      case `/collections/${COLLECTION_ID}/things`:
        return json(loadFixture("thingiverse", "collection-things"));
      default:
        return undefined;
    }
  };
}

const spec: ProviderContractSpec = {
  id: "thingiverse",
  name: "Thingiverse",
  modelUrl: `https://www.thingiverse.com/thing:${THING_ID}`,
  expected: {
    externalId: THING_ID,
    title: "Test Articulated Widget",
    // The separate instructions section comes after the description, under its own heading.
    notesIncludes: "A **test** widget for import verification.\n\n## Instructions\n\n1. Print both parts.",
    author: "TestCreator",
    tags: ["Test fixture", "Widget"],
    category: { name: "Test Models", parent: "3D Printer" },
    // The default image and the render.
    galleryImages: 2,
    // A plate per model file; the PDF isn't one.
    plateInstanceIds: [null, null],
    plateFilenames: ["body.stl", "wheels.stl"],
  },
  // The App Token is the instance's: what an admin saves in Administration > Providers.
  connect: async () => {
    await setThingiverseAccessToken(TOKEN);
  },
  disconnect: async () => {
    await setThingiverseAccessToken(null);
  },
  createHandler: handlerFor,
  reimport: {},
  list: {
    endpoint: "/api/import/thingiverse-collection/entries",
    url: COLLECTION_URL,
    title: "Things to Make",
    importedId: THING_ID,
    freshId: "9990002",
  },
  // Every read takes the App Token, so a sync can't list anything without it.
  listing: {
    sync: {
      externalId: COLLECTION_ID,
      sourceUrl: `https://www.thingiverse.com/Derzinskas/collections/${COLLECTION_ID}`,
    },
    ids: [THING_ID, "9990002"],
    needsSignIn: true,
  },
  skip: {
    missingCredentials:
      "its App Token is the instance's, not the user's: without one an import is a 503 that asks for an admin, with no session code (pinned below)",
    rejectedCredentials:
      "a token Thingiverse turns down is a 400 with no session code, and nothing remembers it: the instance's connection is only connected or disconnected (pinned below)",
  },
};

const ctx = describeProviderContract(spec);

describe("Thingiverse specifics", () => {
  it("answers an import without the instance's App Token with 503 for an admin, asking Thingiverse nothing", async () => {
    const stub = ctx.stub("ok");
    const res = await ctx.importUrl();
    expectStatus(res, 503);
    expect(res.body.code).toBeUndefined();
    expect(res.body.detail).toMatch(/ask an admin to add an App Token/);
    expect(stub.calls).toHaveLength(0);
  });

  it("answers a token Thingiverse turns down with 400 and no session code, importing nothing", async () => {
    await spec.connect(ctx.userId);
    ctx.stub("rejected");
    const res = await ctx.importUrl();
    expectStatus(res, 400);
    expect(res.body.code).toBeUndefined();
    expect(res.body.detail).toMatch(/App Token configured for this instance was rejected/);
    expect(await ctx.prints()).toHaveLength(0);
    // An instance's token has no expired state: the admin's health check is what tells a rejected one.
    expect((await thingiverseConnection.status(ctx.userId)).status).toBe("connected");
  });
});
