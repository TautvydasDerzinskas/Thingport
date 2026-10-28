import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { makerablesBrowse } from "../../src/providers/makerables/browse";
import { makerablesConnection } from "../../src/providers/makerables/connection";
import {
  getMakerablesConnection,
  normalizeMakerablesSession,
  setUserMakerablesSession,
} from "../../src/providers/makerables/session";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { SyncHeldError } from "../../src/providers/syncProblem";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import { assertThat, binary, expectStatus, html, json, loadFixture, stl, zip, type FetchHandler } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// Makerables end to end, through the REST API its own pages call: a project, its file tabs and the popular listing are
// anyone's to read, and its files sit on its CDN unsigned, so nothing about an import needs a sign-in. Only the saved
// projects do, and only the owner's own: the session cookie mints the bearer token the call takes. Its answers are the
// recorded shapes in fixtures/providers/makerables, the signed-in account renamed.

const SESSION = `__session__0=eyJlbmMiOiJBMjU2R0NNIn0..${"Ab1-_x".repeat(12)}; __session__1=${"Cd2-_y".repeat(12)}`;
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJtYWtlci1vbmUifQ.c2lnbmF0dXJl";
const ACCOUNT = { userId: "G1234567890", name: "maker-one" };
const PROJECT_ID = "5dc045a5-9c17-4ffc-a719-2c50025f4078";
const MODEL_URL = "https://www.makerables.com/project/acrylic-knife";
const SAVED_URL = `https://www.makerables.com/user/${ACCOUNT.userId}?tab=saved`;
const PLATES = ["Acrylic knife (accessory).stp", "Acrylic knife1.1.stp", "Acrylic knife1.stp", "Acrylic knife2.stp"];

/** A STEP file's bytes: plain ISO-10303-21 text, which is what its Model Files mostly are. */
const step = (seed: string): Buffer =>
  Buffer.from(
    `ISO-10303-21;\nHEADER;\nFILE_NAME('${seed}','2026-01-01T00:00:00',(''),(''),'','','');\nENDSEC;\n` +
      `DATA;\n#1=CARTESIAN_POINT('',(0.,0.,0.));\nENDSEC;\nEND-ISO-10303-21;\n`,
    "utf8",
  );

const signedIn = (headers: Record<string, string | undefined>) => headers.authorization === `Bearer ${TOKEN}`;

/** `files`: which Model Files fixture the project's tab answers with. */
function handlerFor(scenario: string, files = "model-files"): FetchHandler {
  return async ({ url, headers }) => {
    if (url.hostname === "cdn.makerables.com") {
      // Its CDN stores a file under the type the browser reported, so a zip's link ends in x-zip-compressed.
      const name = url.pathname.split("/").pop()!;
      if (name.endsWith(".x-zip-compressed")) {
        return binary(await zip(name, { [`${name.split("-mv")[0]}.step`]: step(name) }));
      }
      if (name.endsWith(".stl")) return binary(stl(name));
      if (/\.ste?p$/.test(name)) return binary(step(name));
      // Its pictures fall through to the stub's own PNG.
      return undefined;
    }
    if (url.hostname !== "www.makerables.com") return undefined;
    const path = url.pathname;
    // The site's own call for the bearer token its API takes, which its session cookie stands behind.
    if (path === "/auth/access-token") {
      if (!headers.cookie?.includes("__session__0=") || scenario === "rejected") {
        return json(loadFixture("makerables", "access-token-missing"), 401);
      }
      return json(loadFixture("makerables", "access-token"));
    }
    if (path === "/api/projects") {
      const named = url.searchParams.get("slug") ?? url.searchParams.get("id");
      const known = named === "acrylic-knife" || named === PROJECT_ID;
      if (!known || scenario === "missing") return json(loadFixture("makerables", "project-missing"), 404);
      return json(loadFixture("makerables", "project"));
    }
    if (path === "/api/projects/original-files") {
      assertThat(url.searchParams.get("project_id") === PROJECT_ID, "a project's files are asked for by its id");
      return json(loadFixture("makerables", files));
    }
    if (path === "/api/projects/query") return json(loadFixture("makerables", "popular"));
    if (path === "/api/users/me") {
      if (!signedIn(headers)) return json({ code: 401, success: false, message: "Authentication required" }, 401);
      return json(loadFixture("makerables", "me"));
    }
    if (path === "/api/users/favorites") {
      if (!signedIn(headers)) return json({ code: 401, success: false, message: "Authentication required" }, 401);
      if (url.searchParams.get("id") !== ACCOUNT.userId) {
        return json({ code: 403, success: false, message: "You are not authorized to get this user's favorites" }, 403);
      }
      return json(loadFixture("makerables", "saved"));
    }
    return undefined;
  };
}

const connect = (userId: string) => setUserMakerablesSession(userId, SESSION, { ...ACCOUNT });

