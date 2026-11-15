import { describe, expect, it } from "vitest";
import { matchFileRows, threeMfFiles } from "./adaptSite";

describe("a Printables model's 3MFs", () => {
  it("are the files it lists that are 3MFs", () => {
    const files = threeMfFiles({
      print: {
        id: "1887965",
        stls: [
          { id: 7904558, name: "Durbar Container Lid 40mm.3mf", fileSize: 126312 },
          { id: "7904560", name: "Durbar Container 25x40mm.stl", fileSize: 837013 },
          { id: "7904559", name: "Durbar Container 25x40mm.3MF", fileSize: null },
          { id: null, name: "no id.3mf", fileSize: 1 },
        ],
      },
    });
    expect(files).toEqual([
      { id: "7904558", name: "Durbar Container Lid 40mm.3mf", size: 126312 },
      { id: "7904559", name: "Durbar Container 25x40mm.3MF", size: null },
    ]);
    expect(threeMfFiles({ print: null })).toEqual([]);
  });

  it("are matched to the Files tab's rows, which name them without their extension", () => {
    const lid = { id: "1", name: "Lid 40mm.3mf", size: 1 };
    const first = { id: "2", name: "Container  25x40mm.3mf", size: 2 };
    const second = { id: "3", name: "Container 25x40mm.3mf", size: 3 };
    const rows = [
      { item: "stl row", name: "Lid 40mm", badge: "stl" },
      { item: "row A", name: "container 25x40mm ", badge: "3mf" },
      { item: "row B", name: "Container 25x40mm", badge: "3MF" },
      { item: "row C", name: "Lid 40mm", badge: "3mf" },
      { item: "row D", name: "Somebody else's.3mf", badge: "3mf" },
    ];
    expect(matchFileRows(rows, [lid, first, second])).toEqual([
      { item: "row A", file: first },
      { item: "row B", file: second },
      { item: "row C", file: lid },
    ]);
  });
});
