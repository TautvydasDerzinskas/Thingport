import { describe, expect, it } from "vitest";
import { cults3dDownloadsHave } from "./content";

// The user's downloads page (/en/orders), cut down to what's read of it: the header's own links, which only a signed-in
// page has, and a row per order linking its model.
const SIGNED_IN = '<a href="/en/creations/mine">Designs</a><a href="/en/my-messages">Messages</a>';
const row = (path: string) =>
  `<tr><td class="creation-cell"><a title="Model" class="align-middle" href="${path}">Model</a></td>` +
  '<td><a class="btn btn-main" href="/en/orders/170369454">Download</a></td></tr>';
const page = (...parts: string[]) =>
  `<html><body>${SIGNED_IN}<table><tbody>${parts.join("")}</tbody></table></body></html>`;

describe("cults3dDownloadsHave", () => {
  it("finds a bought model among the downloads, by its slug", () => {
    expect(cults3dDownloadsHave(page(row("/en/3d-model/game/toyota-fj40-rodmuzac")), "toyota-fj40-rodmuzac")).toBe(
      true,
    );
    // In any of the site's languages: the slug is what names it.
    expect(cults3dDownloadsHave(page(row("/fr/mod%C3%A8le-3d/jeu/toyota-fj40-rodmuzac")), "toyota-fj40-rodmuzac")).toBe(
      true,
    );
  });

  it("says a model isn't there when the downloads, all on one page, don't list it", () => {
    expect(cults3dDownloadsHave(page(row("/en/3d-model/art/ghostship-benchy")), "toyota-fj40-rodmuzac")).toBe(false);
    expect(cults3dDownloadsHave(page(), "toyota-fj40-rodmuzac")).toBe(false);
    // The sort links in the table's head aren't pages.
    expect(
      cults3dDownloadsHave(
        page('<a href="/en/orders?direction=asc&amp;sort=id">Order no.</a>'),
        "toyota-fj40-rodmuzac",
      ),
    ).toBe(false);
  });

  it("can't tell from the sign-in page, or from one page of several", () => {
    expect(cults3dDownloadsHave("<html><title>Log in・Cults</title></html>", "toyota-fj40-rodmuzac")).toBeNull();
    expect(
      cults3dDownloadsHave(
        page(row("/en/3d-model/art/ghostship-benchy"), '<a href="/en/orders?creator=RodMuzac&amp;page=2">2</a>'),
        "toyota-fj40-rodmuzac",
      ),
    ).toBeNull();
  });
});
