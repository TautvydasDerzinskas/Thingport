import { afterEach, describe, expect, it } from "vitest";
import { resolveOwlcadModel } from "../../src/providers/owlcad/api";
import { owlcadLicense } from "../../src/providers/owlcad/license";
import { installFetch, json, loadFixture, type FetchStub } from "./support";

// OwlCAD's licences as its gallery documents give them, recorded from its public Firestore: the three its library
// parts carry, and none on a community CAD project, which its gallery terms cover. No database.

const PART_ID = "08ff2510-3f79-4169-8933-c0bf594f10e9";
const PROJECT_ID = "aeac7676-9243-49a2-8ebe-e8df226db6ed";

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("OwlCAD licences", () => {
  it("maps the three a library part carries, and leaves a part without one as none", () => {
    expect(owlcadLicense({ type: "part", license: "CC0" })).toEqual({ id: "CC0-1.0", raw: "CC0" });
    // Every CC-BY part comes from a source that gives CC BY 3.0.
    expect(owlcadLicense({ type: "part", license: "CC-BY" })).toEqual({ id: "CC-BY-3.0", raw: "CC-BY" });
    expect(owlcadLicense({ type: "part", license: "MIT" })).toEqual({ id: "MIT", raw: "MIT" });
    expect(owlcadLicense({ type: "part", license: null })).toBeNull();
    expect(owlcadLicense({ type: "part", license: " " })).toBeNull();
  });

  it("gives a community project its gallery terms, and keeps a licence it doesn't know by its name", () => {
    expect(owlcadLicense({ type: "project", license: null })).toEqual({ id: "owlcad-terms", raw: "" });
    expect(owlcadLicense({ type: "part", license: "CC-BY-SA" })).toEqual({ id: "CC-BY-SA-4.0", raw: "CC-BY-SA" });
    expect(owlcadLicense({ type: "part", license: "Kit licence" })).toEqual({
      id: null,
      raw: "Kit licence",
      label: "Kit licence",
    });
  });

  it("puts the gallery document's licence in the model's details", async () => {
    stub = installFetch(({ url }) => {
      if (url.hostname !== "firestore.googleapis.com") return undefined;
      const id = decodeURIComponent(url.pathname).split("/").pop();
      if (id === PART_ID) return json(loadFixture("owlcad", "gallery-part"));
      if (id === PROJECT_ID) return json(loadFixture("owlcad", "gallery-project"));
      return json({ error: { code: 403, status: "PERMISSION_DENIED" } }, 403);
    });
    expect((await resolveOwlcadModel(PART_ID))?.meta.license).toEqual({ id: "MIT", raw: "MIT" });
    expect((await resolveOwlcadModel(PROJECT_ID))?.meta.license).toEqual({ id: "owlcad-terms", raw: "" });
  });
});
