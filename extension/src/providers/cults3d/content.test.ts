import { afterEach, describe, expect, it, vi } from "vitest";
import { cults3dDesignerNick, cults3dDownloadsHave, isUnboughtCults3dModel } from "./content";

const SLUG = "toyota-fj40-rodmuzac";
const MODEL_URL = `https://cults3d.com/en/3d-model/game/${SLUG}`;

// The user's downloads page (/en/orders), cut down to what's read of it: the header's own links, which only a signed-in
// page has, and a row per order linking its model.
const SIGNED_IN = '<a href="/en/creations/mine">Designs</a><a href="/en/my-messages">Messages</a>';
const row = (path: string) =>
  `<tr><td class="creation-cell"><a title="Model" class="align-middle" href="${path}">Model</a></td>` +
  '<td><a class="btn btn-main" href="/en/orders/170369454">Download</a></td></tr>';
const page = (...parts: string[]) =>
  `<html><body>${SIGNED_IN}<table><tbody>${parts.join("")}</tbody></table></body></html>`;

// A model page's structured data, as the site writes it: one MediaObject naming its designer.
const mediaObject = (creator: Record<string, string>) =>
  JSON.stringify({ "@type": "MediaObject", name: "Toyota FJ40", creator: { "@type": "Person", ...creator } });
const BY_RODMUZAC = mediaObject({ name: "RodMuzac", url: "https://cults3d.com/@RodMuzac" });

describe("cults3dDownloadsHave", () => {
  it("finds a bought model among the downloads, by its slug", () => {
    expect(cults3dDownloadsHave(page(row(`/en/3d-model/game/${SLUG}`)), SLUG)).toBe(true);
    // In any of the site's languages: the slug is what names it.
    expect(cults3dDownloadsHave(page(row(`/fr/mod%C3%A8le-3d/jeu/${SLUG}`)), SLUG)).toBe(true);
  });

  it("says a model isn't there when the downloads, all on one page, don't list it", () => {
    expect(cults3dDownloadsHave(page(row("/en/3d-model/art/ghostship-benchy")), SLUG)).toBe(false);
    expect(cults3dDownloadsHave(page(), SLUG)).toBe(false);
    // The sort links in the table's head aren't pages.
    expect(cults3dDownloadsHave(page('<a href="/en/orders?direction=asc&amp;sort=id">Order no.</a>'), SLUG)).toBe(
      false,
    );
  });

  it("can't tell from the sign-in page, or from one page of several", () => {
    expect(cults3dDownloadsHave("<html><title>Log in・Cults</title></html>", SLUG)).toBeNull();
    const benchy = row("/en/3d-model/art/ghostship-benchy");
    // The site pages its lists both ways -- a user's models with ?page=2, its latest models with /page/2 -- in a nav.
    for (const pager of [
      '<a href="/en/orders?creator=RodMuzac&amp;page=2">2</a>',
      '<a href="/en/orders/page/2">2</a>',
      '<nav class="pagination" role="navigation" aria-label="Pages"></nav>',
    ]) {
      expect(cults3dDownloadsHave(page(benchy, pager), SLUG)).toBeNull();
    }
  });
});

describe("cults3dDesignerNick", () => {
  it("takes the nickname from the designer's profile link, or else their name", () => {
    expect(cults3dDesignerNick([BY_RODMUZAC])).toBe("RodMuzac");
    expect(cults3dDesignerNick([mediaObject({ name: "Rod Muzac", url: "https://cults3d.com/@RodMuzac" })])).toBe(
      "RodMuzac",
    );
    expect(cults3dDesignerNick([mediaObject({ name: "X", url: "https://cults3d.com/en/users/Rod.M-z" })])).toBe(
      "Rod.M-z",
    );
    expect(cults3dDesignerNick([mediaObject({ name: "RodMuzac" })])).toBe("RodMuzac");
  });

  it("names no one when the page names nobody, or more than one", () => {
    expect(cults3dDesignerNick([])).toBeNull();
    expect(cults3dDesignerNick(["not json", JSON.stringify({ "@type": "WebSite" })])).toBeNull();
    expect(cults3dDesignerNick([JSON.stringify({ creator: { name: "Cults" } }), BY_RODMUZAC])).toBeNull();
    // The same designer twice is still one.
    expect(cults3dDesignerNick([BY_RODMUZAC, JSON.stringify([JSON.parse(BY_RODMUZAC)])])).toBe("RodMuzac");
  });
});

describe("isUnboughtCults3dModel", () => {
  const asked: string[] = [];

  /** A model page as far as the check reads it: its cart button, a free Download form, a signed-in header and its
   *  structured data; and what the downloads page answers. */
  function onPage(
    { cart = true, free = false, signedIn = true, structuredData = [BY_RODMUZAC] } = {},
    downloads: () => Promise<Response> = async () => new Response(page(row(`/en/3d-model/game/${SLUG}`))),
  ): void {
    const shows = (selector: string) =>
      (cart && selector.includes("/lines?creation_id=")) ||
      (free && selector.includes("/free_orders?")) ||
      (signedIn && selector.includes("/creations/mine"));
    vi.stubGlobal("location", { origin: "https://cults3d.com" });
    vi.stubGlobal("document", {
      querySelector: (selector: string) => (shows(selector) ? {} : null),
      querySelectorAll: () => structuredData.map((textContent) => ({ textContent })),
    });
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return downloads();
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    asked.length = 0;
  });

  it("lets a bought model through, asking the downloads for its designer's models", async () => {
    onPage();
    expect(await isUnboughtCults3dModel(MODEL_URL)).toBe(false);
    expect(asked).toEqual(["https://cults3d.com/en/orders?creator=RodMuzac"]);
  });

  it("blocks a paid model the downloads don't list", async () => {
    onPage({}, async () => new Response(page(row("/en/3d-model/art/ghostship-benchy"))));
    expect(await isUnboughtCults3dModel(MODEL_URL)).toBe(true);
  });

  it("asks nothing about a free model, or from a signed-out page", async () => {
    for (const shown of [{ cart: false }, { free: true }, { signedIn: false }]) {
      onPage(shown);
      expect(await isUnboughtCults3dModel(MODEL_URL)).toBe(false);
    }
    expect(asked).toEqual([]);
  });

  it("doesn't block when it can't tell", async () => {
    onPage({ structuredData: [] });
    expect(await isUnboughtCults3dModel(MODEL_URL)).toBe(false);
    expect(asked).toEqual([]);
    for (const answer of [
      async () => new Response("oops", { status: 500 }),
      async () => new Response("<html><title>Log in・Cults</title></html>"),
      async () => Promise.reject(new TypeError("Failed to fetch")),
    ]) {
      onPage({}, answer);
      expect(await isUnboughtCults3dModel(MODEL_URL)).toBe(false);
    }
  });
});
