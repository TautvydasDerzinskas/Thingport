import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { cgtraderModelFromPage, cgtraderProductFromScript } from "../../src/providers/cgtrader/api";
import { cgtraderBrowse } from "../../src/providers/cgtrader/browse";
import { cgtraderConnection } from "../../src/providers/cgtrader/connection";
import { cgtraderFilePicks, cgtraderTrending } from "../../src/providers/cgtrader";
import {
  getCgtraderConnection,
  normalizeCgtraderSession,
  setUserCgtraderSession,
} from "../../src/providers/cgtrader/session";
import { forgetCgtraderWafToken } from "../../src/providers/cgtrader/waf";
import { setFlaresolverrUrl } from "../../src/services/settingsService";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import {
  assertThat,
  binary,
  expectStatus,
  html,
  json,
  loadFixture,
  loadFixtureHtml,
  redirect,
  stl,
  text,
  zip,
  type FetchHandler,
} from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// CGTrader end to end, from what its pages read: a model's product script (its number, its title, its designer, and
// whether the user bought it), its page's React props, its download page's list of files, and the JSON its listings
// answer. A model's details are anyone's to read; its files and the user's liked models and wishlist need their
// sign-in, and its downloads AWS's bot check's token besides. Its answers are the recorded shapes in
// fixtures/providers/cgtrader, trimmed -- three of the model's pictures, four of its tags -- and the signed-in
// account renamed. The liked models' second row and page are the wishlist's models in the recorded row's shape.

const SESSION = "d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f";
const GRAB_TOKEN = "a1b2c3d4-0000-4000-8000-000000000001:CgoAsRFqJR5mBgAA:c2lnbmVkLWJ5LXRoZS1icm93c2Vy";
const MINTED = "a1b2c3d4-0000-4000-8000-000000000002:CgoAsRFqJR5mBgAA:c2lnbmVkLWJ5LWZsYXJlc29sdmVycg";
const SLUG = "lotus-ring-with-opening-and-closing-mechanism";
const MODEL_URL = `https://www.cgtrader.com/3d-print-models/jewelry/ring/${SLUG}`;
const MODEL_PATH = `/free-3d-print-models/jewelry/ring/${SLUG}`;
const LIKES_URL = "https://www.cgtrader.com/profile/liked_models";
const WISHLIST_URL = "https://www.cgtrader.com/profile/wish-lists";
const FILE_HOST = "secure-files.cgtrader.com";
const FLARESOLVERR = "http://flaresolverr.test:8191/v1";
const BEAM = "beam-truss-cross-and-t-junction-134-0f818ddf-0a0c-468d-a623-fbdffb4ea0ef";
const DRAGON = "dark-dragon-on-rock-diorama-printable-figure-stl-model-sculpt-3d";
const JEWEL = "jewelry-cad-lmd-26100001";

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "providers", "cgtrader", name), "utf8");
const script = (body: string) => text(body, 200, { "content-type": "text/javascript; charset=utf-8" });
const challenge = () => new Response(null, { status: 202, headers: { "x-amzn-waf-action": "challenge" } });
const notFound = () => redirect("https://www.cgtrader.com/not_found", 301);

/** The model as CGTrader would sell it: its product script with a price, which the user hasn't paid. */
const paid = (body: string) => body.replace(/"price":0\.0/g, '"price":5.0');

