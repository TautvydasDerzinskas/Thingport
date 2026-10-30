import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { forgetToymakr3dCategories } from "../../src/providers/toymakr3d/api";
import { toymakr3dBrowse } from "../../src/providers/toymakr3d/browse";
import { toymakr3dConnection } from "../../src/providers/toymakr3d/connection";
import {
  getToymakr3dConnection,
  normalizeToymakr3dSession,
  setUserToymakr3dSession,
} from "../../src/providers/toymakr3d/session";
import { describeProviderContract, type ProviderContractSpec } from "./contract";
import {
  assertThat,
  binary,
  expectStatus,
  html,
  loadFixtureHtml,
  redirect,
  stl,
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

// Toymakr3D end to end, from its pages: a model's details are anyone's to read, while its files and the user's liked
// products need their sign-in -- the download page redirecting a signed-in user to a signed link to one zip of the
// files, and anyone else to its sign-in page. A model's page doesn't say its categories, so they come from the
// category listings its menu links. Its pages are the recorded shapes in fixtures/providers/toymakr3d, the signed-in
// account renamed.

const REMEMBER_COOKIE = "remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d";
const REMEMBER = `eyJpdiI6${"Ab1+/=".repeat(8)}`;
const SESSION = `eyJpdiI6${"Cd2-_~".repeat(8)}`;
const ACCOUNT = { username: "maker-one", name: "maker-one" };
const MODEL_URL = "https://www.toymakr3d.com/product/8-transformable-sofa-robot";
const LIKES_URL = "https://www.toymakr3d.com/like-product";
const ZIP_PATH = "/plupload/dgfile/download/free/8-transformable-sofa-robot-by_toymakr3d.zip";
const PLATES = ["Soza_All_filesA.stl", "Soza_Framed1.stl"];
const CATEGORY_PAGES: Record<string, string> = {
  "transforming-robots": "category-transforming-robots",
  other: "category-other",
};

const signedIn = (cookie: string | undefined) => Boolean(cookie?.includes(`${REMEMBER_COOKIE}=${REMEMBER}`));

function handlerFor(scenario: string): FetchHandler {
  return async ({ url, headers }) => {
    if (url.hostname === "cdn.toymakr3d.com" && url.pathname === ZIP_PATH) {
      return binary(await zip("toymakr3d", Object.fromEntries(PLATES.map((name) => [name, stl(name)]))));
    }
    if (url.hostname !== "www.toymakr3d.com") return undefined;
    const path = url.pathname;
    if (path === "/") return html(loadFixtureHtml("toymakr3d", "home-page"));
    // Its own name for a model, which a link with any other name is sent to.
    if (/^\/product\/0*8-/.test(path) && scenario !== "missing") {
      if (path !== "/product/8-transformable-sofa-robot") return redirect(MODEL_URL, 301);
      return html(loadFixtureHtml("toymakr3d", "model-page"));
    }
    if (path.startsWith("/product/")) return html("<!doctype html><title>Toymakr3D</title>", 404);
    if (path === `/download/8-transformable-sofa-robot`) {
      assertThat(signedIn(headers.cookie), "the files are asked for with the user's sign-in");
      if (scenario === "rejected") return redirect("https://www.toymakr3d.com/login");
      if (scenario === "watermarking") {
        return html(
          '<div id="progress_bar"></div><span class="watermarking-percentage-value">40</span>' +
            '<button class="btn-refresh-page">Refresh</button>',
        );
      }
      return redirect(`https://cdn.toymakr3d.com${ZIP_PATH}?Expires=1793211390&Signature=c2ln&Key-Pair-Id=K30`);
    }
    if (path === "/like-product") {
      if (!signedIn(headers.cookie) || scenario === "rejected") return redirect("https://www.toymakr3d.com/login");
      return html(loadFixtureHtml("toymakr3d", url.searchParams.get("page") === "2" ? "likes-page-2" : "likes-page"));
    }
    const category = path.match(/^\/by-category\/([^/]+)$/)?.[1];
    if (category && CATEGORY_PAGES[category]) return html(loadFixtureHtml("toymakr3d", CATEGORY_PAGES[category]));
    if (category === "most-popular") return html(loadFixtureHtml("toymakr3d", "popular-page"));
    if (path === "/my-account") {
      return signedIn(headers.cookie)
        ? html(loadFixtureHtml("toymakr3d", "account-page"))
        : redirect("https://www.toymakr3d.com/login");
    }
    return undefined;
  };
}

const connect = (userId: string) =>
  setUserToymakr3dSession(
    userId,
    { remember: REMEMBER, rememberName: REMEMBER_COOKIE, session: SESSION },
    { ...ACCOUNT },
  );

const spec: ProviderContractSpec = {
  id: "toymakr3d",
  name: "Toymakr3D",
  modelUrl: MODEL_URL,
  expected: {
    externalId: "8",
    title: "Transformable Sofa Robot",
    notesIncludes: "transform him self from sofa to robot",
    author: "reza_aulia",
    tags: ["Robot", "Toys"],
    // Read from the categories its menu links, not from the model's own page.
    category: { name: "Characters", parent: "Toys & Games" },
    // The YouTube clip in its carousel is no picture of the model.
    galleryImages: 2,
    plateInstanceIds: [null, null],
    plateFilenames: PLATES,
  },
  connect,
  disconnect: async (userId) => {
    await setUserToymakr3dSession(userId, null);
  },
  createHandler: (scenario) => {
    // Its categories are kept for a few hours; each scenario reads them again, so what it answers is what counts.
    forgetToymakr3dCategories();
    return handlerFor(scenario);
  },
  credentials: {
    sessionCode: "toymakr3d_session",
    connection: async (userId) => (await getToymakr3dConnection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/toymakr3d/list/entries",
    url: LIKES_URL,
    title: "Toymakr3D liked products",
    importedId: "8",
    freshId: "95",
  },
  // The liked products are the user's own, read with their sign-in, and never gone.
  listing: {
    sync: { externalId: "likes", sourceUrl: LIKES_URL },
    ids: ["8", "95", "105"],
    needsSignIn: true,
    neverGone: true,
  },
};

const ctx = describeProviderContract(spec);

describe("Toymakr3D specifics", () => {
  it("answers a model Toymakr3D doesn't have with 404", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expect((await ctx.importUrl("https://www.toymakr3d.com/product/99999-nothing")).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("reads a model by its id, whatever name the link gives it", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl("https://www.toymakr3d.com/product/008-some-old-name"), 200);
    const asked = stub.callsTo("www.toymakr3d.com").map((call) => call.url.pathname);
    // Asked for by the id alone, then read where Toymakr3D sent it.
    expect(asked.slice(0, 2)).toEqual(["/product/8-", "/product/8-transformable-sofa-robot"]);
    const [print] = await ctx.prints();
    expect(print.sourceExternalId).toBe("8");
  });

  it("imports the one zip Toymakr3D hands over, unpacked into the model's files", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => plate.filename)).toEqual(PLATES);
    expect(stub.callsTo("www.toymakr3d.com").filter((call) => call.url.pathname.startsWith("/download/"))).toHaveLength(
      1,
    );
  });

  it("keeps the printing settings from the model's Setting tab in its notes", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    expect(print.notes).toContain("## Printing details");
    expect(print.notes).toContain("Nozzle 0.4mm");
  });

  it("waits rather than fails while Toymakr3D is still watermarking a bought model's files", async () => {
    await connect(ctx.userId);
    ctx.stub("watermarking");
    const res = await ctx.importUrl();
    expect(res.status).toBe(409);
    expect(res.body.detail).toContain("watermarking this model's files");
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("lists every page of the user's liked products", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const res = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expectStatus(res, 200);
    expect(res.body.title).toBe("Toymakr3D liked products");
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual(["8", "95", "105"]);
    expect(res.body.total).toBe(3);
    expect(res.body.truncated).toBe(false);
  });

  it("asks for a sign-in to read the likes, and remembers one Toymakr3D turns down", async () => {
    await setUserToymakr3dSession(ctx.userId, null);
    ctx.stub("ok");
    const signedOut = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(signedOut.status).toBe(400);
    expect(signedOut.body.code).toBe("toymakr3d_session");

    await connect(ctx.userId);
    ctx.stub("rejected");
    const rejected = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("toymakr3d_session");
    expect((await getToymakr3dConnection(ctx.userId)).state).toBe("expired");
  });

  it("shows the user's liked products in the Browse tab, and asks for a sign-in without one", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const cards = await toymakr3dBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.private])).toEqual([
      ["likes", "Toymakr3D liked products", 3, true],
    ]);
    expect(cards[0].url).toBe(LIKES_URL);

    await setUserToymakr3dSession(ctx.userId, null);
    await expect(toymakr3dBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps a pasted Cookie header with who it is, and turns one Toymakr3D doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    const pasted = `cookie\ntz=abc; ${REMEMBER_COOKIE}=${REMEMBER}; XSRF-TOKEN=zz; toymakr3dcom_session=${SESSION}`;
    expect(await toymakr3dConnection.save(ctx.userId, { session: pasted, verify: true })).toEqual({ configured: true });
    expect(await getToymakr3dConnection(ctx.userId)).toEqual({ state: "connected", account: ACCOUNT });
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "toymakr3d" },
    });
    expect(row.secret).toEqual({ remember: REMEMBER, rememberName: REMEMBER_COOKIE, session: SESSION });

    await expect(
      toymakr3dConnection.save(ctx.userId, { session: `toymakr3dcom_session=${"x".repeat(40)}`, verify: true }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(toymakr3dConnection.save(ctx.userId, { session: "not a cookie", verify: true })).rejects.toMatchObject(
      { status: 422 },
    );
  });
});

