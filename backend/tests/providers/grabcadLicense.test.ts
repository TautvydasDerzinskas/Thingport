import { describe, expect, it } from "vitest";
import { grabcadModelFrom } from "../../src/providers/grabcad/api";
import { readGrabcadLicense } from "../../src/providers/grabcad/license";
import { loadFixture } from "./support";

// GrabCAD's models carry no licence of their own -- its API has no such field, recorded from the live site -- so each
// is under its terms of use's cross licence. No database.

describe("GrabCAD licences", () => {
  it("gives every model its terms' licence, in its details and for an older import with no request", async () => {
    const model = grabcadModelFrom(loadFixture("grabcad", "model"), loadFixture("grabcad", "gallery"));
    expect(model?.meta.license).toEqual({ id: "grabcad-terms", raw: "" });
    await expect(readGrabcadLicense("user", "any-model", { notes: null })).resolves.toEqual({
      id: "grabcad-terms",
      raw: "",
    });
  });
});
