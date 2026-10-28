import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Cults3dAuthError,
  Cults3dBlockedError,
  cults3dFreeOrderForm,
  Cults3dNoFreeDownloadError,
  cults3dMetaFromCreation,
  cults3dModelUrl,
  cults3dNumericId,
  cults3dOriginalImage,
  Cults3dSessionError,
  cults3dSignedInNick,
  Cults3dWrongAccountError,
  fetchCults3dLikes,
  fetchCults3dOrders,
  fetchCults3dSignedInNick,
  isCults3dFileHost,
  parseCults3dLikesUrl,
  parseCults3dModelUrl,
  parseCults3dPrintlistUrl,
  placeCults3dFreeOrder,
  resolveCults3dDownload,
  resolveCults3dModel,
} from "../src/providers/cults3d/api";
import { modelIdFromUrl, modelUrlFor, parseSyncSource } from "../src/services/collectionSyncService";
import { normalizeCults3dBrowser } from "../src/providers/cults3d/session";
import { buildImportSourceUrl, identifySourceModel } from "../src/services/importService";
import { syncLikesUsername } from "../src/dto";

// The Cults3D client against the shapes its API and site give back, with fetch mocked. No database.

const CREDENTIALS = { nick: "Maker", apiKey: "secret" };
const BROWSER = {
  session: "a823b7a79d7156fe6eef032de8827999",
  clearance: "wmNqDF.jZwItqtSCGKAz749QYyvhuCD0stC6MC-1792449123-1.2.1.1-_Sef40o9",
  userAgent: "Mozilla/5.0 X",
};

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

type Call = { url: URL; method: string; headers: Record<string, string>; body: string | null };

/** Answers each call with the next of `answers`; records what was sent. */
function stubFetch(...answers: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const call: Call = {
        url: new URL(url),
        method: init.method ?? "GET",
        headers: (init.headers ?? {}) as Record<string, string>,
        body: typeof init.body === "string" ? init.body : null,
      };
      calls.push(call);
      const answer = answers[calls.length - 1];
      if (!answer) throw new Error(`unexpected call ${call.method} ${call.url}`);
      return answer(call);
    }),
  );
  return calls;
}

/** What a GraphQL call asked: its query and variables. */
function graphqlOf(call: Call): { query: string; variables: Record<string, unknown> } {
  return JSON.parse(call.body ?? "{}");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Cults3D URLs", () => {
  it("recognizes model pages in every language, and their short form", () => {
    expect(parseCults3dModelUrl("https://cults3d.com/en/3d-model/art/ghostship-benchy")).toEqual({
      slug: "ghostship-benchy",
    });
    expect(parseCults3dModelUrl("https://cults3d.com/fr/mod%C3%A8le-3d/art/ghostship-benchy?ref=x")).toEqual({
      slug: "ghostship-benchy",
    });
    expect(parseCults3dModelUrl("https://cults3d.com/zh/3d-m%C3%B3x%C3%ADng/y%C3%ACsh%C3%B9/ghostship-benchy")).toEqual(
      {
        slug: "ghostship-benchy",
      },
    );
    expect(parseCults3dModelUrl("https://cults3d.com/en/creations/ghostship-benchy")).toEqual({
      slug: "ghostship-benchy",
    });
    expect(parseCults3dModelUrl("https://cults3d.com/en/creations/latest")).toBeNull();
    expect(parseCults3dModelUrl("https://cults3d.com/en/users/Maker/likes")).toBeNull();
    expect(parseCults3dModelUrl("https://example.com/en/3d-model/art/ghostship-benchy")).toBeNull();
  });

  it("identifies imported models by slug, and links back to them", () => {
    const url = "https://cults3d.com/de/modell-3d/kunst/ghostship-benchy";
    expect(identifySourceModel(url)).toEqual({ provider: "cults3d", externalId: "ghostship-benchy" });
    expect(buildImportSourceUrl("cults3d", "ghostship-benchy")).toBe(cults3dModelUrl("ghostship-benchy"));
    expect(modelIdFromUrl("cults3d", modelUrlFor("cults3d", "ghostship-benchy"))).toBe("ghostship-benchy");
  });

  it("recognizes likes and printlists, and syncs them", () => {
    expect(parseCults3dLikesUrl("https://cults3d.com/it/utenti/Maker/mi-piace")).toEqual({ nick: "Maker" });
    expect(parseCults3dPrintlistUrl("https://cults3d.com/de/drucklisten/Maker/My-Saves")).toEqual({
      nick: "Maker",
      slug: "My-Saves",
      key: "maker/my-saves",
      url: "https://cults3d.com/en/design-collections/Maker/My-Saves",
    });

    const likes = parseSyncSource("https://cults3d.com/en/users/Maker/likes");
    expect(likes).toEqual({
      provider: "cults3d",
      externalId: "likes:maker",
      url: "https://cults3d.com/en/users/Maker/likes",
      likesOf: "Maker",
    });
    expect(syncLikesUsername({ externalId: likes!.externalId, sourceUrl: likes!.url })).toBe("Maker");
    expect(parseSyncSource("https://cults3d.com/en/design-collections/Maker/freebies")).toMatchObject({
      provider: "cults3d",
      externalId: "maker/freebies",
    });
  });

  it("only takes files from its CloudFront host and its own Scaleway bucket", () => {
    expect(isCults3dFileHost("download.cults3d.com")).toBe(true);
    expect(isCults3dFileHost("s3.fr-par.scw.cloud")).toBe(true);
    expect(isCults3dFileHost("cults3d.com")).toBe(false);
    expect(isCults3dFileHost("download.cults3d.com.evil.test")).toBe(false);
  });
});

