import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { prisma } from "../../src/db";
import {
  fetchThreedexportCollection,
  fetchThreedexportTrending,
  resolveThreedexportModel,
  threedexportFilePicks,
  threedexportModelFrom,
  threedexportOwnCollectionsFrom,
  threedexportTilesFrom,
  threedexportVisit,
} from "../../src/providers/threedexport/api";
import { threedexportBrowse } from "../../src/providers/threedexport/browse";
import { threedexportConnection } from "../../src/providers/threedexport/connection";
import {
  getThreedexportConnection,
  normalizeThreedexportSession,
  setUserThreedexportSession,
} from "../../src/providers/threedexport/session";
import { fetchListing } from "../../src/services/collectionSyncRunner";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import {
  binary,
  expectStatus,
  html,
  json,
  loadFixture,
  loadFixtureHtml,
  redirect,
  stl,
  zip,
  type FetchHandler,
  type RecordedCall,
} from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// 3DExport end to end, from its pages: a model's details and, for a signed-in user, its downloads from its page, one
// per format, each redirecting to a signed S3 link to that format's zip; its public and own collections from their
// pages, and its best sellers from the POST its listing pages on with. Its answers are the recorded pages in
// fixtures/providers/threedexport, trimmed to what's read -- three pictures, a collection of four over two pages, three
// best sellers -- with the download links' tokens replaced and the signed-in user renamed. A refused sign-in is
// answered as the site did on 2026-11-10: the visitor's page, with the hash cleared (`nm_hash=deleted`).

const USER_ID = "1000001";
const HASH = "0123456789abcdef0123456789abcdef";
// Another sign-in, saved while a request of Thingport's is out.
const OTHER_HASH = "fedcba9876543210fedcba9876543210";
const SID = "testsession0000000000000001";
const ITEM = "667112";
const MODEL_URL = `https://3dexport.com/3d-model-elephant-a001-${ITEM}`;
const PAID_ITEM = "686532";
// A free model in a single format, whose page has one "Download free" button rather than a list of formats.
const SINGLE_ITEM = "660588";
const SINGLE_URL = `https://3dexport.com/3d-model-towing-tug-benchy-boat-${SINGLE_ITEM}`;
const COLLECTION = "6956";
const COLLECTION_URL = `https://3dexport.com/bookmarks/3d-collection-${COLLECTION}`;
const DEFAULT_URL = "https://3dexport.com/mybookmarks/default";
// One of the user's own: private, so its page shows only to them, and anyone else gets a 404.
const PRIVATE = "6984";
const PRIVATE_URL = `https://3dexport.com/bookmarks/3d-collection-${PRIVATE}`;
const PUBLIC = "6985";
const RING = "645718";
const ME = "makerone";

const fileUrl = (nf: string) =>
  `https://netrinofiles.s3.amazonaws.com/2021/07/22/885693/${ITEM}/3dexport_elephant${nf}_1790393328.zip?` +
  "X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=abc";
// Each format's file in the recorded page, by its number.
const FORMAT_OF: Record<string, string> = {
  "2401620": "step",
  "2401621": "dxf",
  "2401622": "stl",
  "2401623": "svg",
  "2401645": "x_t",
  "2381412": "stl",
};

type State = {
  /** Run before a request whose path matches is answered, such as another sign-in saved meanwhile. */
  before?: { path: RegExp; run: () => Promise<void> };
  /** The model page's downloads, edited: to leave a format out, or add one. */
  page?: (html: string) => string;
};

