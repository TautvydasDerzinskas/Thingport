import { describe, expect, it } from "vitest";
import { voxelshareMetaFromDetail } from "../../src/providers/voxelshare/api";
import { voxelshareLicenseFrom } from "../../src/providers/voxelshare/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// VoxelShare's licences as its models' details give them, recorded from its API and checked against the names its
// publish form gives them. No database.

// Its publish form's licences, as its page's bundle lists them, each at the version its pages link.
const FORM: [string, string][] = [
  ["CC0", "CC0-1.0"],
  ["CC BY", "CC-BY-4.0"],
  ["CC BY-SA", "CC-BY-SA-4.0"],
  ["CC BY-NC", "CC-BY-NC-4.0"],
  ["CC BY-NC-SA", "CC-BY-NC-SA-4.0"],
  ["CC BY-ND", "CC-BY-ND-4.0"],
  ["CC BY-NC-ND", "CC-BY-NC-ND-4.0"],
  ["Standard Digital File License", "sdfl"],
];

describe("VoxelShare licences", () => {
  it("knows each licence its publish form offers", () => {
    for (const [name, id] of FORM) {
      expect(voxelshareLicenseFrom(name)).toEqual({ id, raw: name });
      expect(licenseById(id)).not.toBeNull();
    }
  });

  it("reads the hyphenated spelling some of the models it copied carry", () => {
    expect(voxelshareLicenseFrom("CC-BY")?.id).toBe("CC-BY-4.0");
    expect(voxelshareLicenseFrom("CC-BY-NC-SA")?.id).toBe("CC-BY-NC-SA-4.0");
    expect(voxelshareLicenseFrom(" cc  by-nd ")?.id).toBe("CC-BY-ND-4.0");
  });

  it("keeps a name it doesn't know, allowing nothing, and none as none", () => {
    expect(voxelshareLicenseFrom(" All  rights reserved ")).toEqual({
      id: null,
      raw: "All rights reserved",
      label: "VoxelShare licence All rights reserved",
    });
    expect(voxelshareLicenseFrom("")).toBeNull();
    expect(voxelshareLicenseFrom(null)).toBeNull();
  });

  it("sets the licence a recorded model names on its metadata", () => {
    expect(voxelshareMetaFromDetail(loadFixture("voxelshare", "model-detail").data)?.meta.license).toEqual({
      id: "CC-BY-ND-4.0",
      raw: "CC BY-ND",
    });
    expect(voxelshareMetaFromDetail(loadFixture("voxelshare", "model-without-profiles").data)?.meta.license).toEqual({
      id: "CC0-1.0",
      raw: "CC0",
    });
  });
});