describe("Cults3D sign-in", () => {
  it("reads the session, clearance and User-Agent from a Cookie header or copied request headers", () => {
    expect(normalizeCults3dBrowser(`cf_clearance=${BROWSER.clearance}; _session_id=${BROWSER.session}`, "UA")).toEqual({
      session: BROWSER.session,
      clearance: BROWSER.clearance,
      userAgent: "UA",
    });
    // As Chrome's DevTools copies them: each name and value on lines of their own.
    const copied = `cookie\nusprivacy=1---; cf_clearance=${BROWSER.clearance}; _session_id=${BROWSER.session}\nuser-agent\nMozilla/5.0 (Macintosh) Chrome/152\n`;
    expect(normalizeCults3dBrowser(copied)).toEqual({
      session: BROWSER.session,
      clearance: BROWSER.clearance,
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/152",
    });
    expect(normalizeCults3dBrowser(`Cookie: _session_id=${BROWSER.session}\nUser-Agent: Mozilla/5.0 Y`)).toEqual({
      session: BROWSER.session,
      clearance: null,
      userAgent: "Mozilla/5.0 Y",
    });
    expect(normalizeCults3dBrowser(`cf_clearance=${BROWSER.clearance}`)).toBeNull();
  });

  // The header's own menu, as a signed-in page carries it: the avatar is the one place it names the user.
  const header =
    '<img alt="TautvydasUk" width="22" height="22" class="drop-toggle-avatar" title="Manage my profile" ' +
    'src="https://assets.cults3d.com/assets/avatars/cults-avatar-69.webp" />' +
    '<a class="drop-option icon-and-text" href="/en/users/TautvydasUk">Profile</a>';

  it("reads whose sign-in it is from the header's avatar, and nothing from a signed-out page", () => {
    expect(cults3dSignedInNick(header)).toBe("TautvydasUk");
    expect(cults3dSignedInNick('<img alt="Maker &amp; Co" class="x drop-toggle-avatar y">')).toBe("Maker & Co");
    // Another avatar on the page, a designer's, isn't the one signed in.
    expect(cults3dSignedInNick('<img alt="SomeDesigner" class="avatar-image">')).toBeNull();
    expect(cults3dSignedInNick("<html><body>Sign in</body></html>")).toBeNull();
  });

  it("asks the site who the sign-in is, and calls one it shows no user for ended", async () => {
    const calls = stubFetch(() => new Response(header, { status: 200 }));
    expect(await fetchCults3dSignedInNick(BROWSER)).toBe("TautvydasUk");
    expect(calls[0].url.toString()).toBe("https://cults3d.com/en/orders");
    expect(calls[0].headers.Cookie).toBe(`_session_id=${BROWSER.session}; cf_clearance=${BROWSER.clearance}`);
    stubFetch(() => new Response("<html></html>", { status: 200 }));
    await expect(fetchCults3dSignedInNick(BROWSER)).rejects.toBeInstanceOf(Cults3dSessionError);
    stubFetch(() => redirect("https://cults3d.com/en/log-in-choice"));
    await expect(fetchCults3dSignedInNick(BROWSER)).rejects.toBeInstanceOf(Cults3dSessionError);
  });
});

