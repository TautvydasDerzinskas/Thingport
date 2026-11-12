import { describe, expect, it } from "vitest";
import { eufymakeMetaFromDetail, selectEufymakeProfiles } from "../src/providers/eufymake/api";
import { eufymakeProfileFactsFrom } from "../src/providers/eufymake/profileFacts";

const CDN = "https://d3c3n9aoannddt.cloudfront.net/makeitreal/makeitreal/ugc_model/default/c4b4/";

// Cut down from get_model_detail for e2e98e9a110011ef91d13a215133689a: two print files beside its STLs.
const MODEL = {
  model_id: "e2e98e9a110011ef91d13a215133689a",
  name: "Double-sided bed scraper",
  user: { user_id: "c4b4a04026478c9c01d16085e48989d755e9b3f7", nickname: "AnkerMake Fan" },
  model_file: [
    { file_type: 1, file_name: "Bedscraper_v2.stl", download_link: `${CDN}Bedscraper_v2.stl?sig` },
    { file_type: 2, file_name: "Double-sided bed scraper.zip", download_link: `${CDN}all.zip?sig` },
  ],
  model_print_infos: [
    {
      info_id: 546,
      print_name: "Bedscraper_v2.3mf",
      file_3mf_key: `${CDN}Bedscraper_v2.3mf?sig`,
      cover_url: `${CDN}Bedscraper_v2.png`,
      printer: "M5C",
      nozzle: "0.4",
      material: "PLA+",
      multi_colors: 2,
      print_time: 1277,
      print_weight: 6,
      print_layer_height: 0,
      print_infill: 25,
      walls_num: 3,
    },
    {
      info_id: 547,
      print_name: "Bedscraper_Large.3mf",
      file_3mf_key: `${CDN}Bedscraper_Large.3mf?sig`,
      printer: "四角",
      nozzle: "0.4",
      material: "PLA+",
      print_time: 2765,
      print_weight: 13,
      print_infill: 25,
      walls_num: 3,
    },
    { info_id: 548, print_name: "No link.3mf" },
  ],
};

describe("an eufyMake model's print files", () => {
  const resolved = eufymakeMetaFromDetail(MODEL)!;

  it("are its print profiles, each with its link, name and picture, in the site's order", () => {
    expect(resolved.profiles).toEqual([
      {
        id: "546",
        name: "Bedscraper_v2.3mf",
        title: "Bedscraper_v2",
        url: `${CDN}Bedscraper_v2.3mf?sig`,
        coverUrl: `${CDN}Bedscraper_v2.png`,
      },
      {
        id: "547",
        name: "Bedscraper_Large.3mf",
        title: "Bedscraper_Large",
        url: `${CDN}Bedscraper_Large.3mf?sig`,
        coverUrl: null,
      },
    ]);
    // The model files are kept for a model without print files, as before.
    expect(resolved.files.map((file) => file.name)).toEqual(["Bedscraper_v2.stl"]);
  });

  it("are none for a model without them", () => {
    expect(eufymakeMetaFromDetail({ ...MODEL, model_print_infos: null })!.profiles).toEqual([]);
  });

  it("are picked by scope: the one a link names, else the first; every one for the designer's and all", () => {
    expect(selectEufymakeProfiles(resolved, "url", "547")).toEqual(["547"]);
    expect(selectEufymakeProfiles(resolved, "url", null)).toEqual(["546"]);
    expect(selectEufymakeProfiles(resolved, "url", "999")).toEqual(["546"]);
    expect(selectEufymakeProfiles(resolved, "designer", null)).toEqual(["546", "547"]);
    expect(selectEufymakeProfiles(resolved, "all", null)).toEqual(["546", "547"]);
    expect(selectEufymakeProfiles({ profiles: [] }, "url", null)).toEqual([]);
  });
});

describe("what the model page shows of an eufyMake print file", () => {
  const facts = eufymakeProfileFactsFrom(MODEL);

  it("is what its model data says, in seconds and grams, by the designer", () => {
    expect(facts["546"]).toEqual({
      title: "Bedscraper_v2",
      origin: "designer",
      creator: "AnkerMake Fan",
      seconds: 1277,
      grams: 6,
      filaments: [{ type: "PLA+", color: null, grams: 6 }],
      printer: "AnkerMake M5C",
      nozzleMm: 0.4,
      infill: "25%",
      walls: 3,
    });
  });

  it("names a printer only where it's one of AnkerMake's, and leaves out a layer height of 0", () => {
    expect(facts["547"].printer).toBeUndefined();
    expect(facts["546"].layerMm).toBeUndefined();
  });

  it("is there for each print file, a link or not", () => {
    expect(Object.keys(facts)).toEqual(["546", "547", "548"]);
  });
});
