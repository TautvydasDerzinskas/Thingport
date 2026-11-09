import { describe, expect, it } from "vitest";
import { cults3dMetaFromCreation } from "../../src/providers/cults3d/api";
import { cults3dLicenseFrom } from "../../src/providers/cults3d/license";
import { loadFixture } from "./support";

// Cults3D's licences, as its GraphQL API's `license { code name spdxId }` gives them. The codes are the anchors of its
// licence page (cults3d.com/en/licenses), which its models link.

describe("Cults3D licences", () => {
  it("maps every licence its licence page lists", () => {
    const codes: [string, string][] = [
      ["cults_pu", "cults-pu"],
      ["cults_cu", "cults-cu"],
      ["cults_cu_nd", "cults-cu-nd"],
      ["cc_by", "CC-BY-4.0"],
      ["cc_by_sa", "CC-BY-SA-4.0"],
      ["cc_by_nd", "CC-BY-ND-4.0"],
      ["cc_by_nc", "CC-BY-NC-4.0"],
      ["cc_by_nc_sa", "CC-BY-NC-SA-4.0"],
      ["cc_by_nc_nd", "CC-BY-NC-ND-4.0"],
      ["cc_pddc", "CC0-1.0"],
      ["cern_ohl", "CERN-OHL-1.2"],
      ["gpl", "GPL-3.0"],
      ["lgpl", "LGPL-3.0"],
      ["mit", "MIT"],
    ];
    for (const [code, id] of codes)
      expect(cults3dLicenseFrom({ code, name: "x", spdxId: null })).toEqual({ id, raw: code });
    // However its case and dashes come.
    expect(cults3dLicenseFrom({ code: "CULTS-CU-ND", name: "CULTS CU-ND", spdxId: null })?.id).toBe("cults-cu-nd");
    expect(cults3dLicenseFrom({ code: "cc-by-nc-nd", name: "CC BY-NC-ND", spdxId: null })?.id).toBe("CC-BY-NC-ND-4.0");
  });

  it("falls back on the SPDX id, then the name", () => {
    expect(cults3dLicenseFrom({ code: null, name: "GNU GPL", spdxId: null })).toEqual({
      id: "GPL-3.0",
      raw: "GNU GPL",
    });
    expect(cults3dLicenseFrom({ code: null, name: "GNU GPL", spdxId: "GPL-3.0-or-later" })).toEqual({
      id: "GPL-3.0",
      raw: "GPL-3.0-or-later",
    });
    expect(cults3dLicenseFrom({ code: "zzz", name: "Creative Commons BY-SA", spdxId: "CC-BY-SA-4.0" })?.id).toBe(
      "CC-BY-SA-4.0",
    );
    expect(cults3dLicenseFrom({ code: "cc_by_nc", name: null, spdxId: "CC-BY-NC-4.0" })).toEqual({
      id: "CC-BY-NC-4.0",
      raw: "cc_by_nc",
    });
    expect(cults3dLicenseFrom({ code: null, name: "LGPL 3.0", spdxId: "LGPL-3.0-only" })?.id).toBe("LGPL-3.0");
    expect(cults3dLicenseFrom({ code: "new_one", name: "Cults Galaxy", spdxId: null })).toEqual({
      id: null,
      raw: "new_one",
      label: "Cults Galaxy",
    });
  });

  it("says none for a creation without one, and leaves out a read that didn't ask", () => {
    expect(cults3dLicenseFrom(null)).toBeNull();
    expect(cults3dLicenseFrom({ code: null, name: null, spdxId: null })).toBeNull();
    expect(cults3dLicenseFrom(undefined)).toBeUndefined();
  });

  it("puts it in the creation's metadata", () => {
    const creation = loadFixture("cults3d", "creation").data.creation;
    expect(
      cults3dMetaFromCreation({ ...creation, license: { code: "cults_pu", name: "CULTS PU", spdxId: null } })?.meta
        .license,
    ).toEqual({
      id: "cults-pu",
      raw: "cults_pu",
    });
    expect(cults3dMetaFromCreation({ ...creation, license: null })?.meta.license).toBeNull();
  });
});