function handlerFor(scenario: string, state: State = {}): FetchHandler {
  const cookies = (call: RecordedCall) =>
    Object.fromEntries(
      (call.headers.cookie ?? "")
        .split(/;\s*/)
        .filter(Boolean)
        .map((pair) => pair.split("=") as [string, string]),
    );
  const sentHash = (call: RecordedCall) => cookies(call).nm_hash;
  const signedIn = (call: RecordedCall) =>
    scenario !== "rejected" && cookies(call).nm_userid === USER_ID && [HASH, OTHER_HASH].includes(sentHash(call));
  // As the site answers: a session for whoever asked, and a hash it won't take cleared again.
  const answer = (res: Response, call: RecordedCall): Response => {
    if (!cookies(call).sessionid) res.headers.append("set-cookie", `sessionid=${SID}; path=/`);
    if (sentHash(call) && !signedIn(call)) {
      res.headers.append("set-cookie", "nm_hash=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/");
      res.headers.append("set-cookie", "nm_userid=-1; path=/; domain=.3dexport.com");
    }
    return res;
  };
  return async (call) => {
    const { url, method } = call;
    if (state.before?.path.test(url.pathname)) await state.before.run();
    if (url.hostname === "netrinofiles.s3.amazonaws.com") {
      const format = url.pathname.match(/3dexport_elephant(\w+)_/)?.[1] ?? "stl";
      return binary(
        await zip(`3dexport:${format}`, { [`Elephant.${format.toUpperCase()}`]: stl(`elephant-${format}`) }),
      );
    }
    if (url.hostname !== "3dexport.com") return undefined;
    const p = url.pathname;
    const me = signedIn(call);
    if (p === `/3d-model-item-${ITEM}`) return answer(redirect(MODEL_URL, 301), call);
    if (p === `/3d-model-item-${PAID_ITEM}`)
      return answer(redirect(`https://3dexport.com/3d-model-pocket-drift-car-${PAID_ITEM}`, 301), call);
    if (p === `/3d-model-elephant-a001-${ITEM}`) {
      if (scenario === "missing") return answer(html("<h1>404</h1>", 404), call);
      const page = loadFixtureHtml("threedexport", me ? "page" : "page-visitor");
      return answer(html(state.page && me ? state.page(page) : page), call);
    }
    if (p === `/3d-model-pocket-drift-car-${PAID_ITEM}`) {
      return answer(html(loadFixtureHtml("threedexport", me ? "page-paid" : "page-visitor")), call);
    }
    if (p === `/3d-model-item-${SINGLE_ITEM}`) return answer(redirect(SINGLE_URL, 301), call);
    if (p === `/3d-model-towing-tug-benchy-boat-${SINGLE_ITEM}`) {
      return answer(html(loadFixtureHtml("threedexport", me ? "page-single" : "page-visitor")), call);
    }
    if (/^\/3d-model-[\w-]+-\d+$/.test(p)) return answer(html("<h1>404</h1>", 404), call);
    if (p === "/download") {
      // A visitor is sent to the home page.
      if (!me) return answer(redirect("https://3dexport.com/", 301), call);
      return answer(redirect(fileUrl(FORMAT_OF[url.searchParams.get("nf") ?? ""] ?? "stl"), 301), call);
    }
    if (p === "/mybookmarks") {
      return answer(html(loadFixtureHtml("threedexport", me ? "bookmarks" : "signed-out")), call);
    }
    if (p === "/mybookmarks/default") {
      return answer(me ? html(loadFixtureHtml("threedexport", "default")) : html("<h1>404</h1>", 404), call);
    }
    if (/^\/mybookmarks\/\d+$/.test(p)) return answer(html("<h1>404</h1>", 404), call);
    if (p === `/bookmarks/3d-collection-${PRIVATE}`) {
      return answer(me ? html(loadFixtureHtml("threedexport", "collection-private")) : html("<h1>404</h1>", 404), call);
    }
    if (p === `/bookmarks/3d-collection-${PUBLIC}`) {
      return answer(html(loadFixtureHtml("threedexport", "collection")), call);
    }
    if (p === `/bookmarks/3d-collection-${COLLECTION}`) {
      if (scenario === "gone") return answer(html(loadFixtureHtml("threedexport", "collection-missing")), call);
      const second = url.searchParams.get("page") === "2";
      return answer(html(loadFixtureHtml("threedexport", second ? "collection-2" : "collection")), call);
    }
    if (/^\/bookmarks\/3d-collection-\d+$/.test(p)) {
      return answer(html(loadFixtureHtml("threedexport", "collection-missing")), call);
    }
    if (p === "/cart-ajax" && url.searchParams.get("method") === "get") {
      return answer(json({ itemsList: [], itemsCount: 0, itemsTotal: "0.00" }), call);
    }
    if (p === "/3d-print-models" && method === "POST") {
      // Its CSRF check: the session's id, as a header, beside the session cookie.
      const sid = cookies(call).sessionid;
      if (!sid || call.headers["x-csrf-token"] !== sid) return html("", 403);
      return answer(json(loadFixture("threedexport", "trending")), call);
    }
    return undefined;
  };
}

