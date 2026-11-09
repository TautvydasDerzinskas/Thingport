import { describe, expect, it } from "vitest";
import { nexprintMetaFromDetail } from "../../src/providers/nexprint/api";
import { nexprintLicenseFrom } from "../../src/providers/nexprint/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// NexPrint's licences as its models' details number them, recorded from its API and checked against the names and
// links its pages show for them. No database.

type Detail = { id: string; modelId: string; modelName: string; licenseType: number };

describe("NexPrint licences", () => {
  it("knows each number its pages name, counted from 0", () => {
    const read = [0, 1, 2, 3, 4, 5, 6, 7].map((licenseType) => nexprintLicenseFrom({ licenseType })?.id);
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
    const details = loadFixture<Detail[]>("nexprint", "license-details");
    expect(Object.fromEntries(details.map((detail) => [detail.modelId, nexprintLicenseFrom(detail)]))).toEqual({
      G9553944: { id: "CC-BY-4.0", raw: "0" },
      G2854689: { id: "CC-BY-SA-4.0", raw: "1" },
      G7882415: { id: "CC-BY-NC-4.0", raw: "2" },
      G6222709: { id: "CC-BY-NC-SA-4.0", raw: "3" },
      G6216521: { id: "CC-BY-ND-4.0", raw: "4" },
      G2871048: { id: "sdfl", raw: "7" },
    });
  });

  it("puts the licence in the model's details", () => {
    const [detail] = loadFixture<Detail[]>("nexprint", "license-details");
    expect(nexprintMetaFromDetail(detail)!.meta.license).toEqual({ id: "CC-BY-4.0", raw: "0" });
    expect(nexprintMetaFromDetail({ ...detail, licenseType: null })!.meta).toHaveProperty("license", null);
  });

  it("gives none for a missing number, and keeps one it doesn't know rather than the Standard one its pages show", () => {
    for (const licenseType of [undefined, null, "", -1, 1.5, "x"]) {
      expect(nexprintLicenseFrom({ licenseType })).toBeNull();
    }
    expect(nexprintLicenseFrom({ licenseType: 8 })).toEqual({ id: null, raw: "8", label: "NexPrint licence 8" });
    expect(nexprintLicenseFrom({ licenseType: "06" })).toEqual({ id: "CC0-1.0", raw: "6" });
  });
});
