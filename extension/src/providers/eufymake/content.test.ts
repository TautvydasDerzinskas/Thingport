import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEufymakeProfiles } from "./content";

const MODEL_ID = "9255b7378ac611efa154f2247282c358";
const MODEL_URL = `https://makeitreal.eufymake.com/models/${MODEL_ID}/Halloween/`;
const FILE = "https://d3c3n9aoannddt.cloudfront.net/makeitreal/ugc_model/ghost.3mf?X-Amz-Signature=a";

/** eufyMake's model detail, with these print files. */
function serves(infos: Record<string, unknown>[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => ({ code: 0, data: { model: { model_print_infos: infos } } }) })),
  );
}

describe("an eufyMake model's print files, as Grab's panel offers them", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("are the ones with an id and a 3MF, the linked one first", async () => {
    serves([
      { info_id: 546, file_3mf_key: FILE },
      { info_id: "547", file_3mf_key: FILE },
    ]);
    const pick = await loadEufymakeProfiles(`${MODEL_URL}#profileId-547`);
    expect(pick?.("url")).toEqual(["547"]);
    expect(pick?.("all")).toEqual(["547", "546"]);
  });

  it("leave out one whose 3MF link is blank, which the instance can't import", async () => {
    serves([
      { info_id: 546, file_3mf_key: "  " },
      { info_id: 547, file_3mf_key: FILE },
    ]);
    const pick = await loadEufymakeProfiles(MODEL_URL);
    expect(pick?.("all")).toEqual(["547"]);
  });

  it("take an id written with spaces round it, as the instance does", async () => {
    serves([{ info_id: " 546 ", file_3mf_key: FILE }]);
    expect((await loadEufymakeProfiles(MODEL_URL))?.("all")).toEqual(["546"]);
  });

  it("leave out one without a whole-number id", async () => {
    serves([
      { info_id: "5a", file_3mf_key: FILE },
      { info_id: null, file_3mf_key: FILE },
      { file_3mf_key: FILE },
    ]);
    expect((await loadEufymakeProfiles(MODEL_URL))?.("all")).toEqual([]);
  });
});
