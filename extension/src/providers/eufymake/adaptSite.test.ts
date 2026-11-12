import { describe, expect, it } from "vitest";
import { modelFiles, pickedFile, shownName } from "./adaptSite";

const LINK = "https://d3c3n9aoannddt.cloudfront.net/makeitreal/makeitreal/ugc_model/default/1/a/";

// Cut down from get_model_detail for e2e98e9a110011ef91d13a215133689a: two print files, two STLs and the zip of all.
const MODEL = {
  model_print_infos: [
    { info_id: 546, print_name: "Bedscraper_v2.3mf", print_size: 18711, file_3mf_key: `${LINK}Bedscraper_v2.3mf?sig` },
    {
      info_id: 547,
      print_name: "Bedscraper_Large.3mf",
      print_size: 33377,
      file_3mf_key: `${LINK}Bedscraper_Large.3mf?sig`,
    },
    { info_id: 548, print_name: "No link.3mf", print_size: 1 },
  ],
  model_file: [
    { file_id: 6801, file_type: 1, file_name: "Bedscraper_v2.stl", file_size: 26984, download_link: `${LINK}s?sig` },
    {
      file_id: 6804,
      file_type: 1,
      file_name: "Bedscraper_v2.3mf",
      file_size: 0,
      download_link: `${LINK}Bedscraper_v2.3mf?own`,
    },
    { file_id: 6803, file_type: 2, file_name: "All.zip", file_size: 106666, download_link: `${LINK}z?sig` },
  ],
};

describe("an eufyMake model's 3MFs", () => {
  const files = modelFiles(MODEL);

  it("are its print files, then its own 3MFs, each with its signed link", () => {
    expect(files).toEqual([
      { id: "p546", name: "Bedscraper_v2.3mf", size: 18711, link: `${LINK}Bedscraper_v2.3mf?sig` },
      { id: "p547", name: "Bedscraper_Large.3mf", size: 33377, link: `${LINK}Bedscraper_Large.3mf?sig` },
      { id: "f6804", name: "Bedscraper_v2.3mf", size: null, link: `${LINK}Bedscraper_v2.3mf?own` },
    ]);
  });

  it("are none where it lists no print files or model files", () => {
    expect(modelFiles({ model_print_infos: null, model_file: null })).toEqual([]);
  });
});

describe("a name as eufyMake's file list shows it", () => {
  it("is whole up to 28 characters", () => {
    expect(shownName("Bedscraper_Large.3mf")).toBe("Bedscraper_Large.3mf");
  });

  it("is its start and end past that, as the page's own shortening does", () => {
    expect(shownName("Two_Color_Articulated_Crocodile_Keychain_P1S.3mf")).toBe(
      "Two_Color_Articulat...le_Keychain_P1S.3mf",
    );
  });
});

describe("the eufyMake 3MF a page has picked", () => {
  const files = modelFiles(MODEL);

  it("is the print file of that name, in the first list", () => {
    expect(pickedFile(files, 0, "Bedscraper_Large.3mf")?.id).toBe("p547");
  });

  it("is the model file of that name in the second, though a print file has the same", () => {
    expect(pickedFile(files, 1, "Bedscraper_v2.3mf")?.id).toBe("f6804");
  });

  it("is the model file in the first list where there are no print files", () => {
    const own = files.filter((file) => file.id.startsWith("f"));
    expect(pickedFile(own, 0, "Bedscraper_v2.3mf")?.id).toBe("f6804");
  });

  it("is none for an STL picked", () => {
    expect(pickedFile(files, 1, "Bedscraper_v2.stl")).toBeNull();
  });

  it("matches a long name by its shortened form", () => {
    const long = "Two_Color_Articulated_Crocodile_Keychain_P1S.3mf";
    const listed = modelFiles({ model_file: [{ file_id: 1, file_type: 1, file_name: long, download_link: LINK }] });
    expect(pickedFile(listed, 0, shownName(long))?.name).toBe(long);
  });
});
