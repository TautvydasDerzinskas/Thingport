import { describe, expect, it } from "vitest";
import { threedexportModelFrom } from "../../src/providers/threedexport/api";
import { threedexportLicense } from "../../src/providers/threedexport/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixtureHtml } from "./support";

// 3DExport's licences: a free model is royalty free, a paid one is sold under the Basic licence (or the Extended one,
// which its page doesn't say a buyer chose), and either may carry its author's "No AI Training". No database, and no
// requests.

describe("3DExport licences", () => {
  it("names each of its four, every one in the catalogue", () => {
    const table: [number, boolean, string, string[]][] = [
      [0, false, "3dexport-royalty-free", ["remix", "commercial"]],
      [0, true, "3dexport-royalty-free-no-ai", ["remix", "commercial"]],
      [5, false, "3dexport-basic", ["remix"]],
      [5, true, "3dexport-basic-no-ai", ["remix"]],
    ];
    for (const [price, noAi, id, allows] of table) {
      expect(threedexportLicense(price, noAi).id).toBe(id);
      expect(licenseById(id)).toMatchObject({ family: "site", allows });
    }
    // None of them lets the files be passed on.
    expect(table.every(([, , id]) => !licenseById(id)!.allows.includes("share"))).toBe(true);
  });

  it("reads a model's from its page: its price, and the note beside it", () => {
    expect(threedexportModelFrom(loadFixtureHtml("threedexport", "page"))?.meta.license).toEqual({
      id: "3dexport-royalty-free-no-ai",
      raw: "royalty-free, no AI training",
    });
    expect(threedexportModelFrom(loadFixtureHtml("threedexport", "page-paid"))?.meta.license).toEqual({
      id: "3dexport-basic-no-ai",
      raw: "basic, no AI training",
    });
    // Without its author's note.
    const page = loadFixtureHtml("threedexport", "page").replace('data-target="#no_ai_license_popup"', "");
    expect(threedexportModelFrom(page)?.meta.license).toEqual({ id: "3dexport-royalty-free", raw: "royalty-free" });
  });
});
