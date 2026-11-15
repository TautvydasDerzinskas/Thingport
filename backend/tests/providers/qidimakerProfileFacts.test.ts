import { describe, expect, it } from "vitest";
import { qidimakerProfileFactsFrom } from "../../src/providers/qidimaker/profileFacts";
import { loadFixture } from "./support";

// What the model page shows of QIDI Maker's print profiles, from the recorded list of a model's profiles: its
// designer's two, and someone else's. No database.

const DESIGNER = "1000000000000000001";

describe("QIDI Maker profile facts", () => {
  const { data } = loadFixture<{ data: unknown[] }>("qidimaker", "profiles");
  const facts = qidimakerProfileFactsFrom(data, DESIGNER);

  it("reads a profile: its times in hours, its plates numbered as the 3MF numbers them, its printer by its maker", () => {
    expect(facts["2094485346244440065"]).toEqual({
      title: "Standard (56 mm - 65 mm Inner Spool Width) v2",
      origin: "designer",
      creator: "Maker 1",
      seconds: 1800,
      grams: 7.74,
      filaments: [
        { type: "PLA", color: "#FFFFFF", grams: 5.07 },
        { type: "PLA", color: "#000000", grams: 2.66 },
      ],
      plates: [
        {
          index: 1,
          seconds: 1800,
          grams: 7.74,
          filaments: [
            { type: "PLA", color: "#FFFFFF", grams: 5.07 },
            { type: "PLA", color: "#000000", grams: 2.66 },
          ],
        },
      ],
      printer: "QIDI Q2C",
      nozzleMm: 0.4,
      layerMm: 0.2,
      infill: "15%",
      walls: 3,
    });
  });

  it("tells someone else's profile from the designer's", () => {
    expect(facts["2091804233625579522"]).toMatchObject({
      origin: "community",
      creator: "Maker 2",
      seconds: 30600,
      printer: "QIDI Q2",
      layerMm: 0.12,
    });
    expect(Object.keys(facts)).toEqual(["2094485346244440065", "2094487632165285889", "2091804233625579522"]);
  });

  it("adds up a filament across plates by its slot, and leaves a printer it doesn't know to the 3MF", () => {
    const groups = [
      {
        userId: DESIGNER,
        nickname: "Maker 1",
        sliceModelConfigurationVOS: [
          {
            id: "1",
            exportPrinter: "QD_NEW",
            modelConsumable: "PETG",
            modelMaterials: 30,
            slicePlates: [
              {
                plateName: "1",
                slicePlateConsumableVOList: [
                  {
                    plateConsumableType: "PETG",
                    plateConsumableNumber: 10,
                    plateConsumableColor: "#FF0000",
                    filamentId: 0,
                  },
                ],
              },
              {
                plateName: "Lid",
                slicePlateConsumableVOList: [
                  {
                    plateConsumableType: "PETG",
                    plateConsumableNumber: 20,
                    plateConsumableColor: "#FF0000",
                    filamentId: 0,
                  },
                ],
              },
            ],
          },
          { id: "2", modelConsumable: "PLA", modelMaterials: 12.5 },
        ],
      },
    ];
    const read = qidimakerProfileFactsFrom(groups, DESIGNER);
    expect(read["1"].filaments).toEqual([{ type: "PETG", color: "#FF0000", grams: 30 }]);
    expect(read["1"].plates?.map((plate) => [plate.index, plate.name ?? null])).toEqual([
      [1, null],
      [2, "Lid"],
    ]);
    expect(read["1"].printer).toBeUndefined();
    // Without plates, the one filament the profile names.
    expect(read["2"].filaments).toEqual([{ type: "PLA", color: null, grams: 12.5 }]);
  });
});
