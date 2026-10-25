import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import { pinshapeBrowse } from "../../src/providers/pinshape/browse";
import { pinshapeConnection } from "../../src/providers/pinshape/connection";
import { getPinshapeConnection, setUserPinshapeSession } from "../../src/providers/pinshape/session";
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

// Pinshape end to end, from its pages: a model's details, collections and likes are anyone's to read; its files need
// the user's cookies, each file's download link redirecting a signed-in user to a signed S3 link and anyone else to
// the sign-in page. Its pages are the recorded shapes in fixtures/providers/pinshape, its users renamed.

const OWNER = { userId: "1000001", key: "1000001-maker-one", name: "maker-one" };
const REMEMBER = `${OWNER.userId}|${"ab".repeat(64)}`;
const SESSION = "Kq3sXy6vL0yX2-abcdEFGHijklMNOPqrstUVWXyz0";
const MODEL_URL = "https://pinshape.com/items/111504-articulated-dragon";
const COLLECTION_URL = "https://pinshape.com/items?collection_id=187772";
const LIKES_URL = "https://pinshape.com/users/1000001-maker-one?tab=likes";
const COLLECTION_IDS = ["111504", "15344", "15362"];
const FILES: Record<string, string> = {
  "1784513": "flat_bottom_fdm_Draco_short.stl",
  "1784514": "Resin_Draco_short.stl",
};

function handlerFor(scenario: string): FetchHandler {
  return ({ url, headers }) => {
    if (url.hostname === "mh-pinshape-private.s3.amazonaws.com") return binary(stl(url.pathname.split("/").pop()!));
    if (url.hostname !== "pinshape.com") return undefined;
    const path = url.pathname;
    if (path === "/items/111504") {
      return scenario === "missing" ? redirect("/index") : html(loadFixtureHtml("pinshape", "model-page"));
    }
    const file = path.match(/^\/items\/111504-articulated-dragon\/download\/file\/(\d+)$/)?.[1];
    if (file && FILES[file]) {
      assertThat(
        headers.cookie?.includes(`remember_token=${REMEMBER}`),
        "the file is asked for with the user's sign-in",
      );
      if (scenario === "rejected") return redirect(`/auth/login?next=http://pinshape.com${path}`);
      return redirect(
        `https://mh-pinshape-private.s3.amazonaws.com/uploads/shape_file/file/${file}/${FILES[file]}` +
          `?response-content-disposition=attachment&AWSAccessKeyId=AKIAEXAMPLE&Signature=c2ln&Expires=1792910109`,
      );
    }
    if (path === "/items" && url.searchParams.get("collection_id") === "187772") {
      // One that's gone shows the browse page in its place.
      if (scenario === "gone") return html(loadFixtureHtml("pinshape", "browse-page"));
      return html(
        loadFixtureHtml("pinshape", url.searchParams.get("page") === "2" ? "collection-page-2" : "collection-page"),
      );
    }
    if (path === `/users/${OWNER.userId}` && url.searchParams.get("tab") === "likes") {
      return html(loadFixtureHtml("pinshape", "likes-page"));
    }
    if (path === `/api/users/${OWNER.userId}/collections`) return json(loadFixture("pinshape", "collections"));
    if (path === `/api/users/${OWNER.userId}/subscriptions`) return json(loadFixture("pinshape", "subscriptions"));
    if (path === "/settings") {
      return headers.cookie?.includes(REMEMBER)
        ? html(loadFixtureHtml("pinshape", "settings-page"))
        : redirect("/auth/login?next=%2Fsettings");
    }
    return undefined;
  };
}

const connect = (userId: string) =>
  setUserPinshapeSession(userId, { remember: REMEMBER, session: SESSION, userId: OWNER.userId }, { ...OWNER });

