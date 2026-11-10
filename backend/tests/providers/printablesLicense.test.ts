import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePrintablesModel } from "../../src/providers/printables/api";
import { printablesLicenseFrom } from "../../src/providers/printables/license";
import { loadFixture } from "./support";

// Printables' licences: every one its API lists (`licenses`, recorded whole), mapped by id, and a model's as the
// import's query reads it.

afterEach(() => {
  vi.unstubAllGlobals();
});

type License = { id: string; name: string; abbreviation: string; content: string };
const LICENSES = loadFixture<{ data: { licenses: License[] } }>("printables", "licenses").data.licenses;

function byId(id: string): License {
  const license = LICENSES.find((l) => l.id === id);
  if (!license) throw new Error(`no licence ${id} in the fixture`);
  return license;
}

describe("Printables licences", () => {
  it("maps every licence it lists", () => {
    const ids = Object.fromEntries(
      LICENSES.map((license) => [license.abbreviation, printablesLicenseFrom(license)?.id]),
    );
    expect(ids).toEqual({
      CC0: "CC0-1.0",
      "CC-BY": "CC-BY-4.0",
      "CC-BY-SA": "CC-BY-SA-4.0",
      "CC-BY-ND": "CC-BY-ND-4.0",
      "CC-BY-NC": "CC-BY-NC-4.0",
      "CC-BY-NC-SA": "CC-BY-NC-SA-4.0",
      "CC-BY-NC-ND": "CC-BY-NC-ND-4.0",
      "GPL 2.0": "GPL-2.0",
      "GPL 3.0": "GPL-3.0",
      LGPL: "LGPL-3.0",
      BSD: "BSD-2-Clause",
      "Standard Digital File": "sdfl",
      "Comm. - No Derivative": "printables-commercial-nd",
      "Commercial Use": "printables-commercial",
      "OCL v1": "OCL-1.0",
      "OCL v1.1": "OCL-1.1",
      "OCL v1.1 + GAtt v1": "OCL-1.1",
      "OCL v1.1 + RnD v1": "OCL-1.1",
      "OCL v1.1 + Micro v1": "OCL-1.1",
      "OCL v1.1 + GAtt v1 + Micro v1": "OCL-1.1",
      "OCL v1.1 + GAtt v1 + RnD v1": "OCL-1.1",
      "CERN-OHL-S v2": "CERN-OHL-S-2.0",
      "Apache-2.0": "Apache-2.0",
    });
  });

  it("keeps a standard licence to its id, and the wording of Printables' own", () => {
    expect(printablesLicenseFrom(byId("4"))).toEqual({ id: "CC-BY-NC-SA-4.0", raw: "4" });
    const sdfl = printablesLicenseFrom(byId("13"));
    expect(sdfl).toMatchObject({ id: "sdfl", raw: "13" });
    expect(sdfl).not.toHaveProperty("label");
    expect(sdfl?.terms).toMatch(/^This work is licensed under a Standard Digital File License\./);
    expect(sdfl?.terms).toContain("You can not host these files on other digital platforms");
    expect(sdfl?.terms).not.toMatch(/<[a-z]/);
    expect(printablesLicenseFrom(byId("15"))?.terms).toContain("You are allowed to modify (remix) the 3D model files.");
    expect(printablesLicenseFrom(byId("14"))?.terms).toContain(
      "You are NOT allowed to modify (remix) the 3D model files.",
    );
  });

  it("names an Open Community License add-on as Printables does", () => {
    const micro = printablesLicenseFrom(byId("21"));
    expect(micro).toMatchObject({ id: "OCL-1.1", raw: "21", label: "Open Community License v1.1 + Micro Business v1" });
    expect(micro?.terms).toContain("Commercial use by small business only");
    expect(printablesLicenseFrom(byId("17"))).toEqual({ id: "OCL-1.1", raw: "17" });
    // General Attribution asks for credit, which the licence it's added to doesn't.
    for (const id of ["19", "22", "23"]) {
      expect(printablesLicenseFrom(byId(id))).toMatchObject({ requires: { credit: true } });
    }
  });

  it("reads one added since by its link or name, and says none for a Club model", () => {
    expect(
      printablesLicenseFrom({
        id: "25",
        name: "MIT License",
        abbreviation: "MIT",
        content: '<a href="https://opensource.org/licenses/MIT">MIT</a>',
      }),
    ).toEqual({ id: "MIT", raw: "25" });
    expect(
      printablesLicenseFrom({
        id: "26",
        name: "Creative Commons — Attribution 3.0",
        abbreviation: "CC-BY 3.0",
        content: '<a href="https://creativecommons.org/licenses/by/3.0/">CC</a>',
      }),
    ).toEqual({ id: "CC-BY-3.0", raw: "26" });
    expect(
      printablesLicenseFrom({
        id: "27",
        name: "Printables Club License",
        abbreviation: "Club",
        content: "<div>Members only</div>",
      }),
    ).toEqual({ id: null, raw: "27", label: "Printables Club License", terms: "Members only" });
    // Premium (Club) models answer `license: null` to anyone.
    expect(printablesLicenseFrom(null)).toBeNull();
    expect(printablesLicenseFrom(undefined)).toBeUndefined();
  });

  it("asks for it with the model and puts it in the model's metadata", async () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { query, variables } = JSON.parse(String(init.body));
        queries.push(query);
        const premium = variables.id === "547110";
        return Response.json({
          data: {
            print: {
              id: variables.id,
              name: premium ? "Mini Bone" : "Gravity - Locking Towel Hanger",
              description: "<p>Hangs towels.</p>",
              tags: [],
              stls: [],
              license: premium ? null : byId("6"),
            },
          },
        });
      }),
    );
    expect((await resolvePrintablesModel("1893211"))?.meta.license).toEqual({ id: "CC-BY-NC-ND-4.0", raw: "6" });
    expect(queries[0]).toMatch(/license \{ id name abbreviation content \}/);
    expect((await resolvePrintablesModel("547110"))?.meta.license).toBeNull();
  });
});
