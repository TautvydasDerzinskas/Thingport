import { afterEach, describe, expect, it, vi } from "vitest";
import { fab365ModelFrom } from "../../src/providers/fab365/api";
import { readFab365License } from "../../src/providers/fab365/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// Fab365's one licence: every model, free or paid, is under the same personal-use terms. No database, and no requests.

const LICENSE = { id: "fab365-personal", raw: "https://fab365.net/terms" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Fab365 licences", () => {
  it("gives every model, free or paid, its personal-use licence", () => {
    for (const fixture of ["detail", "detail-paid"]) {
      const item = loadFixture<{ item: Record<string, unknown> }>("fab365", fixture).item;
      expect(fab365ModelFrom(item, [], null).meta.license).toEqual(LICENSE);
    }
    expect(licenseById(LICENSE.id)).toMatchObject({ url: LICENSE.raw, family: "site", allows: [] });
  });

  it("reads an older import's licence without asking the site", async () => {
    const fetch = vi.fn<() => Promise<Response>>(async () => {
      throw new Error("no request expected");
    });
    vi.stubGlobal("fetch", fetch);
    expect(await readFab365License()).toEqual(LICENSE);
    expect(fetch).not.toHaveBeenCalled();
  });
});
