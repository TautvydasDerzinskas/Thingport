import { describe, expect, it, vi } from "vitest";
import { loadVoxelshareModel, pageProfileId, shownProfileId, voxelshareModelFrom } from "./api";
import { pickedProfile, profileFiles } from "./adaptSite";
import { voxelshareProfileIds } from "./content";

const FILES = "https://webimage.voxelshare.com/voxelshare/orca/run_flash/284e9b6c92974fe2f24708db6e6b1e16/";

// Cut down from detail/info and detail/print_configs for 8242660: its designer's profile, then the shape of a second of
// theirs, someone else's, a private one and one not shown.
const DETAIL = { modelId: "8242660", modelName: "Flexi mechanical dragon", status: 1 };
const LIST = {
  items: [
    {
      id: "1502104",
      name: "0.2mm layer, 2 walls, 15% infill",
      modelCreator: true,
      status: 1,
      privateFlag: false,
      tmfDownloadUrl: `${FILES}20260429022114_b319ca9e.3mf?t=6af96229&sign=873ee6a89bdfa42e7ee39ce88eff62ec`,
    },
    {
      id: "1502105",
      name: "0.16mm, fine",
      modelCreator: true,
      status: 1,
      privateFlag: false,
      tmfDownloadUrl: `${FILES}b.3mf?t=1&sign=2`,
    },
    {
      id: "1502106",
      name: "Remix",
      modelCreator: false,
      status: 1,
      privateFlag: false,
      tmfDownloadUrl: `${FILES}c.3mf?t=1&sign=2`,
    },
    { id: "1", name: "Private", modelCreator: false, status: 1, privateFlag: true, tmfDownloadUrl: `${FILES}d.3mf` },
    { id: "2", name: "Not shown", modelCreator: true, status: 2, privateFlag: false, tmfDownloadUrl: `${FILES}e.3mf` },
  ],
};

/** The site's API answering every call with `status` and a body that says it went well. */
const answering = (status: number) =>
  vi.fn(async (url: string) => {
    const data = url.includes("detail/info") ? DETAIL : LIST;
    return new Response(JSON.stringify({ code: 0, msg: "OK", data }), { status });
  });

/** A page whose list marks `id` as the profile it shows, or none. */
const pageShowing = (id: string | null) =>
  ({
    querySelector: (selector: string) =>
      id && selector === ".list-container .list-item.active" ? { dataset: { configKey: id } } : null,
  }) as unknown as ParentNode;

describe("a VoxelShare model's profiles", () => {
  const model = voxelshareModelFrom(DETAIL, LIST)!;

  it("are the shown ones in the page's order, each with whose it is", () => {
    expect(model.title).toBe("Flexi mechanical dragon");
    expect(model.profiles.map((p) => [p.id, p.title, p.designer])).toEqual([
      ["1502104", "0.2mm layer, 2 walls, 15% infill", true],
      ["1502105", "0.16mm, fine", true],
      ["1502106", "Remix", false],
    ]);
  });

  it("are 3MFs named after the model, shown by the profile's name, with their signed links", () => {
    expect(profileFiles(model)[0]).toEqual({
      id: "1502104",
      name: "Flexi mechanical dragon.3mf",
      title: "0.2mm layer, 2 walls, 15% infill",
      size: null,
      link: LIST.items[0].tmfDownloadUrl,
    });
  });

  it("are the one the page marks in its list, which its address never names", () => {
    const files = profileFiles(model);
    const page = "https://www.voxelshare.com/en/models/8242660-flexi-mechanical-dragon";
    expect(pickedProfile(page, files, pageShowing("1502106"))).toBe(files[2]);
    expect(pickedProfile(page, files, pageShowing(null))).toBeNull();
    expect(pickedProfile(page, files, pageShowing("999"))).toBe("other");
    // A page opened from Thingport's link, before its list marks one; once it does, the page's pick.
    expect(pickedProfile(`${page}#profileId-1502105`, files, pageShowing(null))).toBe(files[1]);
    expect(pickedProfile(`${page}#profileId-1502105`, files, pageShowing("1502104"))).toBe(files[0]);
    expect(pageProfileId(pageShowing("not a number"))).toBeNull();
  });

  it("are taken the same way by the import panel: the page's pick first, which a link's fragment never follows", () => {
    const page = "https://www.voxelshare.com/en/models/8242660-flexi-mechanical-dragon";
    expect(shownProfileId(`${page}#profileId-1502105`, pageShowing("1502106"))).toBe("1502106");
    expect(shownProfileId(`${page}#profileId-1502105`, pageShowing(null))).toBe("1502105");
    expect(shownProfileId(page, pageShowing(null))).toBeNull();
  });

  it("are offered for import as the backend picks them, the page's own first", () => {
    const { profiles } = model;
    expect(voxelshareProfileIds(profiles, "url", null)).toEqual(["1502104"]);
    expect(voxelshareProfileIds(profiles, "url", "1502106")).toEqual(["1502106"]);
    // The designer's alone, as their import brings no one else's.
    expect(voxelshareProfileIds(profiles, "designer", "1502106")).toEqual(["1502104", "1502105"]);
    expect(voxelshareProfileIds(profiles, "all", "1502106")).toEqual(["1502106", "1502104", "1502105"]);
    // Where the designer made none, the first is theirs to stand in.
    expect(voxelshareProfileIds(profiles.slice(2), "designer", null)).toEqual(["1502106"]);
  });

  it("are none where the page's data can't be read", () => {
    expect(voxelshareModelFrom(null, LIST)).toBeNull();
    expect(voxelshareModelFrom(DETAIL, null)).toEqual({ title: "Flexi mechanical dragon", profiles: [] });
  });

  it("are read only from answers that went well", async () => {
    try {
      vi.stubGlobal("fetch", answering(200));
      expect((await loadVoxelshareModel(DETAIL.modelId))?.profiles).toHaveLength(3);
      vi.stubGlobal("fetch", answering(500));
      expect(await loadVoxelshareModel(DETAIL.modelId)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("are read from the API of the site the page is on", async () => {
    const fetch = answering(200);
    try {
      vi.stubGlobal("fetch", fetch);
      await loadVoxelshareModel(DETAIL.modelId);
      await loadVoxelshareModel(DETAIL.modelId, "cn");
      const hosts = fetch.mock.calls.map(([url]) => new URL(url).host);
      expect(hosts).toEqual(["api.voxelshare.com", "api.voxelshare.com", "api.voxelshare.cn", "api.voxelshare.cn"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
