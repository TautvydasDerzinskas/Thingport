import { describe, expect, it, vi } from "vitest";
import { loadQidimakerModel, qidimakerModelFrom } from "./api";
import { pickedProfile, profileFiles } from "./adaptSite";
import { qidimakerProfileIds } from "./content";
import { parseQidimakerModelUrl } from "./urls.generated";

const CDN = "https://public-cdn.qidimaker.com/model/modelConfiguration/20260831/";
const DESIGNER = "2094353516652474370";

// Cut down from getModelDetail and getListByModelId for 2094485343639777281: its designer's two profiles, someone
// else's, one taken down and one private.
const DETAIL = { id: "2094485343639777281", userId: DESIGNER, modelName: "True Flexi Filament Clip" };
const GROUPS = [
  {
    userId: DESIGNER,
    nickname: "Professional3D",
    sliceModelConfigurationVOS: [
      {
        id: "2094485346244440065",
        modelConfigurationName: "Standard v2",
        modelConfigurationUrl: `${CDN}oyn49j12q5/2026-08-31_10a04e3819ac6d.3mf`,
        status: 3,
        visibility: 0,
      },
      {
        id: "2094487632165285889",
        modelConfigurationName: "小号",
        translatedModelConfigurationName: "Small v2",
        modelConfigurationUrl: `${CDN}i0qvex32bw/2026-08-31_c7fdf6a801dbe2.3mf`,
        status: 3,
        visibility: 0,
      },
      { id: "1", modelConfigurationName: "Taken down", modelConfigurationUrl: `${CDN}a.3mf`, status: 4 },
    ],
  },
  {
    userId: "2078051737559678978",
    nickname: "Niko",
    sliceModelConfigurationVOS: [
      {
        id: "2091804233625579522",
        modelConfigurationName: "0.12mm layer",
        modelConfigurationUrl: `${CDN}8q38vyd2h7/2026-08-24_094329b81eba28.3mf`,
        status: 3,
        visibility: 0,
      },
      { id: "2", modelConfigurationName: "Private", modelConfigurationUrl: `${CDN}b.3mf`, status: 3, visibility: 1 },
    ],
  },
];

/** The site's API answering every call with `status` and a body that says it went well. */
const answering = (status: number) =>
  vi.fn(async (url: string) => {
    const data = url.endsWith("getModelDetail") ? DETAIL : GROUPS;
    return new Response(JSON.stringify({ code: 200, data }), { status });
  });

describe("a QIDI Maker model's profiles", () => {
  const model = qidimakerModelFrom(DETAIL, GROUPS)!;

  it("are the shown ones in the page's order, each with whose it is, by its English name", () => {
    expect(model.title).toBe("True Flexi Filament Clip");
    expect(model.profiles.map((p) => [p.id, p.title, p.designer])).toEqual([
      ["2094485346244440065", "Standard v2", true],
      ["2094487632165285889", "Small v2", true],
      ["2091804233625579522", "0.12mm layer", false],
    ]);
  });

  it("are 3MFs named after the model, shown by the profile's name", () => {
    expect(profileFiles(model)[1]).toEqual({
      id: "2094487632165285889",
      name: "True Flexi Filament Clip.3mf",
      title: "Small v2",
      size: null,
      link: `${CDN}i0qvex32bw/2026-08-31_c7fdf6a801dbe2.3mf`,
    });
  });

  it("are the one the page picked, by the profile_id it writes into its address", () => {
    const files = profileFiles(model);
    const page = "https://www.qidimaker.com/en/models/detail/2094485343639777281";
    expect(pickedProfile(`${page}?profile_id=2091804233625579522`, files)).toBe(files[2]);
    expect(pickedProfile(`${page}#profileId-2094487632165285889`, files)).toBe(files[1]);
    expect(pickedProfile(page, files)).toBeNull();
    expect(pickedProfile(`${page}?profile_id=999`, files)).toBe("other");
    // A page opened from Thingport's link, then another profile picked on it: the page's pick, for the import too.
    const both = `${page}?profile_id=2091804233625579522#profileId-2094487632165285889`;
    expect(pickedProfile(both, files)).toBe(files[2]);
    expect(parseQidimakerModelUrl(both)?.requestedProfileId).toBe(files[2].id);
  });

  it("are offered for import as the backend picks them, the page's own first", () => {
    const { profiles } = model;
    expect(qidimakerProfileIds(profiles, "url", null)).toEqual(["2094485346244440065"]);
    expect(qidimakerProfileIds(profiles, "url", "2091804233625579522")).toEqual(["2091804233625579522"]);
    // The designer's alone, as their import brings no one else's, from someone else's page too.
    expect(qidimakerProfileIds(profiles, "designer", "2091804233625579522")).toEqual([
      "2094485346244440065",
      "2094487632165285889",
    ]);
    expect(qidimakerProfileIds(profiles, "all", "2091804233625579522")).toEqual([
      "2091804233625579522",
      "2094485346244440065",
      "2094487632165285889",
    ]);
    // Where the designer made none, the first is theirs to stand in.
    expect(qidimakerProfileIds(profiles.slice(2), "designer", null)).toEqual(["2091804233625579522"]);
  });

  it("are none where the page's data can't be read", () => {
    expect(qidimakerModelFrom(null, GROUPS)).toBeNull();
    expect(qidimakerModelFrom(DETAIL, null)).toEqual({ title: "True Flexi Filament Clip", profiles: [] });
  });

  it("are read only from answers that went well, whatever their body says", async () => {
    try {
      vi.stubGlobal("fetch", answering(200));
      expect((await loadQidimakerModel(DETAIL.id))?.profiles).toHaveLength(3);
      vi.stubGlobal("fetch", answering(500));
      expect(await loadQidimakerModel(DETAIL.id)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
