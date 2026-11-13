import { describe, expect, it } from "vitest";
import { matchFileRows, profileFiles } from "./adaptSite";

describe("a NexPrint model's print profiles", () => {
  const files = profileFiles({
    settingInfoList: [
      {
        id: "2110165673128615936",
        settingOutId: "g9687889",
        settingName: "Feuer",
        settingNameTranslateMap: { en: "Fire Dragon 0.2mm layer" },
        open: true,
        isInvalid: false,
        settingFile: { fileId: "2110163287693078528", fileName: "Fire_Dragon.3mf", fileSize: 10458253.0 },
      },
      {
        id: "2",
        settingOutId: "G2",
        settingName: "Hidden",
        open: false,
        settingFile: { fileId: "9", fileName: "h.3mf" },
      },
      {
        id: "3",
        settingOutId: "G3",
        settingName: "Broken",
        isInvalid: true,
        settingFile: { fileId: "9", fileName: "b.3mf" },
      },
      { id: "4", settingOutId: "G4", settingName: "No file" },
    ],
  });

  it("are the open ones with a file, by their G ids, shown by their English names", () => {
    expect(files).toEqual([
      {
        id: "G9687889",
        name: "Fire_Dragon.3mf",
        title: "Fire Dragon 0.2mm layer",
        size: 10458253,
        bizId: "2110165673128615936",
        fileId: "2110163287693078528",
      },
    ]);
  });

  it("are matched to the Files list's rows by file name, each once", () => {
    const storm = { id: "G2", name: "Storm.3mf", size: 1 };
    const fire = { id: "G1", name: "Fire_Dragon.3mf", size: 1 };
    const rows = [
      { item: "stl", name: "dragon.stl" },
      { item: "row fire", name: " fire_dragon.3mf" },
      { item: "row storm", name: "Storm.3mf" },
      { item: "again", name: "Storm.3mf" },
    ];
    expect(matchFileRows(rows, [fire, storm])).toEqual([
      { item: "row fire", file: fire },
      { item: "row storm", file: storm },
    ]);
  });
});