const spec: ProviderContractSpec = {
  id: "makerables",
  name: "Makerables",
  modelUrl: MODEL_URL,
  expected: {
    externalId: "acrylic-knife",
    title: "Acrylic knife",
    notesIncludes: "3-axis CNC machining",
    author: "Makerables",
    tags: ["Finishing required", "Multi-part assembly", "Simple design"],
    // Its own subcategory, which beats the parent the site lists first.
    category: { name: "Gadgets", parent: "Tools" },
    galleryImages: 6,
    plateInstanceIds: [null, null, null, null],
    plateFilenames: PLATES,
  },
  connect,
  disconnect: async (userId) => {
    await setUserMakerablesSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  reimport: {},
  list: {
    endpoint: "/api/import/makerables/list/entries",
    url: SAVED_URL,
    title: "Makerables saved projects",
    importedId: "wild-spirit-3d-relief",
    freshId: "top-clamp-3d-feature",
  },
  // The saved projects are the user's own, read with their sign-in, and never gone.
  listing: {
    sync: { externalId: `saved-${ACCOUNT.userId}`, sourceUrl: SAVED_URL },
    ids: ["wild-spirit-3d-relief", "top-clamp-3d-feature"],
    needsSignIn: true,
    neverGone: true,
  },
  skip: {
    // Nothing an import does needs a sign-in: its files are open to anyone with the link.
    missingCredentials: "Makerables imports without a sign-in; only its saved projects need one",
    rejectedCredentials: "Makerables imports without a sign-in; only its saved projects need one",
  },
};

const ctx = describeProviderContract(spec);

describe("Makerables specifics", () => {
  it("imports without a sign-in, asking nothing of the account", async () => {
    await spec.disconnect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    expect(await ctx.prints()).toHaveLength(1);
    expect(stub.calls.filter((call) => call.url.pathname.startsWith("/auth/"))).toHaveLength(0);
  });

  it("answers a project Makerables doesn't have with 404", async () => {
    ctx.stub("ok");
    expect((await ctx.importUrl("https://www.makerables.com/project/nothing-here")).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("keeps a project named by its id under the slug its page gives as canonical", async () => {
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(`https://www.makerables.com/project/${PROJECT_ID}`), 200);
    const [print] = await ctx.prints();
    expect(print.sourceExternalId).toBe("acrylic-knife");
    // Asked for by the id the link named, which is what the API resolves it by.
    expect(stub.calls.some((call) => call.url.searchParams.get("id") === PROJECT_ID)).toBe(true);
  });

  it("brings the Model Files tab, and only what a plate takes", async () => {
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename)).toEqual(PLATES);
    // The NC and CAM tabs hold machine files no slicer reads, so they're never asked for.
    const tabs = stub.calls.map((call) => call.url.pathname).filter((path) => path.startsWith("/api/projects/"));
    expect(tabs).toEqual(["/api/projects/original-files"]);
  });

  it("unpacks a Model Files zip into the files inside it", async () => {
    ctx.install(handlerFor("ok", "model-files-zip"));
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename)).toEqual([
      "Fixture_Plate_-_Final_STEP_FILE.step",
      "Vise_Components_-_Final_STEP_FILE.step",
    ]);
  });

  it("says so when the Model Files tab holds nothing a plate takes", async () => {
    ctx.install(handlerFor("ok", "model-files-pictures"));
    const res = await ctx.importUrl();
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain("no model files");
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("keeps the post-processing notes beside the description", async () => {
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    expect(print.notes).toContain("## Post-processing");
    expect(print.notes).toContain("acrylic polishing liquid");
  });

  it("lists the user's saved projects, and turns down someone else's", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const res = await ctx.post(spec.list!.endpoint, { url: SAVED_URL });
    expectStatus(res, 200);
    expect(res.body.title).toBe("Makerables saved projects");
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual(spec.listing!.ids);
    expect(res.body.total).toBe(2);

    const someoneElse = await ctx.post(spec.list!.endpoint, {
      url: "https://www.makerables.com/user/G9999999999?tab=saved",
    });
    expect(someoneElse.status).toBe(400);
    expect(someoneElse.body.detail).toContain("owner only");
  });

  it("asks for a sign-in to read the saved projects, and remembers one Makerables turns down", async () => {
    await setUserMakerablesSession(ctx.userId, null);
    ctx.stub("ok");
    const signedOut = await ctx.post(spec.list!.endpoint, { url: SAVED_URL });
    expect(signedOut.status).toBe(400);
    expect(signedOut.body.code).toBe("makerables_session");

    await connect(ctx.userId);
    ctx.stub("rejected");
    const rejected = await ctx.post(spec.list!.endpoint, { url: SAVED_URL });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("makerables_session");
    expect((await getMakerablesConnection(ctx.userId)).state).toBe("expired");
  });

  it("leaves the sign-in alone when Makerables can't mint a token, rather than marking it expired", async () => {
    await connect(ctx.userId);
    ctx.install(async (call) => {
      // The site being unwell says nothing about the cookie: an outage must not sign every user out.
      if (call.url.pathname === "/auth/access-token") return html("<title>502 Bad Gateway</title>", 502);
      return handlerFor("ok")(call);
    });
    const res = await ctx.post(spec.list!.endpoint, { url: SAVED_URL });
    expect(res.status).not.toBe(400);
    expect(res.body.code).not.toBe("makerables_session");
    expect((await getMakerablesConnection(ctx.userId)).state).toBe("connected");
  });

  it("asks Makerables whose a cookie is when it was stored without a check", async () => {
    // What Grab's send leaves behind, and what a save made while the site was unwell leaves behind.
    await setUserMakerablesSession(ctx.userId, SESSION, null);
    expect((await getMakerablesConnection(ctx.userId)).account).toBeNull();
    const stub = ctx.stub("ok");
    expectStatus(await ctx.post(spec.list!.endpoint, { url: SAVED_URL }), 200);
    // Asked once and kept, so the connection knows whose it is from then on.
    expect((await getMakerablesConnection(ctx.userId)).account).toEqual(ACCOUNT);
    expect(stub.calls.filter((call) => call.url.pathname === "/api/users/me")).toHaveLength(1);
  });

  it("shows the saved projects in the Browse tab, and asks for a sign-in without one", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const cards = await makerablesBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.private])).toEqual([
      [`saved-${ACCOUNT.userId}`, "Makerables saved projects", 2, true],
    ]);
    expect(cards[0].url).toBe(SAVED_URL);

    await setUserMakerablesSession(ctx.userId, null);
    await expect(makerablesBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("holds a sync of another Makerables account's saved projects rather than unsyncing it", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const sync = {
      userId: ctx.userId,
      provider: "makerables",
      externalId: "saved-G9999999999",
      sourceUrl: "https://www.makerables.com/user/G9999999999?tab=saved",
    };
    // Null would read as "the collection is gone" and take it away; connecting that account again is all it needs.
    await expect(fetchListing(sync)).rejects.toBeInstanceOf(SyncHeldError);
  });

  it("keeps a pasted Cookie header with who it is, and turns one Makerables doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    const pasted = `cookie\nNEXT_LOCALE=en; ${SESSION}`;
    expect(await makerablesConnection.save(ctx.userId, { session: pasted, verify: true })).toEqual({
      configured: true,
    });
    expect(await getMakerablesConnection(ctx.userId)).toEqual({ state: "connected", account: ACCOUNT });
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "makerables" },
    });
    expect(row.secret).toEqual({ cookie: SESSION });

    ctx.stub("rejected");
    await expect(makerablesConnection.save(ctx.userId, { session: SESSION, verify: true })).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      makerablesConnection.save(ctx.userId, { session: "not a cookie", verify: true }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("keeps a session cookie Makerables hands back in place of the one it was given", async () => {
    await connect(ctx.userId);
    const renewed = `__session__0=${"Ef3-_z".repeat(12)}`;
    ctx.install(async (call) => {
      if (call.url.pathname === "/auth/access-token") {
        const headers = new Headers({ "content-type": "application/json" });
        headers.append("set-cookie", `${renewed}; Path=/; HttpOnly`);
        // The chunk it no longer needs, cleared.
        headers.append("set-cookie", "__session__1=; Path=/; Max-Age=0");
        return new Response(JSON.stringify(loadFixture("makerables", "access-token")), { headers });
      }
      return handlerFor("ok")(call);
    });
    expectStatus(await ctx.post(spec.list!.endpoint, { url: SAVED_URL }), 200);
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "makerables" },
    });
    // The chunk it cleared is gone, so the next call doesn't send one the site has forgotten.
    expect(row.secret).toEqual({ cookie: renewed });
  });
});