const ACCOUNT = { username: ME };
const connect = (userId: string, hash = HASH) =>
  setUserThreedexportSession(userId, { userId: USER_ID, hash }, { ...ACCOUNT });

const spec: ProviderContractSpec = {
  id: "threedexport",
  name: "3DExport",
  modelUrl: MODEL_URL,
  expected: {
    externalId: ITEM,
    title: "Elephant-A001",
    notesIncludes: "3D Model designed for Laser Cutting, CNC Machining, and 3D Printing.",
    author: "AmaxArt",
    // Its keywords, as the library keeps them: first letter up, the rest down.
    tags: [
      "3d",
      "Animal",
      "Cad",
      "Cnc",
      "Cutting",
      "Decorative",
      "Display",
      "Dxf",
      "Elephant",
      "Engineering",
      "Fabrication",
      "Laser",
      "Machining",
      "Manufacturing",
      "Model",
      "Printing",
      "Step",
      "Stl",
      "Svg",
    ],
    category: { name: "Engineering", parent: "Education" },
    galleryImages: 3,
    // Its STEP and STL formats' zips, one file each; the DXF, SVG and Parasolid ones aren't fetched.
    plateInstanceIds: [null, null],
    plateFilenames: ["Elephant.STEP", "Elephant.STL"],
  },
  connect: (userId) => connect(userId),
  disconnect: async (userId) => {
    await setUserThreedexportSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: {
    sessionCode: "threedexport_session",
    connection: async (userId) => (await getThreedexportConnection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/threedexport/list/entries",
    url: COLLECTION_URL,
    title: "anillos",
    importedId: RING,
    freshId: ITEM,
  },
  // Anyone's public collection is anyone's to read: its models in its order, across both its pages.
  listing: {
    sync: { externalId: COLLECTION, sourceUrl: COLLECTION_URL },
    ids: [RING, ITEM, "633844", "117590"],
    needsSignIn: false,
  },
};

const ctx = describeProviderContract(spec);

const callsTo = (calls: RecordedCall[], path: string | RegExp) =>
  calls.filter((call) => (typeof path === "string" ? call.url.pathname === path : path.test(call.url.pathname)));

describe("3DExport specifics", () => {
  it("answers a model 3DExport doesn't have with 404", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expect((await ctx.importUrl("https://3dexport.com/3d-model-nothing-999999")).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("downloads only the formats a plate takes, each from its signed link, with the sign-in only on the site", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const downloads = callsTo(stub.calls, "/download");
    expect(downloads.map((call) => call.url.searchParams.get("nf"))).toEqual(["2401620", "2401622"]);
    // One session for the whole import: the page started it, and the downloads sent it back.
    expect(downloads.map((call) => call.headers.cookie)).toEqual(
      Array(2).fill(`nm_language=english; nm_userid=${USER_ID}; nm_hash=${HASH}; sessionid=${SID}`),
    );
    const files = stub.calls.filter((call) => call.url.hostname === "netrinofiles.s3.amazonaws.com");
    expect(files).toHaveLength(2);
    expect(files.every((call) => !call.headers.cookie)).toBe(true);
    const [print] = await ctx.prints();
    expect(print.notes).toContain("## Model details");
    expect(print.notes).toContain("**Size:** 237 × 172 × 20 mm");
    // The site's own note on free models' use isn't the author's description.
    expect(print.notes).not.toContain("Usage Information");
  });

  it("falls back to an OBJ only when no format a plate takes is offered", async () => {
    await connect(ctx.userId);
    // The STEP and STL downloads become an OBJ and a GLB.
    const objOnly = (page: string) =>
      page
        .replace("STEP (.step) <b>", "Wavefront OBJ (.obj) <b>")
        .replace("Stereolithography (.stl) <b>", "GL Transmission (.glb) <b>");
    const stub = ctx.install(handlerFor("ok", { page: objOnly }));
    expectStatus(await ctx.importUrl(), 200);
    expect(callsTo(stub.calls, "/download").map((call) => call.url.searchParams.get("nf"))).toEqual([
      "2401620",
      "2401622",
    ]);
  });

  it("imports nothing of a model with no format a slicer opens", async () => {
    await connect(ctx.userId);
    const none = (page: string) => page.replace(/STEP \(\.step\)|Stereolithography \(\.stl\)/g, "Autodesk FBX (.fbx)");
    const stub = ctx.install(handlerFor("ok", { page: none }));
    const res = await ctx.importUrl();
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/no files Thingport can import/);
    expect(callsTo(stub.calls, "/download")).toEqual([]);
  });

  it("imports a model in a single format, from its plain Download button", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(SINGLE_URL), 200);
    expect(callsTo(stub.calls, "/download").map((call) => call.url.searchParams.get("nf"))).toEqual(["2381412"]);
    const [print] = await ctx.prints();
    expect(print.title).toBe("Towing Tug Benchy Boat");
  });

  it("refuses a paid model the user hasn't bought, without asking for anything", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    const res = await ctx.importUrl(`https://3dexport.com/3d-model-pocket-drift-car-${PAID_ITEM}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/paid 3DExport model \(\$5\.00\)/);
    expect(callsTo(stub.calls, "/download")).toEqual([]);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("finds a model by its number under any name, as the site redirects it", async () => {
    ctx.stub("ok");
    const model = await resolveThreedexportModel(ITEM);
    expect(model?.meta.title).toBe("Elephant-A001");
    // Read as a visitor: no downloads, and nothing said about the sign-in.
    expect(model?.files).toEqual([]);
    expect(model?.signedIn).toBe(false);
  });

  it("marks only the sign-in that was turned down, and not one saved meanwhile", async () => {
    await connect(ctx.userId);
    ctx.stub("rejected");
    expect((await ctx.importUrl()).status).toBe(400);
    expect((await getThreedexportConnection(ctx.userId)).state).toBe("expired");

    // Grab saves a new sign-in while the import is out: the refusal of the old one doesn't mark the new one.
    await connect(ctx.userId);
    // Its first page refuses it already: the redirect from the model's number to its own address.
    const replace = { path: /^\/3d-model-/, run: () => connect(ctx.userId, OTHER_HASH).then(() => undefined) };
    ctx.install(handlerFor("rejected", { before: replace }));
    const res = await ctx.importUrl();
    expect(res.status).toBe(409);
    expect((await getThreedexportConnection(ctx.userId)).state).toBe("connected");
  });

  it("reads the sign-in from a Cookie header, and nothing from a visitor's", () => {
    expect(
      normalizeThreedexportSession(
        `sessionid=abc; nm_referral_seen=1; nm_hash=${HASH.toUpperCase()}; nm_lastvisit=1; nm_userid=${USER_ID}`,
      ),
    ).toEqual({ userId: USER_ID, hash: HASH });
    expect(normalizeThreedexportSession(`cookie: nm_userid=${USER_ID}; nm_hash=${HASH}`)).toEqual({
      userId: USER_ID,
      hash: HASH,
    });
    expect(normalizeThreedexportSession("sessionid=abc; nm_userid=-1")).toBeNull();
    expect(normalizeThreedexportSession(`nm_userid=${USER_ID}; sessionid=abc`)).toBeNull();
    expect(normalizeThreedexportSession(`nm_hash=${HASH}`)).toBeNull();
  });

  it("checks a pasted sign-in, keeping who it is, and turns down one 3DExport refuses", async () => {
    ctx.stub("ok");
    const cookie = `nm_userid=${USER_ID}; nm_hash=${HASH}`;
    expect(await threedexportConnection.save(ctx.userId, { session: cookie, verify: true })).toEqual({
      configured: true,
    });
    expect((await getThreedexportConnection(ctx.userId)).account).toEqual({ username: ME });

    ctx.stub("rejected");
    await expect(threedexportConnection.save(ctx.userId, { session: cookie, verify: true })).rejects.toMatchObject({
      status: 422,
    });
    await expect(
      threedexportConnection.save(ctx.userId, { session: "nm_userid=-1", verify: true }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("lists its best sellers from the POST its listing pages on with, under the session it started", async () => {
    const stub = ctx.stub("ok");
    const models = await fetchThreedexportTrending(10);
    expect(models).toHaveLength(3);
    expect(models[0]).toMatchObject({ id: "464420", url: "https://3dexport.com/3d-model-item-464420", paid: true });
    expect(models.every((model) => !/3D (Print )?Model$/.test(model.title))).toBe(true);
    const [post] = callsTo(stub.calls, "/3d-print-models");
    expect(post.method).toBe("POST");
    expect(post.url.searchParams.get("order_by")).toBe("bestsales");
    expect(new URLSearchParams(post.body ?? "").get("sessionid")).toBe(SID);
  });

  it("reads a public collection over its pages, and takes an empty Default Collection for one that's gone", async () => {
    ctx.stub("ok");
    const found = await fetchThreedexportCollection(COLLECTION, threedexportVisit());
    expect(found).toMatchObject({ title: "anillos", total: 4, truncated: false });
    expect(found?.entries.map((entry) => entry.itemId)).toEqual([RING, ITEM, "633844", "117590"]);
    expect(found?.entries[1]).toMatchObject({ title: "Elephant-A001", price: 0, author: "AmaxArt" });
    expect(await fetchThreedexportCollection("99999999", threedexportVisit())).toBeNull();
  });

  it("won't pass a collection longer than it reads off as whole to a sync, nor stop a list import at it", async () => {
    // A collection whose count runs on, with a new model on every page it's asked for.
    const endless: FetchHandler = async (call) => {
      if (call.url.hostname !== "3dexport.com" || call.url.pathname !== "/bookmarks/3d-collection-7777")
        return undefined;
      const at = call.url.searchParams.get("page") ?? "1";
      const page = loadFixtureHtml("threedexport", "collection-2")
        .replaceAll("117590", String(800000 + Number(at)))
        .replace("4 item(s)", "500000 item(s)");
      return html(page);
    };
    ctx.install(endless);
    await expect(fetchThreedexportCollection("7777", threedexportVisit(), Number.POSITIVE_INFINITY)).rejects.toThrow(
      /runs past the 20000 models/,
    );
    const listed = await fetchThreedexportCollection("7777", threedexportVisit());
    expect(listed).toMatchObject({ total: 500000, truncated: true });
    expect(listed?.entries).toHaveLength(200);

    // One whose count takes in models gone from the site ends on a page with nothing new, read whole all the same.
    const overcounted: FetchHandler = async (call) => {
      const res = await handlerFor("ok")(call);
      if (!res || call.url.pathname !== `/bookmarks/3d-collection-${COLLECTION}`) return res;
      return html((await res.text()).replace("4 item(s)", "5 item(s)"));
    };
    ctx.install(overcounted);
    const whole = await fetchThreedexportCollection(COLLECTION, threedexportVisit(), Number.POSITIVE_INFINITY);
    expect(whole?.entries.map((entry) => entry.itemId)).toEqual([RING, ITEM, "633844", "117590"]);
  });

  it("syncs the user's Default Collection with their sign-in, and holds rather than unsyncs when it's refused", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const sync = { provider: "threedexport", userId: ctx.userId, externalId: "default", sourceUrl: DEFAULT_URL };
    expect(await fetchListing(sync as never)).toEqual([ITEM]);
    ctx.stub("rejected");
    await expect(fetchListing(sync as never)).rejects.toThrow(/didn't accept your sign-in/);
    expect((await getThreedexportConnection(ctx.userId)).state).toBe("expired");
  });

  it("offers the user's own collections in the Browse tab, private ones too, with their pictures", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const cards = await threedexportBrowse.cards(ctx.userId);
    expect(
      cards.map(({ id, name, url, modelCount, private: hidden, owner }) => [id, name, url, modelCount, hidden, owner]),
    ).toEqual([
      ["default", "3DExport Default Collection", DEFAULT_URL, 1, true, ME],
      [PRIVATE, "Thingport test private", PRIVATE_URL, 1, true, ME],
      [PUBLIC, "Thingport test public", `https://3dexport.com/bookmarks/3d-collection-${PUBLIC}`, 4, false, ME],
    ]);
    expect(cards[0].thumbnails).toHaveLength(1);

    // By its link: public when anyone can see it, and private when only the user's sign-in does.
    expect(
      await threedexportBrowse.card(ctx.userId, { provider: "threedexport", externalId: PRIVATE, url: PRIVATE_URL }),
    ).toMatchObject({
      private: true,
      owner: ME,
      modelCount: 1,
    });
    expect(
      await threedexportBrowse.card(ctx.userId, {
        provider: "threedexport",
        externalId: COLLECTION,
        url: COLLECTION_URL,
      }),
    ).toMatchObject({
      private: false,
      owner: null,
      modelCount: 4,
    });
  });

  it("imports the user's private collection with their sign-in, which nobody else's shows", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const list = await ctx.post(spec.list!.endpoint, { url: PRIVATE_URL });
    expectStatus(list, 200);
    expect(list.body.title).toBe("Thingport test private");
    await setUserThreedexportSession(ctx.userId, null);
    expect((await ctx.post(spec.list!.endpoint, { url: PRIVATE_URL })).status).toBe(404);
  });

  it("holds a private collection's sync when the sign-in is refused, rather than taking it for gone", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const sync = { provider: "threedexport", userId: ctx.userId, externalId: PRIVATE, sourceUrl: PRIVATE_URL };
    expect(await fetchListing(sync as never)).toEqual([ITEM]);
    ctx.stub("rejected");
    await expect(fetchListing(sync as never)).rejects.toThrow(/didn't accept your sign-in/);
    expect((await getThreedexportConnection(ctx.userId)).state).toBe("expired");
  });
});