const spec: ProviderContractSpec = {
  id: "pinshape",
  name: "Pinshape",
  modelUrl: MODEL_URL,
  expected: {
    externalId: "111504",
    title: "ARTICULATED DRAGON",
    notesIncludes: "Flexible, and printed in one piece.",
    author: "mykola.lop",
    tags: ["Articulated", "Dragon", "Fdm", "Resin"],
    // Its model pages don't say which of its categories a model is in.
    category: null,
    galleryImages: 3,
    plateInstanceIds: [null, null],
    plateFilenames: ["flat_bottom_fdm_Draco_short.stl", "Resin_Draco_short.stl"],
  },
  connect,
  disconnect: async (userId) => {
    await setUserPinshapeSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: {
    sessionCode: "pinshape_session",
    connection: async (userId) => (await getPinshapeConnection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/pinshape/list/entries",
    url: COLLECTION_URL,
    title: "Workshop favourites",
    importedId: "111504",
    freshId: "15344",
  },
  // Its collections are anyone's to read, over pages of 12.
  listing: { sync: { externalId: "187772", sourceUrl: COLLECTION_URL }, ids: COLLECTION_IDS, needsSignIn: false },
};

const ctx = describeProviderContract(spec);

describe("Pinshape specifics", () => {
  it("answers a model Pinshape doesn't have with 404", async () => {
    await connect(ctx.userId);
    ctx.stub("missing");
    expect((await ctx.importUrl()).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("downloads each of the model's files rather than the zip of them all", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const asked = stub.callsTo("pinshape.com").map((call) => call.url.pathname);
    expect(asked.filter((path) => path.includes("/download/"))).toEqual([
      "/items/111504-articulated-dragon/download/file/1784513",
      "/items/111504-articulated-dragon/download/file/1784514",
    ]);
  });

  it("lists someone's likes, as many as their profile shows, named after them", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const res = await ctx.post(spec.list!.endpoint, { url: LIKES_URL });
    expectStatus(res, 200);
    expect(res.body.title).toBe("Pinshape likes (@maker-one)");
    expect(res.body.entries.map((entry: { design_id: string }) => entry.design_id)).toEqual([
      "36792",
      "35600",
      "18590",
    ]);
    // Its profile shows 3 of the 20.
    expect(res.body.total).toBe(20);
    expect(res.body.truncated).toBe(true);
  });

  it("shows the user's likes, own collections and subscriptions in the Browse tab", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    const cards = await pinshapeBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.owner])).toEqual([
      ["likes:1000001", "Pinshape likes (@maker-one)", 20, "maker-one"],
      ["190046", "Buildings and homes", 46, "Maker One"],
      ["187339", "Mixed up collection", 802, "Maker One"],
      ["2088", "Objects", 23, "Someone Else"],
    ]);
    expect(cards[0].url).toBe(LIKES_URL);
    expect(cards[1].thumbnails).toHaveLength(4);
  });

  it("asks for a sign-in before the Browse tab can say whose lists to show", async () => {
    await setUserPinshapeSession(ctx.userId, null);
    ctx.stub("ok");
    await expect(pinshapeBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("keeps a pasted sign-in with who it is, and turns one Pinshape doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    const pasted = `cookie\npinshape_session_id=sess_x; session=${SESSION}; remember_token=${REMEMBER}; cf_clearance=x`;
    expect(await pinshapeConnection.save(ctx.userId, { session: pasted, verify: true })).toEqual({ configured: true });
    expect(await getPinshapeConnection(ctx.userId)).toEqual({ state: "connected", account: OWNER });
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "pinshape" },
    });
    expect(row.secret).toEqual({ remember: REMEMBER, session: SESSION });

    await expect(
      pinshapeConnection.save(ctx.userId, { session: `session=${"x".repeat(40)}`, verify: true }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(pinshapeConnection.save(ctx.userId, { session: "not a cookie", verify: true })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("keeps who a sign-in is when it can't be checked, but not once it's someone else's", async () => {
    await connect(ctx.userId);
    // Pinshape unreachable: the same account's new cookies keep its name.
    ctx.install(() => new Response("down", { status: 500 }));
    await pinshapeConnection.save(ctx.userId, { session: `remember_token=${REMEMBER}` });
    expect((await getPinshapeConnection(ctx.userId)).account).toEqual(OWNER);
    // Another account's: only its id is known.
    await pinshapeConnection.save(ctx.userId, { session: `remember_token=1000002|${"cd".repeat(64)}` });
    expect((await getPinshapeConnection(ctx.userId)).account).toEqual({
      userId: "1000002",
      key: "1000002",
      name: null,
    });
    // A session cookie alone doesn't say whose it is, so the last account isn't kept for it.
    await connect(ctx.userId);
    await pinshapeConnection.save(ctx.userId, { session: `session=${"y".repeat(40)}` });
    expect(await getPinshapeConnection(ctx.userId)).toEqual({ state: "connected", account: null });
  });
});
