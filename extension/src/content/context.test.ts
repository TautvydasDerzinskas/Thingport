import { describe, expect, it } from "vitest";
import { libraryStateOf } from "./context";

const imported = { already_imported: true, print_id: "p1", gaps: [], imported_profile_ids: ["1", "2"] };
const allHeld = { total: 2, all: [], designer: [] };

describe("where a model stands in the library", () => {
  it("isn't there when the instance hasn't got it, unless only this page's profile is new to it", () => {
    expect(libraryStateOf({ already_imported: false }, "none")).toBeNull();
    expect(libraryStateOf({ already_imported: false, state: "profile_missing", print_id: "p1" }, "none")).toMatchObject(
      { state: "profile_missing", printId: "p1" },
    );
  });

  it("is complete once it has every one of the page's profiles and no details missing", () => {
    expect(libraryStateOf(imported, allHeld)).toMatchObject({ state: "complete", printId: "p1", profiles: 2 });
  });

  it("is complete on a site or page without profiles", () => {
    expect(libraryStateOf({ ...imported, imported_profile_ids: undefined }, "none")).toMatchObject({
      state: "complete",
      profiles: 0,
    });
  });

  it("has something to add while it lacks profiles or details", () => {
    expect(libraryStateOf(imported, { total: 2, all: ["2"], designer: [] })).toMatchObject({ state: "imported" });
    expect(libraryStateOf({ ...imported, gaps: ["tags"] }, allHeld)).toMatchObject({
      state: "imported",
      gaps: ["tags"],
    });
  });

  it("isn't called complete when it can't be told which profiles it has: the page's are offered", () => {
    // An instance older than 1.6.0, or a page that won't list them.
    expect(libraryStateOf({ ...imported, imported_profile_ids: undefined }, null)).toMatchObject({
      state: "profile_unknown",
      printId: "p1",
    });
    // Details to fetch still come first.
    expect(libraryStateOf({ ...imported, gaps: ["tags"] }, null)).toMatchObject({ state: "imported" });
  });

  it("is complete when the instance has it but doesn't say which model, as nothing could be filled in", () => {
    expect(libraryStateOf({ ...imported, print_id: null, gaps: ["tags"] }, "none")).toMatchObject({
      state: "complete",
      printId: null,
      gaps: [],
    });
  });
});
