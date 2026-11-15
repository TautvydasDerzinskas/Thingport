import { afterEach, describe, expect, it, vi } from "vitest";
import { EUFYMAKE_ADAPT, modelFiles, pickedFile } from "./adaptSite";

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

  it("are its print files, then its own 3MFs, each with its signed link and the row the page shows it in", () => {
    expect(files).toEqual([
      { id: "p546", name: "Bedscraper_v2.3mf", size: 18711, link: `${LINK}Bedscraper_v2.3mf?sig`, row: "0:0" },
      {
        id: "p547",
        name: "Bedscraper_Large.3mf",
        size: 33377,
        link: `${LINK}Bedscraper_Large.3mf?sig`,
        row: "0:1",
      },
      { id: "f6804", name: "Bedscraper_v2.3mf", size: null, link: `${LINK}Bedscraper_v2.3mf?own`, row: "1:1" },
    ]);
  });

  it("are in the first box where it has no print files", () => {
    expect(modelFiles({ model_file: MODEL.model_file }).map((file) => file.row)).toEqual(["0:1"]);
  });

  it("are placed among the files its Model Files box shows, which leave out the zip of all", () => {
    const zipFirst = [MODEL.model_file[2], MODEL.model_file[1]];
    expect(modelFiles({ model_file: zipFirst }).map((file) => file.row)).toEqual(["0:0"]);
  });

  it("are none where it lists no print files or model files", () => {
    expect(modelFiles({ model_print_infos: null, model_file: null })).toEqual([]);
  });
});

describe("the eufyMake 3MF a page has picked", () => {
  const files = modelFiles(MODEL);

  it("is the print file in that row of the first box", () => {
    expect(pickedFile(files, "0:1")).toMatchObject({ id: "p547" });
  });

  it("is the model file in that row of the second, though a print file has its name", () => {
    expect(pickedFile(files, "1:1")).toMatchObject({ id: "f6804" });
  });

  it("is told from another of the same name by its row", () => {
    const twins = modelFiles({
      model_print_infos: [
        { info_id: 1, print_name: "plate.3mf", file_3mf_key: `${LINK}1` },
        { info_id: 2, print_name: "plate.3mf", file_3mf_key: `${LINK}2` },
      ],
    });
    expect(pickedFile(twins, "0:1")).toMatchObject({ id: "p2" });
  });

  it("is another file for an STL, or a print file it has no link for, which get no copy", () => {
    expect(pickedFile(files, "1:0")).toBe("other");
    expect(pickedFile(files, "0:2")).toBe("other");
  });
});

/** eufyMake's file list as its page renders it: a box of `counts[box]` rows each, the row at `picked` active. */
function fileList(counts: number[], picked?: [box: number, place: number]) {
  const rows = counts.map((count) => Array.from({ length: count }, () => ({})));
  const active = picked ? rows[picked[0]][picked[1]] : null;
  const boxes = rows.map((list) => ({ contains: (el: object) => list.includes(el), querySelectorAll: () => list }));
  vi.stubGlobal("document", {
    querySelector: (selector: string) => (selector.includes("--active") ? active : null),
    querySelectorAll: (selector: string) => (selector.includes("--filesBox") ? boxes : []),
  });
}

describe("the row eufyMake's page has picked", () => {
  const files = modelFiles(MODEL);
  afterEach(() => vi.unstubAllGlobals());

  it("is the 3MF at its place in its box", () => {
    fileList([3, 2], [0, 1]);
    expect(EUFYMAKE_ADAPT.selected!(files)).toMatchObject({ id: "p547" });
    fileList([3, 2], [1, 1]);
    expect(EUFYMAKE_ADAPT.selected!(files)).toMatchObject({ id: "f6804" });
  });

  it("is another file where it's an STL", () => {
    fileList([3, 2], [1, 0]);
    expect(EUFYMAKE_ADAPT.selected!(files)).toBe("other");
  });

  it("is none where no row is picked", () => {
    fileList([3, 2]);
    expect(EUFYMAKE_ADAPT.selected!(files)).toBeNull();
  });
});
