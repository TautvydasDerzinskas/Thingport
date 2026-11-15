import { describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/db";
import {
  fetchPixup3dVariantState,
  pixup3dCategoryIds,
  pixup3dCollectionFromPage,
  pixup3dGalleryFrom,
  pixup3dModelFrom,
  placePixup3dFreeOrder,
  renewedSession,
  resolvePixup3dModel,
  withoutUploadNumbers,
} from "../../src/providers/pixup3d/api";
import { pixup3dBrowse } from "../../src/providers/pixup3d/browse";
import { pixup3dConnection } from "../../src/providers/pixup3d/connection";
import { pixup3dImportableVariants, pixup3dTrending } from "../../src/providers/pixup3d";
import {
  getPixup3dConnection,
  normalizePixup3dSession,
  pixup3dMemberOf,
  setUserPixup3dSession,
} from "../../src/providers/pixup3d/session";
import { withImportActivity } from "../../src/services/importActivity";
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

// PIXUP end to end, from the JSON API its pages call and the pages themselves: a model's details from `/api/v1/posts`,
// its description and pictures from its page, whether the user owns each variant, the $0 order a free one takes
// (cart, CSRF token, checkout), and one download per file group. Its answers are the recorded shapes in
// fixtures/providers/pixup3d, trimmed -- the model's sliced variant cut to two printers, reviews left out of its
// structured data, three trending models, a wishlist of three over two pages -- and the signed-in member renamed.
// A download sends an owner to a signed CloudFront link to the group's zip, whose files carry their upload numbers,
// and a $0 checkout lands on the library, as a real one did on 2026-11-08. The "still being packaged" page wasn't seen.

const SESSION = "c2Vzc2lvbi1kYXRhLWZvci10ZXN0cy1vbmx5%3D%3D--aXYtZm9yLXRlc3Rz--dGFnLWZvci10ZXN0cw%3D%3D";
const RENEWED = "cmVuZXdlZC1zZXNzaW9uLWRhdGEtZm9yLXRlc3Rz--bmV3LWl2LXZhbHVl--bmV3LXRhZy12YWx1ZQ%3D%3D";
// Another sign-in, saved while a request of Thingport's is out.
const OTHER = "b3RoZXItc2Vzc2lvbi1kYXRhLWZvci10ZXN0cw%3D%3D--b3RoZXItaXY--b3RoZXItdGFn";
const TOKEN = "Q1NSRi10b2tlbi1mb3ItdGVzdHMtb25seS1ub3QtcmVhbC0wMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA";
const POST = "427";
const MODEL_URL = `https://pixup3d.com/en/posts/${POST}`;
const PAID_POST = "11033";
const STL_VARIANT = "893";
const STL_GROUP = "2763";
const PAID_VARIANT = "11862";
const ME = "MakerOne";
const WISHLIST_URL = `https://pixup3d.com/en/p/${ME}/saved_posts`;
const DESIGNER = "Atlanticus";
const COLLECTION_URL = `https://pixup3d.com/en/p/${DESIGNER}/collections/5`;
const GUNDAM = "8927";
const XENO = "9031";
const API = "/api/v1";

// The group's own number stands in for the package's, which only the site knows.
const fileUrl = (group: string) =>
  `https://file.pixup3d.com/uploads/post_file_package/file/${group}/package.zip?response-content-disposition=` +
  "attachment%3B+filename%3D%22Phrozen_XP_Finder.zip%22&Expires=1794167667&Signature=abc&Key-Pair-Id=K1";
// Each variant's model, for the library.
// "4598" stands in for the variant of the collection's first model, a paid one.
const POST_OF: Record<string, number> = { [STL_VARIANT]: 427, [PAID_VARIANT]: 11033, [XENO]: 9031, "4598": 4598 };

/** What the site holds for the member while a test runs: what they own, what's in their cart. */
type State = {
  owned: Set<string>;
  cart: { id: string; price: string }[];
  /** Answers a download with the page saying its zip is still being made. */
  packaging?: boolean;
  /** Answers each request with a new session cookie. */
  renews?: boolean;
  /** Where a checkout sends the member: its success page, unless said otherwise. */
  checkoutTo?: string;
  /** What a checkout took, which its success page puts in the library once it's opened. */
  ordered?: { id: string; price: string }[];
  /** What a cart answer says, in place of what's in it: a broken one, or one priced by the cart. */
  cartAnswer?: (answer: ReturnType<typeof cartAnswer>) => unknown;
  /** How many pages the library runs to; what's owned is on the last. */
  libraryPages?: number;
  /** Run before a request whose path matches is answered, such as another sign-in saved meanwhile. */
  before?: { path: RegExp; run: () => Promise<void> };
  /** The model variant's file groups, in place of its one. */
  groups?: { id: number; name: string }[];
};

const freshState = (state: Partial<State> = {}): State => ({ owned: new Set([STL_VARIANT]), cart: [], ...state });

function cartAnswer(state: State) {
  const cart = loadFixture("pixup3d", "cart");
  const variant = cart.cart.variants[0];
  const total = state.cart.reduce((sum, item) => sum + Number(item.price), 0);
  return {
    ...cart,
    cart: {
      ...cart.cart,
      variants: state.cart.map((item) => ({ ...variant, id: Number(item.id), price: item.price })),
    },
    // As PIXUP answers an empty cart: with no order at all, rather than one for $0.
    order: state.cart.length ? { ...cart.order, total_price: total.toFixed(1), final_price: total.toFixed(1) } : null,
  };
}

function handlerFor(scenario: string, state: State = freshState()): FetchHandler {
  const signedIn = (call: RecordedCall) =>
    scenario !== "rejected" && [SESSION, RENEWED].some((s) => call.headers.cookie === `_phrozen_session=${s}`);
  const answer = (res: Response, call: RecordedCall): Response => {
    if (state.renews && signedIn(call))
      res.headers.append("set-cookie", `_phrozen_session=${RENEWED}; path=/; HttpOnly`);
    return res;
  };
  return async (call) => {
    const { url, method } = call;
    if (state.before?.path.test(url.pathname)) await state.before.run();
    if (url.hostname === "file.pixup3d.com" && url.pathname.endsWith("/package.zip")) {
      return binary(
        await zip("pixup3d:files", {
          "18750_Phrozen XP Finder.stl": stl("xp-finder"),
          "18751_Instructions.pdf": Buffer.from("%PDF-1.4\n%%EOF\n"),
        }),
      );
    }
    if (url.hostname !== "pixup3d.com") return undefined;
    const p = url.pathname;
    const me = signedIn(call);
    const unauthorized = () => json({ error: "Unauthorized" }, 401);
    if (p === `${API}/posts/${POST}`) {
      if (scenario === "missing") return json({ error: "Not Found" }, 404);
      const post = loadFixture("pixup3d", "post");
      if (state.groups) {
        const models = post.data.variants.find((each: { id: number }) => String(each.id) === STL_VARIANT);
        models.file_groups = state.groups;
      }
      return json(post);
    }
    if (p === `${API}/posts/${PAID_POST}`) return json(loadFixture("pixup3d", "post-paid"));
    if (p.startsWith(`${API}/posts/`)) return json({ error: "Not Found" }, 404);
    if (p === `/en/posts/${POST}`) {
      const page = loadFixtureHtml("pixup3d", "page");
      return html(state.packaging ? page.replace("<main>", "<main><p>Your files are still being packaged.</p>") : page);
    }
    if (p === `/en/posts/${PAID_POST}`) return html(loadFixtureHtml("pixup3d", "page-paid"));
    if (/^\/en\/posts\/\d+$/.test(p)) return redirect("https://pixup3d.com/");
    if (p === `${API}/profile/current_user`)
      return me ? answer(json(loadFixture("pixup3d", "me")), call) : unauthorized();
    const variant = p.match(/^\/api\/v1\/post_variants\/(\d+)$/);
    if (variant) {
      const data = loadFixture("pixup3d", "variant").data;
      return answer(
        json({
          data: {
            ...data,
            id: Number(variant[1]),
            purchased: me && state.owned.has(variant[1]),
            in_cart: me && state.cart.some((item) => item.id === variant[1]),
          },
        }),
        call,
      );
    }
    if (p === `${API}/profile/purchased_variants`) {
      if (!me) return unauthorized();
      const library = loadFixture("pixup3d", "library");
      const [item] = library.data;
      const pages = state.libraryPages ?? 1;
      const page = Number(url.searchParams.get("page") ?? "1");
      const items =
        page !== pages
          ? []
          : [...state.owned].map((id) => {
              const owned = structuredClone(item);
              owned.id = Number(id);
              owned.post.id = POST_OF[id];
              return owned;
            });
      return answer(
        json({
          ...library,
          data: items,
          pagination: { current_page: page, total_pages: pages, per_page: 24, total_count: items.length },
        }),
        call,
      );
    }
    if (p === `${API}/cart/current_post_cart`) {
      if (!me) return unauthorized();
      const cart = cartAnswer(state);
      return answer(json(state.cartAnswer ? state.cartAnswer(cart) : cart), call);
    }
    if (p === "/cart" && method === "GET") {
      return me
        ? answer(html(loadFixtureHtml("pixup3d", "cart-page")), call)
        : redirect("https://pixup3d.com/users/sign_in");
    }
    const inCart = p.match(/^\/api\/v1\/cart\/variants\/(\d+)$/);
    if (inCart) {
      if (!me) return unauthorized();
      if (call.headers["x-csrf-token"] !== TOKEN) return json({ error: "Invalid authenticity token" }, 422);
      // As PIXUP answers: 201 for one put in, `success` for one taken out.
      if (method === "POST") {
        state.cart.push({ id: inCart[1], price: "0.0" });
        return answer(json({ status: "ok", cart_item_count: state.cart.length }, 201), call);
      }
      state.cart = state.cart.filter((item) => item.id !== inCart[1]);
      return answer(json({ success: true }), call);
    }
    if (p === "/cart/checkout" && method === "POST") {
      if (!me) return redirect("https://pixup3d.com/users/sign_in");
      if (new URLSearchParams(call.body ?? "").get("authenticity_token") !== TOKEN) return html("Unprocessable", 422);
      // A payment page takes nothing until it's paid.
      if (state.checkoutTo) return answer(redirect(state.checkoutTo), call);
      // As PIXUP does: a $0 checkout goes on to its success page, and only opening that finishes the order.
      state.ordered = state.cart;
      state.cart = [];
      return answer(redirect("https://pixup3d.com/order/checkout_succeeded?order_number=PO0001"), call);
    }
    if (p === "/order/checkout_succeeded") {
      if (!me) return redirect("https://pixup3d.com/users/sign_in");
      for (const item of state.ordered ?? []) state.owned.add(item.id);
      state.ordered = [];
      return answer(redirect("https://pixup3d.com/profile/libraries"), call);
    }
    if (p === "/profile/libraries" || p === "/en/cart") return answer(html("<main></main>"), call);
    const download = p.match(/^\/posts\/(\d+)\/download$/);
    if (download) {
      if (!me) return redirect("https://pixup3d.com/users/sign_in");
      const variantId = url.searchParams.get("post_variant_id")!;
      if (!state.owned.has(variantId)) return redirect("https://pixup3d.com/p/Phrozen");
      if (state.packaging) return answer(redirect(`https://pixup3d.com/en/posts/${download[1]}`), call);
      return answer(redirect(fileUrl(url.searchParams.get("file_group_id")!)), call);
    }
    if (p === `${API}/profiles/${ME}/get_saved_posts`) {
      if (scenario === "gone") return json({ error: "Not Found" }, 404);
      return json(loadFixture("pixup3d", url.searchParams.get("page") === "2" ? "wishlist-2" : "wishlist"));
    }
    if (
      p === `${API}/profiles/${ME}/get_designer_collections` ||
      p === `${API}/profiles/${DESIGNER}/get_designer_collections`
    ) {
      return json(loadFixture("pixup3d", "collections"));
    }
    if (p === `/en/p/${DESIGNER}/collections/5`) return answer(html(loadFixtureHtml("pixup3d", "collection")), call);
    if (/^\/en\/p\/[^/]+\/collections\/\d+$/.test(p)) return html("<h1>Not Found</h1>", 404);
    if (p === `${API}/profiles/${DESIGNER}/get_posts_by_ids`) {
      const wanted = new Set(url.searchParams.getAll("ids[]"));
      const posts = loadFixture("pixup3d", "collection-posts");
      const found = posts.data.filter((post: { id: number }) => wanted.has(String(post.id)));
      return answer(json({ ...posts, data: found }), call);
    }
    if (p.startsWith(`${API}/profiles/`)) return json({ error: "Not Found" }, 404);
    if (p === `${API}/posts`) return json(loadFixture("pixup3d", "trending"));
    return undefined;
  };
}

const ACCOUNT = { username: ME, name: "Maker One" };
const connect = (userId: string, account: typeof ACCOUNT | null = ACCOUNT) =>
  setUserPixup3dSession(userId, { session: SESSION }, account && { ...account });

const spec: ProviderContractSpec = {
  id: "pixup3d",
  name: "PIXUP",
  modelUrl: MODEL_URL,
  expected: {
    externalId: POST,
    title: "Phrozen XP Finder",
    notesIncludes: "The Phrozen XP Finder is a free 3D print test model",
    author: "Phrozen",
    // As the library keeps them: title-cased, its size label (`S: <7 cm`) left out.
    tags: ["Other", "Tool"],
    category: { name: "Gadgets", parent: "Tools" },
    galleryImages: 1,
    // Its STL variant's one file group; the sliced variant has no model files.
    plateInstanceIds: [null],
    plateFilenames: ["Phrozen XP Finder.stl"],
  },
  connect: (userId) => connect(userId),
  disconnect: async (userId) => {
    await setUserPixup3dSession(userId, null);
  },
  createHandler: (scenario) => handlerFor(scenario),
  credentials: {
    sessionCode: "pixup3d_session",
    connection: async (userId) => (await getPixup3dConnection(userId)).state,
  },
  reimport: {},
  list: {
    endpoint: "/api/import/pixup3d/list/entries",
    url: WISHLIST_URL,
    title: `PIXUP wishlist (@${ME})`,
    importedId: GUNDAM,
    freshId: POST,
  },
  // Anyone's wishlist is anyone's to read, but which of its paid models the user owns takes their sign-in: the ones
  // they haven't bought are left out.
  listing: {
    sync: { externalId: `likes:${ME}`, sourceUrl: WISHLIST_URL },
    ids: [GUNDAM, POST],
    needsSignIn: true,
  },
};

const ctx = describeProviderContract(spec);

const callsTo = (calls: RecordedCall[], path: string | RegExp) =>
  calls.filter((call) => (typeof path === "string" ? call.url.pathname === path : path.test(call.url.pathname)));

describe("PIXUP specifics", () => {
  it("answers a model PIXUP doesn't have with 404", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expect((await ctx.importUrl("https://pixup3d.com/en/posts/999999")).status).toBe(404);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("keeps what matters for printing it, and downloads only the variant with model files", async () => {
    await connect(ctx.userId);
    const stub = ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    expect(print.notes).toContain("## Model details");
    expect(print.notes).toContain("**Formats:** STL, CTB");
    expect(print.notes).toContain("**Options:** STL from Designer (free), Ready-to-Print File (free)");
    const downloads = callsTo(stub.calls, `/posts/${POST}/download`);
    expect(downloads.map((call) => Object.fromEntries(call.url.searchParams))).toEqual([
      { post_variant_id: STL_VARIANT, file_group_id: STL_GROUP },
    ]);
    expect(downloads.map((call) => call.headers.cookie)).toEqual([`_phrozen_session=${SESSION}`]);
    // Owned already: nothing goes near the cart.
    expect(callsTo(stub.calls, /cart/)).toEqual([]);
  });

  it("orders a free model the user doesn't own yet for $0, as its Download button does, then downloads it", async () => {
    await connect(ctx.userId);
    const state = freshState({ owned: new Set() });
    const stub = ctx.install(handlerFor("ok", state));
    expectStatus(await ctx.importUrl(), 200);
    expect(await ctx.prints()).toHaveLength(1);
    const added = callsTo(stub.calls, `${API}/cart/variants/${STL_VARIANT}`);
    expect(added.map((call) => [call.method, call.headers["x-csrf-token"]])).toEqual([["POST", TOKEN]]);
    const checkout = callsTo(stub.calls, "/cart/checkout");
    expect(checkout).toHaveLength(1);
    expect(new URLSearchParams(checkout[0].body!).get("authenticity_token")).toBe(TOKEN);
    // Its success page, opened with the sign-in, is what finished the order.
    const succeeded = callsTo(stub.calls, "/order/checkout_succeeded");
    expect(succeeded.map((call) => call.url.search)).toEqual(["?order_number=PO0001"]);
    expect(succeeded[0].headers.cookie).toBe(`_phrozen_session=${SESSION}`);
    expect(state.owned.has(STL_VARIANT)).toBe(true);
    // The sliced variant was never ordered.
    expect(callsTo(stub.calls, /\/cart\/variants\/892$/)).toEqual([]);
  });

  // A variant's file groups are what its designer split it into, supported and not: each a folder of the model's, one
  // left unnamed ("Default name") none.
  it("keeps each of a variant's file groups in a folder of its own", async () => {
    await connect(ctx.userId);
    const groups = [
      { id: 2763, name: "STL_Unsupported" },
      { id: 2764, name: "STL_Pre-supported" },
      { id: 2765, name: "Default name" },
    ];
    ctx.install(handlerFor("ok", freshState({ groups })));
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
    expect(plates.map((plate) => [plate.folder, plate.filename])).toEqual([
      ["STL_Unsupported", "Phrozen XP Finder.stl"],
      ["STL_Pre-supported", "Phrozen XP Finder.stl"],
      [null, "Phrozen XP Finder.stl"],
    ]);
  });

  it("names the files as their designer did, without the upload numbers PIXUP's zip puts in front", async () => {
    await connect(ctx.userId);
    ctx.stub("ok");
    expectStatus(await ctx.importUrl(), 200);
    const [print] = await ctx.prints();
    const plates = await prisma.plate.findMany({ where: { printId: print.id } });
    expect(plates.map((plate) => plate.filename)).toEqual(["Phrozen XP Finder.stl"]);
  });

  it("says so when PIXUP sends a $0 checkout to a payment page rather than the library", async () => {
    await connect(ctx.userId);
    const state = freshState({ owned: new Set(), checkoutTo: "https://checkout.stripe.com/c/pay/cs_test" });
    ctx.install(handlerFor("ok", state));
    await expect(placePixup3dFreeOrder([STL_VARIANT], { session: SESSION })).rejects.toThrow(
      "PIXUP asked for payment instead of taking the free order (sent to checkout.stripe.com)",
    );
    // What it put in comes out again, so the cart is as it was.
    expect(state.cart).toEqual([]);

    // As it does when PIXUP sends the checkout back to one of its own pages without taking the order.
    const back = freshState({ owned: new Set(), checkoutTo: "https://pixup3d.com/en/cart" });
    ctx.install(handlerFor("ok", back));
    await expect(placePixup3dFreeOrder([STL_VARIANT], { session: SESSION })).rejects.toThrow(
      /isn't in your library yet/,
    );
    expect(back.cart).toEqual([]);
  });

  it("doesn't check out a cart holding a paid model, and takes back nothing it didn't put in", async () => {
    await connect(ctx.userId);
    const state = freshState({ owned: new Set(), cart: [{ id: "555", price: "9.0" }] });
    const stub = ctx.install(handlerFor("ok", state));
    const res = await ctx.importUrl();
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/cart has paid models/);
    expect(callsTo(stub.calls, /\/cart\/variants\//)).toEqual([]);
    expect(callsTo(stub.calls, "/cart/checkout")).toEqual([]);
    expect(state.cart).toEqual([{ id: "555", price: "9.0" }]);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("refuses a paid model the user hasn't bought, and imports one they have", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", freshState({ owned: new Set() })));
    const refused = await ctx.importUrl(`https://pixup3d.com/en/posts/${PAID_POST}`);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toMatch(/paid PIXUP model \(\$25\.00\)/);

    const stub = ctx.install(handlerFor("ok", freshState({ owned: new Set([PAID_VARIANT]) })));
    expectStatus(await ctx.importUrl(`https://pixup3d.com/en/posts/${PAID_POST}`), 200);
    expect(callsTo(stub.calls, "/cart/checkout")).toEqual([]);
  });

  it("asks to come back while PIXUP is still packaging the files", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", freshState({ packaging: true })));
    const res = await ctx.importUrl();
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/still packaging/);
    expect(await ctx.prints()).toHaveLength(0);
  });

  it("keeps the newer session PIXUP answers with, unless another was stored meanwhile", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", freshState({ renews: true })));
    expectStatus(await ctx.importUrl(), 200);
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "pixup3d" },
    });
    expect(row.secret).toEqual({ session: RENEWED });
    expect((await getPixup3dConnection(ctx.userId)).state).toBe("connected");

    // Grab saves a new sign-in while the import is out: the one PIXUP renewed for the import doesn't replace it.
    await prisma.print.deleteMany({ where: { userId: ctx.userId, sourceProvider: "pixup3d" } });
    await connect(ctx.userId);
    const replace = { path: /\/download$/, run: () => setUserPixup3dSession(ctx.userId, { session: OTHER }) };
    ctx.install(handlerFor("ok", freshState({ renews: true, before: replace })));
    expectStatus(await ctx.importUrl(), 200);
    const kept = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "pixup3d" },
    });
    expect(kept.secret).toEqual({ session: OTHER });
  });

  it("refuses a cart it can't read, rather than taking it for an empty one", async () => {
    await connect(ctx.userId);
    type Answer = ReturnType<typeof cartAnswer>;
    const failed = () => ({ error: "Something went wrong" });
    const unpriced = (answer: Answer) => ({
      ...answer,
      cart: { ...answer.cart, variants: answer.cart.variants.map((v: object) => ({ ...v, price: undefined })) },
    });
    const broken: ((answer: Answer) => unknown)[] = [
      failed,
      (answer) => ({ ...answer, order: { ...answer.order, final_price: "" } }),
      (answer) => ({ ...answer, cart: { ...answer.cart, variants: [null] } }),
    ];
    for (const answerWith of broken) {
      const state = freshState({ owned: new Set(), cartAnswer: answerWith });
      const stub = ctx.install(handlerFor("ok", state));
      expect((await ctx.importUrl()).status).toBeGreaterThanOrEqual(400);
      expect(callsTo(stub.calls, /\/cart\/variants\//)).toEqual([]);
      expect(callsTo(stub.calls, "/cart/checkout")).toEqual([]);
    }

    // Nor one it can't read once it's put the model in, which comes out again: a price left out isn't $0, and a cart
    // that doesn't list what was put in isn't the one checkout would take.
    const missing = (answer: Answer) => ({ ...answer, cart: { ...answer.cart, variants: [] } });
    // No order is how an empty cart is answered, not one with something in it.
    const unordered = (answer: Answer) => ({ ...answer, order: null });
    const brokenAfter: ((answer: Answer) => unknown)[] = [unpriced, failed, missing, unordered];
    for (const after of brokenAfter) {
      let reads = 0;
      const state = freshState({
        owned: new Set(),
        cartAnswer: (answer) => (++reads > 1 ? after(answer) : answer),
      });
      const stub = ctx.install(handlerFor("ok", state));
      expect((await ctx.importUrl()).status).toBeGreaterThanOrEqual(400);
      expect(callsTo(stub.calls, `${API}/cart/variants/${STL_VARIANT}`).map((call) => call.method)).toEqual([
        "POST",
        "DELETE",
      ]);
      expect(callsTo(stub.calls, "/cart/checkout")).toEqual([]);
      expect(state.cart).toEqual([]);
    }
  });

  it("checks what it put in the cart is free as the cart prices it, and takes it out again if not", async () => {
    await connect(ctx.userId);
    // Free on the model's page, but the cart prices it: a promotion brings the total to $0 all the same.
    const pricedByCart = (answer: ReturnType<typeof cartAnswer>) => ({
      ...answer,
      cart: { ...answer.cart, variants: answer.cart.variants.map((v: object) => ({ ...v, price: "3.0" })) },
    });
    const state = freshState({ owned: new Set(), cartAnswer: pricedByCart });
    const stub = ctx.install(handlerFor("ok", state));
    const res = await ctx.importUrl();
    expect(res.status).toBe(409);
    expect(callsTo(stub.calls, `${API}/cart/variants/${STL_VARIANT}`).map((call) => call.method)).toEqual([
      "POST",
      "DELETE",
    ]);
    expect(callsTo(stub.calls, "/cart/checkout")).toEqual([]);
    expect(state.cart).toEqual([]);
  });

  it("marks the paid models of a list the user hasn't bought", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", freshState({ owned: new Set() })));
    const list = await ctx.post(spec.list!.endpoint, { url: WISHLIST_URL });
    expectStatus(list, 200);
    const blocked = (list.body.entries as { design_id: string; blocked?: string }[]).map((e) => [
      e.design_id,
      e.blocked,
    ]);
    expect(blocked).toEqual([
      [GUNDAM, undefined],
      [POST, undefined],
      [XENO, "paid"],
    ]);

    const unblocked = [
      [GUNDAM, undefined],
      [POST, undefined],
      [XENO, undefined],
    ];
    const marks = (res: { body: { entries: { design_id: string; blocked?: string }[] } }) =>
      res.body.entries.map((e) => [e.design_id, e.blocked]);
    ctx.install(handlerFor("ok", freshState({ owned: new Set([XENO]) })));
    expect(marks(await ctx.post(spec.list!.endpoint, { url: WISHLIST_URL }))).toEqual(unblocked);

    // However far down a long library the purchase is.
    ctx.install(handlerFor("ok", freshState({ owned: new Set([XENO]), libraryPages: 60 })));
    expect(marks(await ctx.post(spec.list!.endpoint, { url: WISHLIST_URL }))).toEqual(unblocked);
  });

  it("reads a collection in its own order, which its API doesn't keep", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", freshState({ owned: new Set() })));
    const list = await ctx.post(spec.list!.endpoint, { url: COLLECTION_URL });
    expectStatus(list, 200);
    expect(list.body.title).toBe("NPCs");
    expect(list.body.entries.map((e: { design_id: string }) => e.design_id)).toEqual([
      "4598",
      "4597",
      "4599",
      "4595",
      "4600",
      "4596",
    ]);
    expect(list.body.entries[1].title).toBe("Female Medieval Peasant - Clio Bill - Terrified");

    ctx.stub("ok");
    const gone = await ctx.post(spec.list!.endpoint, { url: `https://pixup3d.com/en/p/${DESIGNER}/collections/99` });
    expect(gone.status).toBe(404);
  });

  it("syncs a collection's models the user can import: its paid ones once bought", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", freshState({ owned: new Set() })));
    const sync = { userId: ctx.userId, provider: "pixup3d", externalId: `${DESIGNER}/5`, sourceUrl: COLLECTION_URL };
    expect(await fetchListing(sync)).toEqual([]);

    ctx.install(handlerFor("ok", freshState({ owned: new Set(["4598"]) })));
    expect(await fetchListing(sync)).toEqual(["4598"]);
  });

  it("keeps the newer session PIXUP answers a collection's read with", async () => {
    await connect(ctx.userId);
    ctx.install(handlerFor("ok", freshState({ renews: true })));
    expectStatus(await ctx.post(spec.list!.endpoint, { url: COLLECTION_URL }), 200);
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "pixup3d" },
    });
    expect(row.secret).toEqual({ session: RENEWED });
  });

  it("holds a collection's sync, rather than unsyncing it, when it's gone because the sign-in ran out", async () => {
    await connect(ctx.userId);
    const gone = {
      userId: ctx.userId,
      provider: "pixup3d",
      externalId: `${DESIGNER}/99`,
      sourceUrl: `https://pixup3d.com/en/p/${DESIGNER}/collections/99`,
    };
    ctx.stub("ok");
    expect(await fetchListing(gone)).toBeNull();
    ctx.stub("rejected");
    await expect(fetchListing(gone)).rejects.toThrow(/didn't accept your sign-in/);
  });

  it("keeps whose a sign-in is only while it's still the one stored", async () => {
    // A new sign-in saved while the check is out: the check's answer is about the old one, so nothing comes of it.
    await connect(ctx.userId, null);
    const replace = { path: /current_user$/, run: () => setUserPixup3dSession(ctx.userId, { session: OTHER }) };
    ctx.install(handlerFor("ok", freshState({ before: replace })));
    expect(await pixup3dMemberOf(ctx.userId)).toBeNull();
    const row = await prisma.providerConnection.findFirstOrThrow({
      where: { userId: ctx.userId, provider: "pixup3d" },
    });
    expect([row.secret, row.accountId]).toEqual([{ session: OTHER }, null]);

    // Nor does turning the old one down mark the new one expired.
    await connect(ctx.userId, null);
    ctx.install(handlerFor("rejected", freshState({ before: replace })));
    expect(await pixup3dMemberOf(ctx.userId)).toBeNull();
    expect((await getPixup3dConnection(ctx.userId)).state).toBe("connected");
  });

  it("marks a sign-in PIXUP turns down expired, but not a newer one saved while it was out", async () => {
    const replaceAt = (path: RegExp) => ({
      path,
      run: () => setUserPixup3dSession(ctx.userId, { session: OTHER }),
    });
    const sync = { userId: ctx.userId, provider: "pixup3d", externalId: `${DESIGNER}/5`, sourceUrl: COLLECTION_URL };
    const state = async () => (await getPixup3dConnection(ctx.userId)).state;

    // A list's check of what the user owns.
    await connect(ctx.userId);
    ctx.install(handlerFor("rejected", freshState({ before: replaceAt(/purchased_variants$/) })));
    expectStatus(await ctx.post(spec.list!.endpoint, { url: WISHLIST_URL }), 200);
    expect(await state()).toBe("connected");
    await connect(ctx.userId);
    ctx.install(handlerFor("rejected"));
    expectStatus(await ctx.post(spec.list!.endpoint, { url: WISHLIST_URL }), 200);
    expect(await state()).toBe("expired");

    // A sync, which says to try again rather than hold every sync for a sign-in that's fine.
    await connect(ctx.userId);
    ctx.install(handlerFor("rejected", freshState({ before: replaceAt(/purchased_variants$/) })));
    await expect(fetchListing(sync)).rejects.toThrow(/replaced since/);
    expect(await state()).toBe("connected");
    await connect(ctx.userId);
    ctx.install(handlerFor("rejected"));
    await expect(fetchListing(sync)).rejects.toThrow(/didn't accept your sign-in/);
    expect(await state()).toBe("expired");

    // An import.
    await connect(ctx.userId);
    ctx.install(handlerFor("rejected", freshState({ before: replaceAt(/current_user$/) })));
    const res = await ctx.importUrl();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/replaced since/);
    expect(await state()).toBe("connected");
  });

  it("shows the user's wishlist and own collections in the Browse tab, by whom their sign-in says they are", async () => {
    await connect(ctx.userId, null);
    const stub = ctx.stub("ok");
    const cards = await pixup3dBrowse.cards(ctx.userId);
    expect(cards.map((card) => [card.id, card.name, card.modelCount, card.private])).toEqual([
      [`likes:${ME}`, `PIXUP wishlist (@${ME})`, 3, false],
      [`${ME}/5`, "NPCs", 6, false],
      [`${ME}/4`, "Creatures", 2, false],
      [`${ME}/3`, "Objects", 2, false],
      [`${ME}/2`, "Heroes", 40, false],
      [`${ME}/1`, "Bundles", 10, false],
    ]);
    expect(cards[1].url).toBe(`https://pixup3d.com/en/p/${ME}/collections/5`);
    expect(callsTo(stub.calls, `${API}/profile/current_user`)).toHaveLength(1);
    expect((await getPixup3dConnection(ctx.userId)).account).toEqual(ACCOUNT);

    await setUserPixup3dSession(ctx.userId, null);
    await expect(pixup3dBrowse.cards(ctx.userId)).rejects.toMatchObject({ status: 409 });
  });

  it("lists the week's most viewed models", async () => {
    const stub = ctx.stub("ok");
    const trending = await pixup3dTrending.fetch(ctx.userId, 3);
    expect(Array.isArray(trending) && trending.map((model) => [model.id, model.paid, model.author])).toEqual([
      [XENO, true, "Medieval Dog"],
      ["8695", true, "ETmodelstudio"],
      [GUNDAM, false, "MADWORKS"],
    ]);
    expect(stub.calls[0].url.searchParams.get("o")).toBe("most_views_w");
  });

  it("keeps a pasted sign-in with whose it is, and turns one PIXUP doesn't take down when asked to check", async () => {
    ctx.stub("ok");
    const pasted = `:authority\npixup3d.com\ncookie\nvisitor_hash=%A1b%C2%D3; _phrozen_session=${SESSION}\npragma\nno-cache`;
    expect(await pixup3dConnection.save(ctx.userId, { session: pasted, verify: true })).toEqual({ configured: true });
    expect(await getPixup3dConnection(ctx.userId)).toEqual({ state: "connected", account: ACCOUNT });

    await expect(
      pixup3dConnection.save(ctx.userId, { session: RENEWED.replace("cmVu", "eHh4"), verify: true }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(pixup3dConnection.save(ctx.userId, { session: "not a cookie", verify: true })).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("PIXUP pages", () => {
  it("takes every picture its structured data lists, named as uploaded, the cover first", () => {
    const page = loadFixtureHtml("pixup3d", "page-paid");
    const product = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    const gallery = pixup3dGalleryFrom(product);
    expect(gallery).toHaveLength(10);
    expect(gallery[0]).toEqual({
      url: "https://file.pixup3d.com/uploads/post_img/file/183204/x4_00_cover.jpg",
      filename: "00_cover.jpg",
    });
  });

  it("keeps a picture whose name has a stray percent sign, as written", () => {
    const gallery = pixup3dGalleryFrom({ image: ["https://file.pixup3d.com/uploads/post_img/file/11/x4_100%.jpg"] });
    expect(gallery.map((image) => image.filename)).toEqual(["100%.jpg"]);
  });

  it("tells pictures uploaded under the same name apart", () => {
    const gallery = pixup3dGalleryFrom({
      image: [
        "https://file.pixup3d.com/uploads/post_img/file/11/x4_2.jpg",
        "https://file.pixup3d.com/uploads/post_img/file/12/x4_2.jpg",
        "https://file.pixup3d.com/uploads/post_img/file/13/x4_Front%20View.jpg",
      ],
    });
    expect(gallery.map((image) => image.filename)).toEqual(["11-2.jpg", "12-2.jpg", "Front View.jpg"]);
  });

  it("reads a model's categories from its breadcrumb, the deepest first", () => {
    const resolved = pixup3dModelFrom(loadFixture("pixup3d", "post-paid"), loadFixtureHtml("pixup3d", "page-paid"));
    expect(resolved?.meta.siteCategoryIds).toEqual([11, 17]);
    expect(pixup3dCategoryIds(null)).toEqual([]);
  });

  it("keeps a model whose page can't be read, with its cover and no description", () => {
    const resolved = pixup3dModelFrom(loadFixture("pixup3d", "post"), null);
    expect(resolved?.meta.title).toBe("Phrozen XP Finder");
    expect(resolved?.meta.previewImageUrl).toMatch(/^https:\/\/file\.pixup3d\.com\/uploads\/post_img\/file\/18752\//);
    expect(resolved?.galleryImages).toEqual([]);
    expect(resolved?.meta.description).toContain("**Options:**");
  });

  it("reads the collection its page hands its script", () => {
    expect(pixup3dCollectionFromPage(loadFixtureHtml("pixup3d", "collection"))).toEqual({
      title: "NPCs",
      postIds: ["4598", "4597", "4599", "4595", "4600", "4596"],
      isPublic: true,
    });
    expect(pixup3dCollectionFromPage('collection: {"title":"A {braced} name","post_ids":[1]} }')).toEqual({
      title: "A {braced} name",
      postIds: ["1"],
      isPublic: true,
    });
    expect(pixup3dCollectionFromPage("<html></html>")).toBeNull();
  });

  it("leaves out the variants of nothing but sliced files", () => {
    const resolved = pixup3dModelFrom(loadFixture("pixup3d", "post"), null)!;
    expect(pixup3dImportableVariants(resolved.variants).map((variant) => variant.id)).toEqual([STL_VARIANT]);
  });
});

describe("PIXUP and the import line", () => {
  it("counts each of its answers as a sign of life for the import worker's watchdog", async () => {
    ctx.stub("ok");
    const activity = { lastActivity: 0 };
    await withImportActivity(activity, async () => {
      await resolvePixup3dModel(POST);
      expect(activity.lastActivity).toBeGreaterThan(0);
      // Each answer after the first too: a long run of variant reads keeps the import alive.
      for (const variant of [STL_VARIANT, "892"]) {
        activity.lastActivity = 0;
        await fetchPixup3dVariantState(variant, { session: SESSION });
        expect(activity.lastActivity).toBeGreaterThan(0);
      }
    });
  });
});

describe("PIXUP files", () => {
  it("takes the upload numbers off a zip's files only when every one of them has one", () => {
    const named = (...names: string[]) => names.map((filename) => ({ filename }));
    expect(withoutUploadNumbers(named("182652_01_Keychain.3mf", "182653_02_Base.stl"))).toEqual(
      named("01_Keychain.3mf", "02_Base.stl"),
    );
    expect(withoutUploadNumbers(named("182652_Keychain.3mf", "Base.stl"))).toEqual(
      named("182652_Keychain.3mf", "Base.stl"),
    );
    expect(withoutUploadNumbers(named("2024_bracket.stl"))).toEqual(named("2024_bracket.stl"));
    expect(withoutUploadNumbers(named("182652_2024_bracket.stl"))).toEqual(named("2024_bracket.stl"));
  });
});

describe("PIXUP sign-in", () => {
  it("picks the session out of a Cookie header, or takes its bare value, as written", () => {
    expect(normalizePixup3dSession(`visitor_hash=%A1b; _phrozen_session=${SESSION}`)).toEqual({ session: SESSION });
    expect(normalizePixup3dSession(` ${SESSION} `)).toEqual({ session: SESSION });
    expect(normalizePixup3dSession("visitor_hash=%A1b")).toBeNull();
    expect(normalizePixup3dSession("")).toBeNull();
    expect(normalizePixup3dSession(null)).toBeNull();
  });

  it("reads the session a response sets, and not one it clears", () => {
    const set = new Headers();
    set.append("set-cookie", "visitor_hash=abc; path=/");
    set.append("set-cookie", `_phrozen_session=${RENEWED}; path=/; HttpOnly; SameSite=Lax`);
    expect(renewedSession(set)).toBe(RENEWED);
    const cleared = new Headers({ "set-cookie": "_phrozen_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT" });
    expect(renewedSession(cleared)).toBeNull();
  });
});
