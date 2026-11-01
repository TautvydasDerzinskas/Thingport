import { describe, expect, it } from "vitest";
import type { Category } from "../api/categories";
import { buildCategoryTree, categorySearchIds, foldForSearch } from "./categoryTree";

const category = (id: string, name: string, parent_id: string | null = null) =>
  ({ id, name, parent_id, position: 0, kind: "category" }) as Category;

const tree = buildCategoryTree([
  category("toys", "Žaislai"),
  category("puzzles", "Puzzles", "toys"),
  category("cubes", "Cubes", "puzzles"),
  category("cars", "Cars", "toys"),
  category("tools", "Tools"),
  category("measuring", "Measuring", "tools"),
]);
const search = (query: string) => [...categorySearchIds(tree, query, (c) => c.name)].toSorted();

describe("foldForSearch", () => {
  it("ignores case and accents", () => {
    expect(foldForSearch("Žaislų Dėžė")).toBe("zaislu deze");
  });
});

describe("categorySearchIds", () => {
  it("keeps a match with the way down to it, leaving its siblings out", () => {
    expect(search("cube")).toEqual(["cubes", "puzzles", "toys"]);
  });

  it("keeps everything under a matching heading", () => {
    expect(search("zaisl")).toEqual(["cars", "cubes", "puzzles", "toys"]);
  });

  it("keeps each of several matches", () => {
    expect(search("s")).toEqual(["cars", "cubes", "measuring", "puzzles", "tools", "toys"]);
  });

  it("ignores spaces around the query", () => {
    expect(search("  measuring ")).toEqual(["measuring", "tools"]);
  });

  it("finds nothing for a name no category has", () => {
    expect(search("nothing like it")).toEqual([]);
  });
});