describe("Cults3D model details", () => {
  const creation = {
    slug: "ghostship-benchy",
    name: "Ghostship Benchy",
    description: "A benchy.\r\nBoooo",
    details: "Supports: none",
    tags: ["benchy", "ghost", "benchy"],
    price: { cents: 0, formatted: "€ 0.00" },
    category: { id: "Q2F0ZWdvcnkvMjM" },
    subCategories: [{ id: "Q2F0ZWdvcnkvNDM" }],
    illustrations: [
      { imageUrl: "https://videos.cults3d.com/x=/516x516/filters:no_upscale()/https://fbi.cults3d.com/u/1/turn.mp4" },
      {
        imageUrl:
          "https://images.cults3d.com/y=/516x516/filters:no_upscale()/https://fbi.cults3d.com/uploaders/1/illustration-file/a/Ghost_Benchy.jpg",
      },
    ],
    creator: { nick: "3rdesignworks", imageUrl: "https://images.cults3d.com/avatar.jpg", bio: "Hi", url: null },
  };

  it("reads ids out of the API's base64 ones, and full-size pictures out of its thumbnails", () => {
    expect(cults3dNumericId("Q2F0ZWdvcnkvMjM")).toBe(23);
    expect(cults3dNumericId("nonsense")).toBeNull();
    expect(cults3dOriginalImage(creation.illustrations[1].imageUrl)).toBe(
      "https://fbi.cults3d.com/uploaders/1/illustration-file/a/Ghost_Benchy.jpg",
    );
  });

  it("maps the details, its categories most specific first and the designer, leaving videos out", () => {
    const resolved = cults3dMetaFromCreation(creation)!;
    expect(resolved.slug).toBe("ghostship-benchy");
    expect(resolved.priceCents).toBe(0);
    expect(resolved.priceText).toBeNull();
    expect(resolved.meta).toMatchObject({
      title: "Ghostship Benchy",
      description: "A benchy.\nBoooo\n\n### 3D printing settings\n\nSupports: none",
      tags: ["benchy", "ghost"],
      previewImageUrl: "https://fbi.cults3d.com/uploaders/1/illustration-file/a/Ghost_Benchy.jpg",
      siteCategoryIds: [43, 23],
      categorySite: "cults3d",
      creator: "3rdesignworks",
    });
    expect(resolved.meta.author).toMatchObject({ provider: "cults3d", externalId: "3rdesignworks" });
    expect(resolved.galleryImages).toEqual([
      { url: "https://fbi.cults3d.com/uploaders/1/illustration-file/a/Ghost_Benchy.jpg", filename: "Ghost_Benchy.jpg" },
    ]);
    expect(cults3dMetaFromCreation({ ...creation, price: { cents: 299, formatted: "€ 2.99" } })?.priceText).toBe(
      "€ 2.99",
    );
  });

  it("asks the API with the user's nickname and key, and tells a missing model and a rejected key apart", async () => {
    const calls = stubFetch(
      () => json({ data: { creation } }),
      () => json({ data: { creation: null } }),
      () => new Response("HTTP Basic: Access denied.", { status: 401 }),
    );
    expect((await resolveCults3dModel("ghostship-benchy", CREDENTIALS))?.meta.title).toBe("Ghostship Benchy");
    expect(calls[0].url.toString()).toBe("https://cults3d.com/graphql");
    expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from("Maker:secret").toString("base64")}`);
    expect(graphqlOf(calls[0]).variables).toEqual({ slug: "ghostship-benchy" });
    expect(await resolveCults3dModel("gone", CREDENTIALS)).toBeNull();
    await expect(resolveCults3dModel("x", CREDENTIALS)).rejects.toBeInstanceOf(Cults3dAuthError);
  });

  it("waits out the rate limit once it says when it resets", async () => {
    const reset = new Date(Date.now() + 50).toISOString();
    stubFetch(
      () => json({}, 429, { "x-ratelimit-reset": reset }),
      () => json({ data: { creation } }),
    );
    expect((await resolveCults3dModel("ghostship-benchy", CREDENTIALS))?.slug).toBe("ghostship-benchy");
  });
});

describe("Cults3D orders and listings", () => {
  it("pages through the orders, keeping each model's download page", async () => {
    const line = (slug: string) => ({
      downloadUrl: `https://cults3d.com/en/downloads/1?creation=${slug}`,
      creation: { slug },
    });
    const full = Array.from({ length: 100 }, (_, i) => ({ lines: [line(`model-${i}`)] }));
    const calls = stubFetch(
      () => json({ data: { myself: { ordersBatch: { total: 101, results: full } } } }),
      () => json({ data: { myself: { ordersBatch: { total: 101, results: [{ lines: [line("last")] }] } } } }),
    );
    const orders = await fetchCults3dOrders(CREDENTIALS);
    expect(orders.size).toBe(101);
    expect(orders.get("last")).toBe("https://cults3d.com/en/downloads/1?creation=last");
    expect(graphqlOf(calls[1]).variables).toEqual({ limit: 100, offset: 100 });
  });

  it("lists a user's likes, leaving out paid models they don't own", async () => {
    stubFetch(() =>
      json({
        data: {
          user: {
            likedCreations: [
              {
                slug: "free",
                name: "Free",
                illustrationImageUrl: "https://images.cults3d.com/a.jpg",
                price: { cents: 0 },
              },
              { slug: "paid", name: "Paid", illustrationImageUrl: null, price: { cents: 299 } },
              {
                slug: "owned",
                name: "Owned",
                illustrationImageUrl: "https://videos.cults3d.com/b.mp4",
                price: { cents: 199 },
              },
            ],
          },
        },
      }),
    );
    const listing = await fetchCults3dLikes(CREDENTIALS, "someone", new Set(["owned"]));
    expect(listing).toEqual({
      entries: [
        { slug: "free", title: "Free", cover: "https://images.cults3d.com/a.jpg" },
        { slug: "owned", title: "Owned", cover: null },
      ],
      total: 2,
      truncated: false,
    });
  });

  it("says when the user doesn't exist", async () => {
    stubFetch(() => json({ data: { user: null } }));
    expect(await fetchCults3dLikes(CREDENTIALS, "nobody", new Set())).toBeNull();
  });

  it("fails on errors beside partial data, rather than reading an errored field as missing", async () => {
    stubFetch(() => json({ data: { user: null }, errors: [{ message: "Internal server error" }] }));
    await expect(fetchCults3dLikes(CREDENTIALS, "someone", new Set())).rejects.toThrow(/Internal server error/);
  });
});