describe("Makerables sign-in", () => {
  it("picks its session chunks out of a Cookie header, in the order they're numbered", () => {
    const jumbled = `NEXT_LOCALE=en; __session__1=${"Cd2-_y".repeat(12)}; tz=x; __session__0=eyJlbmMiOiJBMjU2R0NNIn0..${"Ab1-_x".repeat(12)}`;
    expect(normalizeMakerablesSession(jumbled)).toBe(SESSION);
  });

  it("takes an unsplit __session cookie as it is", () => {
    const whole = `__session=${"Gh4-_w".repeat(12)}`;
    expect(normalizeMakerablesSession(`NEXT_LOCALE=en; ${whole}`)).toBe(whole);
  });

  it("reads request headers pasted from DevTools, and takes nothing from a page without a sign-in", () => {
    const lines = `:authority\nwww.makerables.com\ncookie\nNEXT_LOCALE=en; ${SESSION}\nuser-agent\nMozilla/5.0`;
    expect(normalizeMakerablesSession(lines)).toBe(SESSION);
    expect(normalizeMakerablesSession("NEXT_LOCALE=en; tz=Europe/Vilnius")).toBeNull();
    expect(normalizeMakerablesSession("")).toBeNull();
    expect(normalizeMakerablesSession(null)).toBeNull();
  });
});