describe("Toymakr3D sign-in", () => {
  it("picks its two cookies out of a Cookie header, whichever of them it has", () => {
    const both = `tz=abc; ${REMEMBER_COOKIE}=${REMEMBER}; toymakr3dcom_session=${SESSION}`;
    expect(normalizeToymakr3dSession(both)).toEqual({
      remember: REMEMBER,
      rememberName: REMEMBER_COOKIE,
      session: SESSION,
    });
    expect(normalizeToymakr3dSession(`toymakr3dcom_session=${SESSION}`)).toEqual({
      remember: null,
      rememberName: null,
      session: SESSION,
    });
    expect(normalizeToymakr3dSession(`${REMEMBER_COOKIE}=${REMEMBER}`)).toEqual({
      remember: REMEMBER,
      rememberName: REMEMBER_COOKIE,
      session: null,
    });
  });

  it("keeps the remember cookie's whole name, which is a hash of the site's own key", () => {
    const other = "remember_web_0123456789abcdef0123456789abcdef01234567";
    expect(normalizeToymakr3dSession(`${other}=${REMEMBER}`)?.rememberName).toBe(other);
  });

  it("reads request headers pasted from DevTools, and takes nothing from a page without a sign-in", () => {
    const lines = `:authority\nwww.toymakr3d.com\ncookie\ntz=abc; toymakr3dcom_session=${SESSION}\nuser-agent\nMozilla/5.0`;
    expect(normalizeToymakr3dSession(lines)?.session).toBe(SESSION);
    expect(normalizeToymakr3dSession("g_state={}; XSRF-TOKEN=short")).toBeNull();
    expect(normalizeToymakr3dSession("")).toBeNull();
    expect(normalizeToymakr3dSession(null)).toBeNull();
  });
});
