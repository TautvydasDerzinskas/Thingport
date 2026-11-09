import { afterEach, describe, expect, it } from "vitest";
import { toymakr3dModelFromPage } from "../../src/providers/toymakr3d/api";
import { readToymakr3dLicense, toymakr3dLicense } from "../../src/providers/toymakr3d/license";
import { html, installFetch, loadFixtureHtml, type FetchStub } from "./support";

// Toymakr3D's licence as its model pages' licence card shows it -- the same on all 97 of its models, recorded from the
// live site -- and the restriction its terms of service add to it. No database.

const TERMS_URL = "https://www.toymakr3d.com/term-of-service";
const CARD_NAME = "CC BY-NC-ND - Attribution - Non Commercial - No Derivatives";
const EXPECTED = {
  id: "CC-BY-NC-ND-4.0",
  raw: CARD_NAME,
  url: TERMS_URL,
  terms:
    "Additional restriction: you are not allowed to share these files on other websites, or social media other than " +
    "Toymakr3D.com.",
  allows: [],
};

// The card as the live pages have it, with the link to the terms the recorded page leaves out.
const LIVE_CARD = `<div class="product--layout--standard"><div class="product__license"><div class="license-card card">
  <div class="license-card__badge">LICENSE</div><div class="license-card__body">
  <div class="license-card__name">${CARD_NAME}</div><div class="license-card__row">
  <div class="license-card__row-title">By downloading this thing, you agree to abide by the license</div>
  <div class="license-card__row-content"><a href="${TERMS_URL}" target="_blank">
  <img src="https://cdn.toymakr3d.com/img/license_product/newlicense_1599528422.png" class="license-card__logo"
  alt="license-image"></a></div></div></div></div></div></div>`;

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("Toymakr3D licences", () => {
  it("reads the card's CC BY-NC-ND as 4.0, with its terms' restriction and nothing it allows", () => {
    expect(toymakr3dLicense(CARD_NAME, TERMS_URL)).toEqual(EXPECTED);
    expect(toymakr3dLicense("CC BY-SA - Attribution - Share Alike")?.id).toBe("CC-BY-SA-4.0");
    expect(toymakr3dLicense("Toymakr3D personal licence")).toMatchObject({
      id: null,
      label: "Toymakr3D personal licence",
      allows: [],
    });
    expect(toymakr3dLicense(null)).toBeNull();
  });

  it("puts the page's licence in the model's details, and none for a page without a card", () => {
    expect(toymakr3dModelFromPage(loadFixtureHtml("toymakr3d", "model-page"), "8")?.meta.license).toEqual(EXPECTED);
    expect(toymakr3dModelFromPage(LIVE_CARD, "8")?.meta.license).toEqual(EXPECTED);
    const bare = '<div class="product--layout--standard"><div class="product__info"></div></div>';
    expect(toymakr3dModelFromPage(bare, "8")?.meta.license).toBeNull();
  });

  it("reads an older import's licence from its page alone, without the category listings", async () => {
    stub = installFetch(({ url }) => {
      if (url.hostname !== "www.toymakr3d.com") return undefined;
      if (url.pathname === "/product/8-") return html(loadFixtureHtml("toymakr3d", "model-page"));
      if (url.pathname === "/product/9-") return html("<h1>Not Found</h1>", 404);
      return undefined;
    });
    await expect(readToymakr3dLicense("user", "8", { notes: null })).resolves.toEqual(EXPECTED);
    expect(stub.calls.map((call) => call.url.pathname)).toEqual(["/product/8-"]);
    await expect(readToymakr3dLicense("user", "9", { notes: null })).rejects.toThrow(/can't be found/);
  });
});
