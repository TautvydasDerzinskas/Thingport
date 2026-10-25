import { afterEach, describe, expect, it } from "vitest";
import {
  checkPinshapeAuth,
  fetchPinshapePopular,
  isPinshapeFileHost,
  parsePinshapeCollectionUrl,
  parsePinshapeLikesUrl,
  parsePinshapeModelUrl,
  pinshapeCollectionFromPage,
  pinshapeLikesFromPage,
  pinshapeModelFromPage,
  pinshapeSignedInUser,
  resolvePinshapeDownload,
  resolvePinshapeModel,
} from "../src/providers/pinshape/api";
import { normalizePinshapeSession, pinshapeCookie } from "../src/providers/pinshape/session";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { syncLikesUsername } from "../src/dto";
import { html, installFetch, json, loadFixtureHtml, redirect, type FetchStub } from "./providers/support";

// The Pinshape client against pages in the site's own shapes (fixtures/providers/pinshape), with fetch stubbed. No
// database.

const REMEMBER = `1000001|${"ab".repeat(64)}`;
const SESSION = "Kq3sXy6vL0yX2-abcdEFGHijklMNOPqrstUVWXyz0";

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("Pinshape links", () => {
  it("reads model pages by their id, with or without the name after it", () => {
    expect(parsePinshapeModelUrl("https://pinshape.com/items/111504-articulated-dragon")).toEqual({
      modelId: "111504",
    });
    expect(parsePinshapeModelUrl("https://www.pinshape.com/items/111504/")).toEqual({ modelId: "111504" });
    expect(parsePinshapeModelUrl("https://pinshape.com/items/111504-articulated-dragon/download/file/1")).toBeNull();
    expect(parsePinshapeModelUrl("https://pinshape.com/items?sort=popular")).toBeNull();
    expect(parsePinshapeModelUrl("https://pinshape.com.evil.test/items/1")).toBeNull();
    expect(modelIdFromUrl("pinshape", modelUrlFor("pinshape", "111504"))).toBe("111504");
  });

  it("reads a collection, the browse page showing it", () => {
    expect(parsePinshapeCollectionUrl("https://pinshape.com/items?collection_id=187772&page=3")).toEqual({
      collectionId: "187772",
    });
    expect(parsePinshapeCollectionUrl("https://pinshape.com/items?category=6")).toBeNull();
    expect(parsePinshapeCollectionUrl("https://pinshape.com/users/1?collection_id=2")).toBeNull();
  });

  it("reads someone's likes from their profile's Likes tab, and names them after its address", () => {
    expect(parsePinshapeLikesUrl("https://pinshape.com/users/208297-angel-spy?tab=likes")).toEqual({
      userId: "208297",
      name: "angel-spy",
    });
    expect(parsePinshapeLikesUrl("https://pinshape.com/users/208297#likes")).toEqual({ userId: "208297", name: null });
    expect(parsePinshapeLikesUrl("https://pinshape.com/users/208297-angel-spy")).toBeNull();
    expect(parsePinshapeLikesUrl("https://pinshape.com/users/208297-angel-spy?tab=collections")).toBeNull();

    const likes = parseSyncSource("https://pinshape.com/users/208297-angel-spy?page=2&tab=likes")!;
    expect(likes).toEqual({
      provider: "pinshape",
      externalId: "likes:208297",
      url: "https://pinshape.com/users/208297-angel-spy?tab=likes",
      likesOf: "angel-spy",
    });
    expect(syncLikesUsername({ externalId: likes.externalId, sourceUrl: likes.url })).toBe("angel-spy");
    // Without a name in its address, the id stands in.
    const bare = parseSyncSource("https://pinshape.com/users/208297?tab=likes")!;
    expect(bare.likesOf).toBe("208297");
    expect(syncLikesUsername({ externalId: bare.externalId, sourceUrl: bare.url })).toBe("208297");
    // A name that isn't valid percent-encoding stays as written.
    const odd = parseSyncSource("https://pinshape.com/users/208297-%?tab=likes")!;
    expect(syncLikesUsername({ externalId: odd.externalId, sourceUrl: odd.url })).toBe("%");
    // Other sites' "/users/…" paths are theirs as before.
    expect(syncLikesUsername({ externalId: "likes:users", sourceUrl: "https://www.thingiverse.com/users/likes" })).toBe(
      "users",
    );
  });

  it("only takes files from its own S3 buckets", () => {
    expect(isPinshapeFileHost("mh-pinshape-private.s3.amazonaws.com")).toBe(true);
    expect(isPinshapeFileHost("mh-pinshape-public.s3.us-west-1.amazonaws.com")).toBe(true);
    expect(isPinshapeFileHost("pinshape.com")).toBe(false);
    expect(isPinshapeFileHost("someone-else.s3.amazonaws.com")).toBe(false);
    expect(isPinshapeFileHost("mh-pinshape-private.s3.amazonaws.com.evil.test")).toBe(false);
  });
});

