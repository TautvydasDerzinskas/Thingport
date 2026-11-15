import { describe, expect, it } from "vitest";
import { folderLabel, groupByFolder, hasFolders, shortNames } from "./fileFolders";

type File = { key: string; filename: string; folder?: string | null };
const file = (key: string, filename: string, folder?: string | null): File => ({ key, filename, folder });
const folderOf = (each: File) => each.folder;
const names = (files: File[]) =>
  Object.fromEntries(
    shortNames(
      files,
      (each) => each.key,
      (each) => each.filename,
      folderOf,
    ),
  );

describe("a model's files by folder", () => {
  it("puts the files in no folder first, then each folder as its first file comes", () => {
    const files = [
      file("a", "a.stl", "USB C"),
      file("b", "b.stl"),
      file("c", "c.stl", "USB A"),
      file("d", "d.stl", "USB C"),
    ];
    expect(groupByFolder(files, folderOf).map((group) => [group.folder, group.items.map((each) => each.key)])).toEqual([
      [null, ["b"]],
      ["USB C", ["a", "d"]],
      ["USB A", ["c"]],
    ]);
    expect(hasFolders(files, folderOf)).toBe(true);
    expect(hasFolders([file("x", "x.stl", null)], folderOf)).toBe(false);
    expect(folderLabel("32mm_Version/Pre-Supported")).toBe("32mm_Version / Pre-Supported");
  });

  it("leaves off the words every name in a folder starts with, and nothing outside one", () => {
    expect(
      names([
        file("1", "Charger Cable Organizer USB C Blank lightning handle.stl", "USB C version 20mm"),
        file("2", "Charger Cable Organizer USB C blank no handle.stl", "USB C version 20mm"),
        file("2k", "Charger Cable Organizer USB C Knurled S handle.stl", "USB C version 20mm"),
        file("3", "Storage box 6x USB C.stl", "Storage box"),
        file("4", "Storage box 4x USB.stl", "Storage box"),
        file("5", "Human_Bandit_Swordsman_Body_32mm.stl", "32mm"),
        file("6", "Human_Bandit_Swordsman_Sword_32mm.stl", "32mm"),
        file("7", "Part 1.stl"),
        file("8", "Part 2.stl"),
      ]),
    ).toEqual({
      "1": "Blank lightning handle",
      // Words are matched whatever their case.
      "2": "Blank no handle",
      "2k": "Knurled S handle",
      "3": "6x USB C",
      "4": "4x USB",
      "5": "Body_32mm",
      "6": "Sword_32mm",
      // Files in no folder keep their names: there's no heading to say the rest.
      "7": "Part 1",
      "8": "Part 2",
    });
  });

  it("keeps a whole name where trimming would leave one with nothing, or a folder has one file", () => {
    expect(
      names([file("1", "Lid.stl", "Box"), file("2", "Lid large.stl", "Box"), file("3", "Base.stl", "Stand")]),
    ).toEqual({
      "1": "Lid",
      "2": "Lid large",
      "3": "Base",
    });
  });
});