describe("3DExport pages", () => {
  it("reads a model's page: its details, its downloads and whose page it was", () => {
    const model = threedexportModelFrom(loadFixtureHtml("threedexport", "page"))!;
    expect(model).toMatchObject({ itemId: ITEM, price: 0, signedIn: true });
    expect(model.meta.siteCategoryIds).toEqual(["science/engineering", "science"]);
    expect(model.meta.license).toEqual({ id: "3dexport-royalty-free-no-ai", raw: "royalty-free, no AI training" });
    expect(model.meta.author).toMatchObject({ externalId: "amaxart", handle: "amaxart", name: "AmaxArt" });
    expect(model.galleryImages.map((image) => image.filename)).toEqual([
      "elephanta001_6933325.webp",
      "elephanta001_6933326.webp",
      "elephanta001_6933327.webp",
    ]);
    expect(model.files.map((file) => [file.label, file.ext])).toEqual([
      ["STEP (.step)", "step"],
      ["Autodesk ArchiCAD (.dxf)", "dxf"],
      ["Stereolithography (.stl)", "stl"],
      ["Image Textures (.svg)", "svg"],
      ["Parasolid (.x_t)", "x_t"],
    ]);
    const { first, fallback } = threedexportFilePicks(model.files);
    expect(first.map((file) => file.ext)).toEqual(["step", "stl"]);
    expect(fallback).toEqual([]);
  });

  it("takes only the site's own download links, never ones its author put in the description", () => {
    const own = threedexportModelFrom(loadFixtureHtml("threedexport", "page"))!.files;
    const planted = loadFixtureHtml("threedexport", "page")
      .replace(
        'itemprop="description">',
        'itemprop="description"><a href="https://3dexport.com/download?link=abc&id=1&nf=9&t=x">Mine (.stl)</a>' +
          '<a href="https://example.com/x/download?link=1">Theirs (.stl)</a>',
      )
      .replace(
        '<ul class="dropdown-menu',
        '<a href="https://example.com/download?link=2">Elsewhere (.3mf)</a><ul class="dropdown-menu',
      );
    expect(threedexportModelFrom(planted)!.files).toEqual(own);
  });

  it("takes a single-format model's format from the page's panel, as its button names none", () => {
    const model = threedexportModelFrom(loadFixtureHtml("threedexport", "page-single"))!;
    expect(model.files.map((file) => [file.label, file.ext])).toEqual([["Stereolithography (.stl)", "stl"]]);
    expect(threedexportFilePicks(model.files).first).toHaveLength(1);
    // Without a panel to say, the download is tried only once nothing else brought a model.
    const unsaid = threedexportModelFrom(
      loadFixtureHtml("threedexport", "page-single").replace(/<ul class="list-group details-panel">[\s\S]*?<\/ul>/, ""),
    )!;
    expect(unsaid.files.map((file) => file.ext)).toEqual([null]);
    expect(threedexportFilePicks(unsaid.files)).toMatchObject({ first: [], fallback: [{ ext: null }] });
  });

  it("reads a paid model's page as Basic, with no downloads", () => {
    const model = threedexportModelFrom(loadFixtureHtml("threedexport", "page-paid"))!;
    expect(model).toMatchObject({ itemId: PAID_ITEM, price: 5, files: [] });
    expect(model.meta.license).toEqual({ id: "3dexport-basic-no-ai", raw: "basic, no AI training" });
    expect(model.meta.siteCategoryIds).toEqual(["games-and-toys/toys", "games-and-toys"]);
  });

  it("reads a grid's tiles without the kind of model their names end in", () => {
    const tiles = threedexportTilesFrom(loadFixtureHtml("threedexport", "collection"));
    expect(tiles.map((tile) => tile.title)).toEqual([
      "Classic Solitaire Diamond Ring 3D Printable Jewelry CAD Model STL 3DM Sizes 1619",
      "Elephant-A001",
      "4mm Half Band Wedding Ring",
    ]);
  });

  it("reads the user's own collections from their bookmarks page", () => {
    expect(threedexportOwnCollectionsFrom(loadFixtureHtml("threedexport", "bookmarks"))).toEqual([
      { key: "default", url: DEFAULT_URL, name: "Default Collection", count: 0, private: true },
      { key: PRIVATE, url: PRIVATE_URL, name: "Thingport test private", count: 1, private: true },
      {
        key: PUBLIC,
        url: `https://3dexport.com/bookmarks/3d-collection-${PUBLIC}`,
        name: "Thingport test public",
        count: 1,
        private: false,
      },
    ]);
  });

  it("keeps a page's user signed out when it's a visitor's", () => {
    expect(threedexportModelFrom(loadFixtureHtml("threedexport", "page-visitor"))?.signedIn).toBe(false);
  });
});