describe("Pinshape sign-in", () => {
  it("picks its two cookies out of a Cookie header, or DevTools' copied headers", () => {
    const header = `pinshape_session_id=sess_x; session=${SESSION}; remember_token=${REMEMBER}; cf_clearance=abc`;
    const expected = { remember: REMEMBER, session: SESSION, userId: "1000001" };
    expect(normalizePinshapeSession(header)).toEqual(expected);
    expect(normalizePinshapeSession(`accept\ntext/html\ncookie\n${header}\npriority\nu=0, i`)).toEqual(expected);
    expect(normalizePinshapeSession(`Cookie: ${header}`)).toEqual(expected);
  });

  it("takes either cookie alone, and a bare remember token, its pipe escaped or not", () => {
    expect(normalizePinshapeSession(REMEMBER)).toEqual({ remember: REMEMBER, session: null, userId: "1000001" });
    expect(normalizePinshapeSession(REMEMBER.replace("|", "%7C"))).toEqual({
      remember: REMEMBER,
      session: null,
      userId: "1000001",
    });
    expect(normalizePinshapeSession(`session=${SESSION}`)).toEqual({ remember: null, session: SESSION, userId: null });
    expect(normalizePinshapeSession("pinshape_session_id=sess_abcdefghijklmnopqrstuvwxyz")).toBeNull();
    expect(normalizePinshapeSession("not a sign-in")).toBeNull();
    expect(pinshapeCookie({ remember: REMEMBER, session: SESSION })).toBe(
      `remember_token=${REMEMBER}; session=${SESSION}`,
    );
  });

  it("says whose a sign-in is from its settings page, and that one it sends to sign in is turned down", async () => {
    stub = installFetch(({ url, headers }) =>
      url.pathname === "/settings" && headers.cookie?.includes(REMEMBER)
        ? html(loadFixtureHtml("pinshape", "settings-page"))
        : redirect("/auth/login?next=%2Fsettings"),
    );
    expect(await checkPinshapeAuth(`remember_token=${REMEMBER}`)).toEqual({
      userId: "1000001",
      key: "1000001-maker-one",
      name: "maker-one",
    });
    expect(await checkPinshapeAuth(`session=${SESSION}`)).toBe("rejected");
    // A visitor's page has no menu of theirs.
    expect(pinshapeSignedInUser(loadFixtureHtml("pinshape", "model-page"))).toBeNull();
  });
});

