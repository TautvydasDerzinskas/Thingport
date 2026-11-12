import { describe, expect, it } from "vitest";
import { moldFiles, pickedFile } from "./adaptSite";

// Cut down from api/mold/detail?id=245396: one print profile, the model's own STLs and a Bambu Studio 3MF.
const MOLD = {
  id: 245396,
  print_profiles: [
    {
      id: 145663,
      title: " v2 updated ",
      total_size: 1506506,
      download: { key: "f2045c627d2ab7cf69e293ced417f663", file_name: "gl_v2_anycubic.3mf" },
    },
    { id: 9, title: "No file", download: null },
    { id: 10, title: "Not a 3MF", download: { key: "k", file_name: "plate.gcode" } },
  ],
  files: [
    { file_id: 489530, file_name: "gl_v2_ (1).stl", file_size: 9084, key: "874a72a3" },
    { file_id: 491598, file_name: "gl_v2_bambu.3mf", file_size: 1749022, key: "d79da444b29b9a67037989724338e07b" },
  ],
};

describe("a MakerOnline model's 3MFs", () => {
  const files = moldFiles(MOLD);

  it("are its print profiles' files, then its own 3MFs, with what its download call needs of each", () => {
    expect(files).toEqual([
      {
        id: "p145663",
        name: "gl_v2_anycubic.3mf",
        title: "v2 updated",
        size: 1506506,
        key: "f2045c627d2ab7cf69e293ced417f663",
        fileType: 2,
        signId: 145663,
      },
      {
        id: "f491598",
        name: "gl_v2_bambu.3mf",
        size: 1749022,
        key: "d79da444b29b9a67037989724338e07b",
        fileType: 1,
        signId: 245396,
      },
    ]);
  });

  it("are none for a model it doesn't have", () => {
    expect(moldFiles({})).toEqual([]);
    expect(moldFiles(null)).toEqual([]);
  });
});

describe("the MakerOnline file a page has picked", () => {
  const files = moldFiles(MOLD);

  it("is the print profile picked, on the print profiles tab", () => {
    expect(pickedFile(files, "145663|489530", false)?.id).toBe("p145663");
  });

  it("is the model's own 3MF picked, on its files tab", () => {
    expect(pickedFile(files, "145663|491598", true)?.id).toBe("f491598");
  });

  it("is none where the pick there isn't a 3MF, or nothing is picked yet", () => {
    expect(pickedFile(files, "145663|489530", true)).toBeNull();
    expect(pickedFile(files, "|", false)).toBeNull();
    expect(pickedFile(files, null, false)).toBeNull();
  });
});