describe("Cults3D downloads", () => {
  const page = `<form data-turbo="false" class="button_to" method="post" action="/en/free_orders?creation_slug=ghostship-benchy&amp;x=1"><button type="submit">Download</button><input type="hidden" name="authenticity_token" value="tok+en/=="></form>`;

  it("finds the free Download form, and none on a paid model", () => {
    expect(cults3dFreeOrderForm(page)).toEqual({
      action: "/en/free_orders?creation_slug=ghostship-benchy&x=1",
      token: "tok+en/==",
    });
    expect(
      cults3dFreeOrderForm('<form class="button_to" method="post" action="/en/lines?creation_id=1"></form>'),
    ).toBeNull();
  });

  it("orders a free model as the browser, with its cookies and User-Agent", async () => {
    const calls = stubFetch(
      () => redirect("https://cults3d.com/en/3d-model/art/ghostship-benchy", 301),
      () => new Response(page, { status: 200 }),
      () => redirect("https://cults3d.com/en/orders/169364417"),
    );
    await placeCults3dFreeOrder("ghostship-benchy", BROWSER);
    expect(calls[0].url.toString()).toBe("https://cults3d.com/en/creations/ghostship-benchy");
    expect(calls[0].headers.Cookie).toBe(`_session_id=${BROWSER.session}; cf_clearance=${BROWSER.clearance}`);
    expect(calls[0].headers["User-Agent"]).toBe("Mozilla/5.0 X");
    expect(calls[2].method).toBe("POST");
    expect(calls[2].url.toString()).toBe("https://cults3d.com/en/free_orders?creation_slug=ghostship-benchy&x=1");
    expect(new URLSearchParams(calls[2].body!).get("authenticity_token")).toBe("tok+en/==");
    expect(calls[2].headers.Referer).toBe("https://cults3d.com/en/3d-model/art/ghostship-benchy");
  });

  it("says so when the page has no free Download form", async () => {
    stubFetch(() => new Response("<html></html>", { status: 200 }));
    await expect(placeCults3dFreeOrder("ghostship-benchy", BROWSER)).rejects.toBeInstanceOf(Cults3dNoFreeDownloadError);
  });

  it("tells an ended sign-in from a Cloudflare challenge", async () => {
    stubFetch(
      () => new Response(page, { status: 200 }),
      () => redirect("https://cults3d.com/en/log-in-choice"),
    );
    await expect(placeCults3dFreeOrder("ghostship-benchy", BROWSER)).rejects.toBeInstanceOf(Cults3dSessionError);
    stubFetch(() => new Response("Just a moment...", { status: 403, headers: { "cf-mitigated": "challenge" } }));
    await expect(placeCults3dFreeOrder("ghostship-benchy", BROWSER)).rejects.toBeInstanceOf(Cults3dBlockedError);
  });

  it("follows the download page to its signed CloudFront link, and nowhere else", async () => {
    const signed =
      "https://download.cults3d.com/uploads/creation_zip/file/263230/ghostship-benchy.zip?Expires=1&Signature=s&Key-Pair-Id=k";
    stubFetch(() => redirect(signed));
    expect(
      await resolveCults3dDownload("https://cults3d.com/en/downloads/1?creation=ghostship-benchy", BROWSER),
    ).toEqual({
      name: "ghostship-benchy.zip",
      url: signed,
    });
    const scaleway =
      "https://s3.fr-par.scw.cloud/cults-stl-prod/uploaders/2169353/blueprint-file/d/Tsoi.zip?X-Amz-Expires=900&X-Amz-Signature=s";
    stubFetch(() => redirect(scaleway));
    expect(await resolveCults3dDownload("https://cults3d.com/en/downloads/2?creation=viktor-tsoi", BROWSER)).toEqual({
      name: "Tsoi.zip",
      url: scaleway,
    });
    // Scaleway's host is everyone's: another bucket there isn't Cults3D's.
    stubFetch(() => redirect("https://s3.fr-par.scw.cloud/someone-else/file.zip"));
    await expect(resolveCults3dDownload("https://cults3d.com/en/downloads/2", BROWSER)).rejects.toThrow(/unexpected/);
    stubFetch(() => redirect("/en/users/sign-in"));
    await expect(resolveCults3dDownload("https://cults3d.com/en/downloads/1", BROWSER)).rejects.toBeInstanceOf(
      Cults3dSessionError,
    );
    stubFetch(() => redirect("https://elsewhere.test/file.zip"));
    await expect(resolveCults3dDownload("https://cults3d.com/en/downloads/1", BROWSER)).rejects.toThrow(/unexpected/);
    await expect(resolveCults3dDownload("https://elsewhere.test/en/downloads/1", BROWSER)).rejects.toThrow(
      /Not a Cults3D/,
    );
  });

  // The site bounces the download page back where it came from -- to itself, without a Referer -- rather than saying
  // so, which is what it does when the sign-in isn't the account that ordered the model.
  it("tells a download the site kept on its own pages from one it sent to the files", async () => {
    const url = "https://cults3d.com/en/downloads/195676545?creation=htek-cable-box-h501-h502";
    stubFetch(() => redirect(url));
    await expect(resolveCults3dDownload(url, BROWSER)).rejects.toBeInstanceOf(Cults3dWrongAccountError);
    stubFetch(() => redirect("https://cults3d.com/en/orders"));
    await expect(resolveCults3dDownload(url, BROWSER)).rejects.toBeInstanceOf(Cults3dWrongAccountError);
  });

  it("names both accounts when it knows them, and says what to do either way", () => {
    expect(new Cults3dWrongAccountError({ api: "SlimDogs", site: "TautvydasUk" }).message).toMatch(
      /SlimDogs.*TautvydasUk.*Configuration > Providers/s,
    );
    expect(new Cults3dWrongAccountError().message).toMatch(/same Cults3D account/);
  });
});