/** The download page listing other files than the recorded one's. */
function downloadPageWith(files: string[]): string {
  const page = loadFixtureHtml("cgtrader", "download-page");
  // Quoted either way: the site's own pages escape the JSON in double quotes, Prettier keeps it raw in single ones.
  const [attribute, , props] = page.match(/data-react-props=(["'])([\s\S]*?)\1/)!;
  const data = JSON.parse(
    props
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&"),
  );
  data.topSection.itemFiles = files.map((name, index) => ({
    itemId: 6890774,
    fileId: 100 + index,
    name,
    fileSize: "1 MB",
    url: `/items/6890774/free-downloads/${100 + index}`,
  }));
  const encoded = JSON.stringify(data).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return page.replace(attribute, `data-react-props="${encoded}"`);
}

type Variant = { files?: string[]; product?: (body: string) => string; zips?: Record<string, Record<string, Buffer>> };

function handlerFor(scenario: string, variant: Variant = {}): FetchHandler {
  return async ({ url, headers, method, json: sent }) => {
    const cookie = headers.cookie ?? "";
    const signedIn = cookie.includes(`_cgtrader_session_id=${SESSION}`) && scenario !== "rejected";
    const token = [GRAB_TOKEN, MINTED].some((value) => cookie.includes(`aws-waf-token=${value}`));
    if (url.href === FLARESOLVERR && method === "POST") {
      assertThat(sent?.waitInSeconds > 0, "FlareSolverr is asked to wait for the challenge's script");
      return json({ status: "ok", solution: { cookies: [{ name: "aws-waf-token", value: MINTED }] } });
    }
    if (url.hostname === FILE_HOST) {
      const name = decodeURIComponent(url.pathname).split("/").pop()!;
      const zipped = variant.zips?.[name];
      if (zipped) return binary(await zip(`cgtrader:${name}`, zipped));
      return binary(/\.obj$/i.test(name) ? Buffer.from("v 0 0 0\nv 10 0 0\nv 0 10 0\nf 1 2 3\n") : stl(name));
    }
    if (url.hostname !== "www.cgtrader.com") return undefined;
    const p = url.pathname;
    if (p === `/products/${SLUG}.js` || p === "/products/6890774.js") {
      if (scenario === "missing") return new Response(null, { status: 404 });
      const body = fixture(signedIn ? "product.txt" : "product-signed-out.txt");
      return script(variant.product ? variant.product(body) : body);
    }
    if (p.endsWith(".js") && p.startsWith("/products/")) return new Response(null, { status: 404 });
    if (p === `/products/${SLUG}` || p === "/products/6890774")
      return redirect(`https://www.cgtrader.com${MODEL_PATH}`, 301);
    if (p.startsWith("/products/")) return notFound();
    if (p === MODEL_PATH) return html(loadFixtureHtml("cgtrader", "model-page"));
    if (p === "/items/6890774/download-page") {
      return html(variant.files ? downloadPageWith(variant.files) : loadFixtureHtml("cgtrader", "download-page"));
    }
    if (p === "/items/6890774/can-download-item-files") {
      if (!signedIn) return json({ error: "You need to sign in" }, 401);
      if (scenario === "limit") return json({ reason: "free_limit", reset_date: "2026-11-01", limit: 10 }, 403);
      return new Response(null, { status: 200 });
    }
    const file = p.match(/^\/items\/6890774\/free-downloads\/(\d+)$/);
    if (file) {
      // The bot check stands before the site: a request without a token never reaches the sign-in.
      if (!token) return challenge();
      if (!signedIn) return html("<title>The change you requested was unauthorized (401)</title>", 401);
      const name = variant.files?.[Number(file[1]) - 100] ?? "stl.stl";
      return redirect(
        `https://${FILE_HOST}/uploads%2Ffiles%2F6890774%2F${encodeURIComponent(name)}?Expires=1793296908&Signature=c2ln&Key-Pair-Id=K30`,
      );
    }
    if (p === "/profile/liked_models") {
      if (!signedIn) return html("", 401);
      return html(
        loadFixtureHtml("cgtrader", url.searchParams.get("page") === "2" ? "liked-models-2" : "liked-models"),
      );
    }
    if (p === "/profile/wish-lists") {
      return signedIn ? redirect("https://www.cgtrader.com/profile/wish-lists/6130770") : html("", 401);
    }
    if (p === "/profile/wish-lists/6130770")
      return signedIn ? html(loadFixtureHtml("cgtrader", "wishlist")) : html("", 401);
    if (p === "/api/internal/users/me") return signedIn ? json(loadFixture("cgtrader", "me")) : json({}, 401);
    if (p === "/3d-print-models" && url.searchParams.get("sort_by") === "trending") {
      return json(loadFixture("cgtrader", "trending"));
    }
    return undefined;
  };
}

const ACCOUNT = { username: "maker-one" };
const connect = (userId: string, waf: string | null = GRAB_TOKEN) =>
  setUserCgtraderSession(userId, { session: SESSION, waf, wafAt: waf ? Date.now() : null }, { ...ACCOUNT });

const spec: ProviderContractSpec = {
  id: "cgtrader",
  name: "CGTrader",
  modelUrl: MODEL_URL,
  expected: {
    externalId: SLUG,
    title: "Lotus Ring with Opening and Closing Mechanism",
    notesIncludes: "Inspired by the elegance of the lotus flower",
    author: "Molena-Design",
    // As the library keeps them: title-cased.
    tags: ["Gold", "Mechanical", "Movable", "Ring"],
    // Its address names it: jewelry/ring.
    category: { name: "Rings", parent: "Fashion" },
    galleryImages: 3,
    // Its STL alone: the 3DM is no model file, and its OBJ is only fetched when nothing else brings one.
    plateInstanceIds: [null],
    plateFilenames: ["stl.stl"],
  },
  connect: (userId) => connect(userId),
  disconnect: async (userId) => {
    await setUserCgtraderSession(userId, null);
  },
  createHandler: (scenario) => {
    // A token FlareSolverr got is kept for every user; each scenario starts without one.
    forgetCgtraderWafToken();
    return handlerFor(scenario);
  },
  credentials: {
    sessionCode: "cgtrader_session",
    connection: async (userId) => (await getCgtraderConnection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/cgtrader/list/entries",
    url: LIKES_URL,
    title: "CGTrader liked models",
    importedId: BEAM,
    freshId: JEWEL,
  },
  // The liked models are the user's own, read with their sign-in, and never gone.
  listing: {
    sync: { externalId: "likes", sourceUrl: LIKES_URL },
    ids: [BEAM, DRAGON, JEWEL],
    needsSignIn: true,
    neverGone: true,
  },
};

const ctx = describeProviderContract(spec);

describe("CGTrader specifics", () => {
  it("keeps a link by the model's number under its slug, as every other link to it is", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expectStatus(await ctx.importUrl("https://www.cgtrader.com/products/6890774"), 200);
    const [print] = await ctx.prints();
    expect(print.sourceExternalId).toBe(SLUG);

    // The same model by its own address is already imported.
    ctx.stub("ok");
    const again = await ctx.importUrl();
    expect(again.body.import_outcome).toBe("already_imported");
  });

  it("answers a model CGTrader doesn't have with 404", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expect((await ctx.importUrl("https://www.cgtrader.com/3d-print-models/art/other/nothing-here")).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("keeps what matters for printing it from the model's details", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    expect(print.notes).toContain("## Model details");
    expect(print.notes).toContain("**Ready for 3D printing**");
    expect(print.notes).toContain("**Parts:** 9");
    expect(print.notes).toContain("**Formats:** STL, OBJ, 3DM");
  });

  it("refuses a paid model the user hasn't bought, before asking for its files", async () => {
    await connect(ctx.userId);
    const stub = ctx.install(handlerFor("ok", { product: paid }));
    const res = await ctx.importUrl();
    expect(res.status).toBe(403);
    expect(res.body.detail).toContain("you haven't bought");
    expect(stub.calls.some((call) => call.url.pathname.includes("/items/"))).toBe(false);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("imports a paid model the user bought, from its download page", async () => {
    await connect(ctx.userId);
    ctx.install(
      handlerFor("ok", { product: (body) => paid(body).replace(/"isPurchased":false/, '"isPurchased":true') }),
    );
    expectStatus(await ctx.importUrl(), 200);
    expect(await ctx.prints()).toHaveLength(1);
  });

  it("says when the account's free downloads are used up", async () => {
    await connect(ctx.userId);
    ctx.stub("limit");
    const res = await ctx.importUrl();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("CGTRADER_DOWNLOAD_LIMIT");
    expect(res.body.detail).toContain("2026-11-01");
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("takes a zip's model files and the STL, and its OBJ only when nothing else brought a model", async () => {
    await connect(ctx.userId);
    const files = ["Lotus.stl", "Lotus.obj", "Lotus_blend.zip", "Lotus_parts.zip"];
    const zips = { "Lotus_parts.zip": { "petal.stl": stl("petal") }, "Lotus_blend.zip": { "lotus.blend": stl("x") } };
    const stub = ctx.install(handlerFor("ok", { files, zips }));
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename).toSorted()).toEqual(["Lotus.stl", "petal.stl"]);
    const fetched = stub.callsTo(FILE_HOST).map((call) => decodeURIComponent(call.url.pathname).split("/").pop());
    expect(fetched.toSorted()).toEqual(["Lotus.stl", "Lotus_parts.zip"]);

    await prisma.print.deleteMany({ where: { userId: ctx.userId, sourceProvider: "cgtrader" } });
    ctx.install(handlerFor("ok", { files: ["Lotus.obj", "Lotus.3dm"] }));
    expectStatus(await ctx.importUrl(), 200);
    const [objOnly] = await ctx.prints();
    const objPlates = await prisma.plate.findMany({ where: { printId: objOnly.id } });
    expect(objPlates.map((plate) => plate.filename)).toEqual(["Lotus.obj"]);
  });

  it("says so for a model whose files are only in archives Thingport can't open", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", { files: ["Lotus.rar", "Lotus.3dm"] }));
    const res = await ctx.importUrl();
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain(".rar");
  });

  it("passes the bot check with the token Grab sent, and stops without one when FlareSolverr isn't set up", async () => {
    await connect(ctx.userId, null);
    const stub = ctx.stub("ok");
    const res = await ctx.importUrl();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CLOUDFLARE_BLOCKED");
    expect(res.body.detail).toContain("FlareSolverr");
    expect(stub.callsTo(FILE_HOST)).toHaveLength(0);

    await connect(ctx.userId);
    const withToken = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const download = withToken.calls.find((call) => call.url.pathname.includes("/free-downloads/"));
    expect(download?.headers.cookie).toContain(`aws-waf-token=${GRAB_TOKEN}`);
  });

  it("gets a token of its own from FlareSolverr when the bot check challenges", async () => {
    await connect(ctx.userId, null);
    await setFlaresolverrUrl(FLARESOLVERR);
    try {
      const stub = ctx.stub("ok");
      expectStatus(await ctx.importUrl(), 200);
      expect(stub.calls.filter((call) => call.url.href === FLARESOLVERR)).toHaveLength(1);
      const downloads = stub.calls.filter((call) => call.url.pathname.includes("/free-downloads/"));
      // Challenged once without it, then let through with it.
      expect(downloads.map((call) => call.headers.cookie?.includes(`aws-waf-token=${MINTED}`) ?? false)).toEqual([
        false,
        true,
      ]);
    } finally {
      await prisma.setting.deleteMany({ where: { key: "flaresolverr_url" } });
    }
  });

  it("lists every page of the user's liked models, and their wishlist", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const likes = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expectStatus(likes, 200);
    expect(likes.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([BEAM, DRAGON, JEWEL]);
    expect(likes.body.entries[0].title).toBe("Beam Truss Cross and T Junction 134");

    const wishlist = await ctx.post(spec.list!.endpoint, {
      url: "https://www.cgtrader.com/profile/wish-lists/6130770",
    });
    expectStatus(wishlist, 200);
    expect(wishlist.body.title).toBe("CGTrader wishlist");
    expect(wishlist.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([DRAGON, JEWEL]);
  });

  it("asks for a sign-in to read the lists, and remembers one CGTrader turns down", async () => {
    await setUserCgtraderSession(ctx.userId, null);
    ctx.stub("ok");
    const signedOut = await ctx.post(spec.list!.endpoint, { url: WISHLIST_URL });
    expect(signedOut.status).toBe(400);
    expect(signedOut.body.code).toBe("cgtrader_session");

    await connect(ctx.userId);
    ctx.stub("rejected");
    const rejected = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("cgtrader_session");
    expect((await getCgtraderConnection(ctx.userId)).state).toBe("expired");
  });

  it("shows the liked models and the wishlist in the Browse tab", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const cards = await cgtraderBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.private])).toEqual([
      ["likes", "CGTrader liked models", 3, true],
      ["wishlist", "CGTrader wishlist", 2, true],
    ]);
    expect(cards.map((card) => card.url)).toEqual([LIKES_URL, WISHLIST_URL]);

    await setUserCgtraderSession(ctx.userId, null);
    await expect(cgtraderBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("lists its trending 3D print models", async () => {
    ctx.stub("ok");
    const trending = await cgtraderTrending.fetch(ctx.userId, 2);
    expect(Array.isArray(trending) && trending.map((model) => [model.id, model.paid])).toEqual([
      ["jewelry-cad-lmd-26100001", true],
      ["astrid-armor-kit", true],
    ]);
  });

  it("keeps a pasted Cookie header with who it is, and turns one CGTrader doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    const pasted = `cookie\n_cgtrader_cookies_check=true; aws-waf-token=${GRAB_TOKEN}; user_id=MTA%3D--abc; _cgtrader_session_id=${SESSION}`;
    expect(await cgtraderConnection.save(ctx.userId, { session: pasted, verify: true })).toEqual({ configured: true });
    expect(await getCgtraderConnection(ctx.userId)).toEqual({ state: "connected", account: ACCOUNT });
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "cgtrader" },
    });
    expect(row.secret).toMatchObject({ session: SESSION, waf: GRAB_TOKEN });

    await expect(
      cgtraderConnection.save(ctx.userId, {
        session: "_cgtrader_session_id=ffffffffffffffffffffffffffffffff",
        verify: true,
      }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(cgtraderConnection.save(ctx.userId, { session: "not a cookie", verify: true })).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("CGTrader pages", () => {
  it("reads a model's product script: its number, its title, its designer, and whether the user bought it", () => {
    expect(cgtraderProductFromScript(fixture("product.txt"))).toEqual({
      id: 6890774,
      slug: SLUG,
      title: "Lotus Ring with Opening and Closing Mechanism",
      price: 0,
      designer: "molena-design",
      purchased: false,
      signedIn: true,
    });
    expect(cgtraderProductFromScript(fixture("product-signed-out.txt"))?.signedIn).toBe(false);
    expect(cgtraderProductFromScript("window.gon={}")).toBeNull();
  });

  it("reads the category from the page's own address, most specific first", () => {
    const product = cgtraderProductFromScript(fixture("product.txt"))!;
    const model = cgtraderModelFromPage(loadFixtureHtml("cgtrader", "model-page"), MODEL_PATH, product);
    expect(model?.meta.siteCategoryIds).toEqual(["jewelry/ring", "jewelry"]);
    expect(model?.meta.author?.links).toEqual(["https://www.cgtrader.com/designers/molena-design"]);
    expect(cgtraderModelFromPage("<html></html>", MODEL_PATH, product)).toBeNull();
  });

  it("picks the files a plate takes and the zips that may hold some, with the OBJs in reserve", () => {
    const kit = { isImportableFile: (name: string) => /\.(stl|3mf|step|stp|obj|scad)$/i.test(name) };
    const file = (name: string) => ({ name, size: null, path: `/items/1/free-downloads/${name}` });
    const picks = cgtraderFilePicks(
      ["a.stl", "a.obj", "a_fbx.zip", "textures.zip", "parts.zip", "a.blend", "a.3mf"].map(file),
      kit,
    );
    expect(picks.first.map((f) => f.name)).toEqual(["a.stl", "parts.zip", "a.3mf"]);
    expect(picks.fallback.map((f) => f.name)).toEqual(["a.obj"]);
  });
});

describe("CGTrader sign-in", () => {
  it("picks the session and the bot check's token out of a Cookie header", () => {
    const header = `_cgtrader_cookies_check=true; aws-waf-token=${GRAB_TOKEN}; user_id=MTA%3D--abc; _cgtrader_session_id=${SESSION}`;
    expect(normalizeCgtraderSession(header)).toMatchObject({ session: SESSION, waf: GRAB_TOKEN });
    expect(normalizeCgtraderSession(`_cgtrader_session_id=${SESSION}`)).toEqual({
      session: SESSION,
      waf: null,
      wafAt: null,
    });
  });

  it("reads request headers pasted from DevTools, and takes nothing without a session cookie", () => {
    const lines = `:authority\nwww.cgtrader.com\ncookie\naws-waf-token=${GRAB_TOKEN}; _cgtrader_session_id=${SESSION}\nuser-agent\nMozilla/5.0`;
    expect(normalizeCgtraderSession(lines)).toMatchObject({ session: SESSION, waf: GRAB_TOKEN });
    expect(normalizeCgtraderSession(`aws-waf-token=${GRAB_TOKEN}`)).toBeNull();
    expect(normalizeCgtraderSession("")).toBeNull();
    expect(normalizeCgtraderSession(null)).toBeNull();
  });
});