describe("Pinshape pages", () => {
  it("reads a model page: its details, its pictures with the one it shows first, and each file's link", () => {
    const model = pinshapeModelFromPage(loadFixtureHtml("pinshape", "model-page"), "111504")!;
    expect(model.meta.title).toBe("ARTICULATED DRAGON");
    expect(model.meta.description).toContain("Flexible, and printed in one piece.");
    expect(model.meta.tags).toEqual(["dragon", "articulated", "resin", "FDM"]);
    // The designer's, not those of the related models under it.
    expect(model.meta.author).toMatchObject({
      provider: "pinshape",
      externalId: "2371033",
      name: "mykola.lop",
      links: ["https://pinshape.com/users/2371033-mykolalop"],
      avatarUrl: "https://assets.pinshape.com/uploads/user/avatar/2371033/BJgDPLen970.jpg",
    });
    expect(model.meta.previewImageUrl).toBe(
      "https://assets.pinshape.com/uploads/image/file/485416/large_articulated-dragon-3d-printing-485416.jpg",
    );
    expect(model.galleryImages.map((image) => image.filename)).toEqual([
      "articulated-dragon-3d-printing-485416.jpg",
      "articulated-dragon-3d-printing-485415.jpg",
      "articulated-dragon-3d-printing-485417.jpg",
    ]);
    expect(model.files).toEqual([
      { name: "flat_bottom_fdm_Draco_short.stl", path: "/items/111504-articulated-dragon/download/file/1784513" },
      { name: "Resin_Draco_short.stl", path: "/items/111504-articulated-dragon/download/file/1784514" },
    ]);
    expect(model.zipPath).toBe("/download/111504");
    expect(model.price).toBeNull();
    expect(pinshapeModelFromPage(loadFixtureHtml("pinshape", "browse-page"), "1")).toBeNull();
  });

  it("loads the tags past the ones a model page shows", async () => {
    const page = loadFixtureHtml("pinshape", "model-page").replace('data-total-tags="4"', 'data-total-tags="6"');
    stub = installFetch(({ url }) => {
      if (url.pathname === "/items/111504") return html(page);
      if (url.pathname === "/items/111504/tags" && url.searchParams.get("offset") === "4") {
        return json({ remaining: 2, tags: ["print_in_place", "dragon"], total: 6 });
      }
      return undefined;
    });
    expect((await resolvePinshapeModel("111504"))?.meta.tags).toEqual([
      "dragon",
      "articulated",
      "resin",
      "FDM",
      "print_in_place",
    ]);
  });

  it("reads a profile's likes, and a collection's page, telling one that's gone by the browse page in its place", () => {
    const likes = pinshapeLikesFromPage(loadFixtureHtml("pinshape", "likes-page"), "1000001", "maker-one")!;
    expect(likes).toMatchObject({ total: 20, truncated: true, owner: "maker-one" });
    expect(likes.entries.map((entry) => entry.modelId)).toEqual(["36792", "35600", "18590"]);
    expect(pinshapeLikesFromPage(loadFixtureHtml("pinshape", "likes-page"), "1000001")?.owner).toBe("Maker One");

    const collection = pinshapeCollectionFromPage(loadFixtureHtml("pinshape", "collection-page"), "187772")!;
    expect(collection.info).toEqual({
      collectionId: "187772",
      name: "Workshop favourites",
      owner: { id: "1000001", name: "Maker One" },
    });
    expect(collection).toMatchObject({ total: 3, pages: 2 });
    expect(collection.entries[0]).toMatchObject({
      modelId: "111504",
      title: "ARTICULATED DRAGON",
      author: "mykola.lop",
    });
    expect(pinshapeCollectionFromPage(loadFixtureHtml("pinshape", "browse-page"), "187772")).toBeNull();
  });

  it("reads its most popular models off its browse page", async () => {
    stub = installFetch(({ url }) =>
      url.pathname === "/items" && url.searchParams.get("sort") === "popular"
        ? html(loadFixtureHtml("pinshape", "browse-page"))
        : undefined,
    );
    const popular = await fetchPinshapePopular(2);
    expect(popular).toHaveLength(2);
    expect(popular[0]).toMatchObject({ url: `https://pinshape.com/items/${popular[0].id}`, paid: false });
    expect(popular[0].image).toMatch(/^https:\/\//);
    expect(stub.calls).toHaveLength(1);
  });

  it("follows a file's download link to its signed link, and says a sign-in it sends to sign in is turned down", async () => {
    stub = installFetch(({ headers }) =>
      headers.cookie
        ? redirect("https://mh-pinshape-private.s3.amazonaws.com/uploads/shape_file/file/1/a.stl?Signature=x")
        : redirect("/auth/login?next=http://pinshape.com/items/1-a/download/file/1"),
    );
    expect(await resolvePinshapeDownload("/items/1-a/download/file/1", `remember_token=${REMEMBER}`)).toBe(
      "https://mh-pinshape-private.s3.amazonaws.com/uploads/shape_file/file/1/a.stl?Signature=x",
    );
    await expect(resolvePinshapeDownload("/items/1-a/download/file/1", "")).rejects.toThrow(/sign-in/);
    // Sent there with a link of its own, http:// and all.
    stub.restore();
    stub = installFetch(() => redirect("http://pinshape.com/auth/login?next=http://pinshape.com/items/1-a"));
    await expect(resolvePinshapeDownload("/items/1-a/download/file/1", "session=x")).rejects.toThrow(/sign-in/);
  });
});