describe("3DExport sign-outs from Grab", () => {
  const app = createApp();

  it("clears the sign-in Grab sent, but not one pasted in Thingport since", async () => {
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Grab sign-out", email: `3dx-signout-${Date.now()}@example.com`, password: "password123" });
    const userId: string = res.body.user.id;
    const auth = { Authorization: `Bearer ${res.body.token}` };
    const patch = (body: Record<string, unknown>) =>
      request(app).patch("/api/providers/threedexport/connection").set(auth).send(body);
    const sent = `nm_userid=${USER_ID}; nm_hash=${HASH}`;
    try {
      ctx.stub("ok");
      await connect(userId);
      expect((await patch({ session: null, signed_out_of: sent })).body).toEqual({ configured: false });
      const cleared = await getThreedexportConnection(userId);
      // Who it was stays, as on any disconnect.
      expect(cleared).toEqual({ state: "disconnected", account: { username: ME } });

      // Another sign-in pasted since isn't the one Grab saw signed out.
      await connect(userId, OTHER_HASH);
      expect((await patch({ session: null, signed_out_of: sent })).body).toEqual({ configured: true });
      const kept = await prisma.providerConnection.findFirstOrThrow({ where: { userId, provider: "threedexport" } });
      expect(kept.secret).toEqual({ userId: USER_ID, hash: OTHER_HASH });

      // Disconnecting in Thingport clears whatever is there.
      expect((await patch({ session: null })).body).toEqual({ configured: false });
    } finally {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });
});
