import { describe, expect, it } from "vitest";
import { qidimakerMetaFromDetail } from "../../src/providers/qidimaker/api";
import { qidimakerLicenseFrom } from "../../src/providers/qidimaker/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// QIDI Maker's licences as its models' details give them, recorded from its API and checked against the names, links
// and answers its publish form gives them. No database.

type Detail = Record<string, unknown> & { id: string };

// Its publish form's licences, with the four answers it takes each from: whether adaptations may be shared, commercial
// use, redistribution and attribution.
const FORM: [string, number[], string][] = [
  ["CC0", [0, 0, 0, 0], "CC0-1.0"],
  ["BY", [0, 0, 0, 1], "CC-BY-4.0"],
  ["BY-NC", [0, 1, 0, 1], "CC-BY-NC-4.0"],
  ["BY-SA", [2, 0, 0, 1], "CC-BY-SA-4.0"],
  ["BY-NC-SA", [2, 1, 0, 1], "CC-BY-NC-SA-4.0"],
  ["BY-ND", [1, 0, 0, 1], "CC-BY-ND-4.0"],
  ["BY-NC-ND", [1, 1, 0, 1], "CC-BY-NC-ND-4.0"],
  ["STANDARD", [1, 1, 1, 1], "sdfl"],
];

const answers = ([adaptedShared, commercialUse, redistribute, attributionShare]: number[]) => ({
  adaptedShared,
  commercialUse,
  redistribute,
  attributionShare,
});

describe("QIDI Maker licences", () => {
  it("knows each licence its publish form offers, by its code and by the answers it's made of", () => {
    for (const [code, given, id] of FORM) {
      expect(qidimakerLicenseFrom({ license: code })).toEqual({ id, raw: code });
      expect(qidimakerLicenseFrom(answers(given))).toEqual({ id, raw: code });
      expect(licenseById(id)).not.toBeNull();
    }
  });

  it("reads each recorded model's licence", () => {
    const details = [
      loadFixture<{ data: Detail }>("qidimaker", "model-detail").data,
      loadFixture<{ data: Detail }>("qidimaker", "model-without-profiles").data,
      ...loadFixture<{ data: { records: Detail[] } }>("qidimaker", "collection-models").data.records,
    ];
    expect(Object.fromEntries(details.map((detail) => [detail.id, qidimakerLicenseFrom(detail)]))).toEqual({
      "2094485343639777281": { id: "sdfl", raw: "STANDARD" },
      "2105158803743387649": { id: "CC-BY-NC-4.0", raw: "BY-NC" },
      "2079504508867624961": { id: "CC0-1.0", raw: "CC0" },
      "2066722423216062465": { id: "CC0-1.0", raw: "CC0" },
      "2087143752360574978": { id: "CC0-1.0", raw: "CC0" },
      "2089830911530577921": { id: "sdfl", raw: "STANDARD" },
    });
  });

  it("goes by the answers, as the model's page does, where they and the code differ", () => {
    expect(qidimakerLicenseFrom({ license: "STANDARD", ...answers([0, 1, 0, 1]) })).toEqual({
      id: "CC-BY-NC-4.0",
      raw: "BY-NC",
    });
    // Answers that make no licence, or one missing, leave the code to say.
    expect(qidimakerLicenseFrom({ license: "BY", ...answers([2, 2, 2, 2]) })).toEqual({ id: "CC-BY-4.0", raw: "BY" });
    expect(qidimakerLicenseFrom({ license: "by-sa", adaptedShared: 2 })).toEqual({ id: "CC-BY-SA-4.0", raw: "BY-SA" });
  });

  it("puts the licence in the model's details", () => {
    const { data } = loadFixture<{ data: Detail }>("qidimaker", "model-detail");
    expect(qidimakerMetaFromDetail(data)!.meta.license).toEqual({ id: "sdfl", raw: "STANDARD" });
  });

  it("gives none where the model names none, and keeps a code it doesn't know", () => {
    for (const license of [undefined, null, "", 3]) expect(qidimakerLicenseFrom({ license })).toBeNull();
    expect(qidimakerLicenseFrom({ license: "BY-XX" })).toEqual({
      id: null,
      raw: "BY-XX",
      label: "QIDI Maker licence BY-XX",
    });
  });
});
