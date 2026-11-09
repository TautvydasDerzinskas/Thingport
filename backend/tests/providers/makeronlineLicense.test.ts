import { describe, expect, it } from "vitest";
import { makeronlineMetaFromDetail } from "../../src/providers/makeronline/api";
import { makeronlineLicenseFrom } from "../../src/providers/makeronline/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// MakerOnline's licences as its models' details number them, recorded from its API and checked against the names and
// links its pages show for them. No database.

type Detail = { id: number; title: string; license: number };

describe("MakerOnline licences", () => {
  it("knows each number its pages name, 2 ShareAlike and 3 NonCommercial", () => {
    const read = [1, 2, 3, 4, 5, 6, 7, 8].map((license) => makeronlineLicenseFrom({ license })?.id);
    expect(read).toEqual([
      "CC-BY-4.0",
      "CC-BY-SA-4.0",
      "CC-BY-NC-4.0",
      "CC-BY-NC-SA-4.0",
      "CC-BY-ND-4.0",
      "CC-BY-NC-ND-4.0",
      "CC0-1.0",
      "sdfl",
    ]);
    for (const id of read) expect(licenseById(id)).not.toBeNull();
  });

  it("reads each recorded model's licence", () => {
    const details = loadFixture<Detail[]>("makeronline", "license-details");
    expect(Object.fromEntries(details.map((detail) => [detail.id, makeronlineLicenseFrom(detail)]))).toEqual({
      21065: { id: "CC-BY-4.0", raw: "1" },
      190781: { id: "CC-BY-SA-4.0", raw: "2" },
      500: { id: "CC-BY-NC-4.0", raw: "3" },
      170136: { id: "CC-BY-NC-SA-4.0", raw: "4" },
      20251: { id: "CC-BY-ND-4.0", raw: "5" },
      7823: { id: "CC-BY-NC-ND-4.0", raw: "6" },
      167680: { id: "sdfl", raw: "8" },
    });
  });

  it("puts the licence in the model's details, which the backend reads even when Grab brings the files", () => {
    const detail = loadFixture<Detail[]>("makeronline", "license-details").find((d) => d.id === 190781)!;
    expect(makeronlineMetaFromDetail(detail).meta.license).toEqual({ id: "CC-BY-SA-4.0", raw: "2" });
    expect(makeronlineMetaFromDetail({ id: 1, title: "Bare" }).meta).toHaveProperty("license", null);
  });

  it("gives none for a missing number, and keeps one it doesn't know", () => {
    for (const license of [undefined, null, 0, -1, "", "abc", 2.5]) {
      expect(makeronlineLicenseFrom({ license })).toBeNull();
    }
    expect(makeronlineLicenseFrom({ license: 9 })).toEqual({ id: null, raw: "9", label: "MakerOnline licence 9" });
    expect(makeronlineLicenseFrom({ license: "4" })).toEqual({ id: "CC-BY-NC-SA-4.0", raw: "4" });
  });
});
