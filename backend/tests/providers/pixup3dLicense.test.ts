import { afterEach, describe, expect, it, vi } from "vitest";
import { pixup3dModelFrom } from "../../src/providers/pixup3d/api";
import { readPixup3dLicense } from "../../src/providers/pixup3d/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture, loadFixtureHtml } from "./support";

// PIXUP's one licence: every model's page, free or paid, says the same. No database, and no requests.

const LICENSE = { id: "pixup3d-private", raw: "https://pixup3d.com/en/term_service" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PIXUP licences", () => {
  it("gives every model, free or paid, its private use licence", () => {
    expect(pixup3dModelFrom(loadFixture("pixup3d", "post"), null)?.meta.license).toEqual(LICENSE);
    expect(
      pixup3dModelFrom(loadFixture("pixup3d", "post-paid"), loadFixtureHtml("pixup3d", "page-paid"))?.meta.license,
    ).toEqual(LICENSE);
    expect(licenseById(LICENSE.id)?.url).toBe(LICENSE.raw);
  });

  it("is what a free and a paid model's page both say, word for word", () => {
    const said = ["license-free", "license-paid"].map((name) => {
      const page = loadFixtureHtml("pixup3d", name);
      return {
        linked: /"license":\s*"([^"]+)"/.exec(page)?.[1],
        text: page
          .slice(page.indexOf('<section class="license'))
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      };
    });
    expect(said[0]).toEqual(said[1]);
    expect(said[0]).toEqual({
      linked: LICENSE.raw,
      text: "License Copyright is owned by the designer, the model you purchase will only be allowed for the Private Use .",
    });
  });

  it("reads an older import's licence without asking the site", async () => {
    const fetch = vi.fn<() => Promise<Response>>(async () => {
      throw new Error("no request expected");
    });
    vi.stubGlobal("fetch", fetch);
    expect(await readPixup3dLicense()).toEqual(LICENSE);
    expect(fetch).not.toHaveBeenCalled();
  });
});
