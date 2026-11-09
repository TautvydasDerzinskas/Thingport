import { afterEach, describe, expect, it } from "vitest";
import { pinshapeModelFromPage } from "../../src/providers/pinshape/api";
import { pinshapeLicense, readPinshapeLicense } from "../../src/providers/pinshape/license";
import { html, installFetch, loadFixtureHtml, redirect, type FetchStub } from "./support";

// Pinshape's licences as its model pages' licence card shows them, recorded from the live site: the seven its browse
// filter offers, each linking to its Creative Commons 4.0 deed. No database.

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

const deed = (code: string) => `https://creativecommons.org/licenses/${code}/4.0/`;

describe("Pinshape licences", () => {
  it("maps each of the seven licence cards by its link", () => {
    const cards = [
      [deed("by"), "Creative Commons Attribution", "CC BY", "CC-BY-4.0"],
      [deed("by-sa"), "Creative Commons Attribution-ShareAlike", "CC BY-SA", "CC-BY-SA-4.0"],
      [deed("by-nc"), "Creative Commons Attribution-NonCommercial", "CC BY-NC", "CC-BY-NC-4.0"],
      [deed("by-nc-sa"), "Creative Commons Attribution-NonCommercial-ShareAlike", "CC BY-NC-SA", "CC-BY-NC-SA-4.0"],
      [deed("by-nd"), "Creative Commons Attribution-NoDerivatives", "CC BY-ND", "CC-BY-ND-4.0"],
      [deed("by-nc-nd"), "Creative Commons Attribution-NonCommercial-NoDerivatives", "CC BY-NC-ND", "CC-BY-NC-ND-4.0"],
      ["https://creativecommons.org/publicdomain/zero/1.0/", "Creative Commons Public Domain", "CC0", "CC0-1.0"],
    ];
    for (const [url, name, short, id] of cards) {
      // The link is the catalogue's own, so it isn't kept apart.
      expect(pinshapeLicense({ url, name, short })).toEqual({ id, raw: url });
    }
  });

  it("reads a card without a link by its badge, and keeps one it doesn't know by the site's name", () => {
    expect(pinshapeLicense({ url: null, name: "Creative Commons Attribution-ShareAlike", short: "CC BY-SA" })).toEqual({
      id: "CC-BY-SA-4.0",
      raw: "CC BY-SA",
    });
    expect(pinshapeLicense({ url: "https://example.com/my-licence", name: "My Licence", short: null })).toEqual({
      id: null,
      raw: "https://example.com/my-licence",
      label: "My Licence",
      url: "https://example.com/my-licence",
    });
    expect(pinshapeLicense({ url: null, name: null, short: null })).toBeNull();
  });

  it("puts the page's licence in the model's details, and none for a page without a card", () => {
    const cc0 = pinshapeModelFromPage(loadFixtureHtml("pinshape", "model-page"), "111504");
    expect(cc0?.meta.license).toEqual({ id: "CC0-1.0", raw: "https://creativecommons.org/publicdomain/zero/1.0/" });
    const byNcSa = pinshapeModelFromPage(loadFixtureHtml("pinshape", "model-page-by-nc-sa"), "4452");
    expect(byNcSa?.meta.license).toEqual({ id: "CC-BY-NC-SA-4.0", raw: deed("by-nc-sa") });
    const bare = pinshapeModelFromPage('<div class="main-item-container"><h1>A model</h1></div>', "1");
    expect(bare?.meta.license).toBeNull();
  });

  it("reads an older import's licence from its page alone, and throws for a model that's gone", async () => {
    stub = installFetch(({ url }) => {
      if (url.pathname === "/items/4452") return html(loadFixtureHtml("pinshape", "model-page-by-nc-sa"));
      if (url.pathname === "/items/9") return redirect("/index");
      return undefined;
    });
    await expect(readPinshapeLicense("user", "4452", { notes: null })).resolves.toEqual({
      id: "CC-BY-NC-SA-4.0",
      raw: deed("by-nc-sa"),
    });
    expect(stub.calls.map((call) => call.url.pathname)).toEqual(["/items/4452"]);
    await expect(readPinshapeLicense("user", "9", { notes: null })).rejects.toThrow(/can't be found/);
  });
});
