import { describe, expect, it } from "vitest";
import {
  originalImage,
  voxelshareFilesFrom,
  voxelshareLikesSiteOf,
  voxelshareListOf,
  voxelshareMetaFromDetail,
  voxelshareOriginOf,
  voxelshareSiteIdOf,
} from "../../src/providers/voxelshare/api";
import { voxelshareProfileFactsFrom } from "../../src/providers/voxelshare/profileFacts";
import { loadFixture } from "./support";

// VoxelShare's answers read into Thingport's shapes, from the recorded ones. No database, no network.

describe("VoxelShare metadata", () => {
  it("reads a model's details: pictures at full size, its subcategory first", () => {
    const resolved = voxelshareMetaFromDetail(loadFixture("voxelshare", "model-detail").data)!;
    expect(resolved.meta.title).toBe("Flexi mechanical dragon");
    expect(resolved.meta.siteCategoryIds).toEqual([86, 85]);
    expect(resolved.galleryImages.map((image) => image.filename)).toEqual(["0.png", "2.jpg", "1.png"]);
    expect(resolved.galleryImages[0].url).toMatch(/\/images\/0\.png\?t=[0-9a-f]+&sign=[0-9a-f]+$/);
    expect(resolved.meta.author).toMatchObject({ externalId: "284e9b6c92974fe2f24708db6e6b1e16", name: "Maker 6" });
  });

  it("keeps a model read from the China site under its cn- id, its maker linked there", () => {
    const resolved = voxelshareMetaFromDetail(loadFixture("voxelshare", "model-detail").data, [], [], "cn")!;
    expect(resolved.modelId).toBe("cn-8242660");
    expect(resolved.meta.author?.links).toEqual([
      "https://www.voxelshare.cn/zh/profile/284e9b6c92974fe2f24708db6e6b1e16",
    ]);
    const main = voxelshareMetaFromDetail(loadFixture("voxelshare", "model-detail").data)!;
    expect(main.modelId).toBe("8242660");
    expect(main.meta.author?.links).toEqual(["https://www.voxelshare.com/en/profile/284e9b6c92974fe2f24708db6e6b1e16"]);
  });

  it("tells a kept id's site, and the lists a link is of on either site", () => {
    expect(voxelshareSiteIdOf("cn-8242660")).toEqual({ region: "cn", id: "8242660" });
    expect(voxelshareSiteIdOf("8242660")).toEqual({ region: null, id: "8242660" });
    expect(voxelshareLikesSiteOf("likes")).toBeNull();
    expect(voxelshareLikesSiteOf("cn-likes")).toBe("cn");
    expect(voxelshareLikesSiteOf("cn-664950")).toBeUndefined();
    expect(voxelshareListOf("https://www.voxelshare.cn/zh/print_list?recordTab=like")).toEqual({
      likes: true,
      region: "cn",
    });
    expect(voxelshareListOf("https://www.voxelshare.com/en/collection/664950-a")).toEqual({
      collectionId: "664950",
      region: null,
    });
    expect(voxelshareListOf("https://www.voxelshare.cn/zh/collection/664950-a")).toEqual({
      collectionId: "664950",
      region: "cn",
    });
  });

  it("names where a copied model was first published, by Thingport's provider or the site's host", () => {
    expect(voxelshareOriginOf({ sourceInfo: { url: "https://www.printables.com/model/1-a" } })).toEqual({
      site: "Printables",
      url: "https://www.printables.com/model/1-a",
    });
    expect(voxelshareOriginOf({ sourceInfo: { url: "https://makeronline.cn/zh/model/a/283560.html" } })?.site).toBe(
      "MakerOnline",
    );
    expect(voxelshareOriginOf({ sourceInfo: { url: "https://example.org/a" } })?.site).toBe("example.org");
    // One of its own, or none.
    expect(voxelshareOriginOf({ sourceInfo: { url: "https://www.voxelshare.com/en/models/1" } })).toBeNull();
    expect(voxelshareOriginOf({})).toBeNull();
    expect(voxelshareOriginOf({ sourceInfo: { url: "javascript:alert(1)" } })).toBeNull();
  });

  it("drops the resizing a picture's link asks for after its signature", () => {
    expect(originalImage("https://webimage.voxelshare.com/a/0.png?t=1&sign=2&imageMogr2%2Fthumbnail%2F400x")).toBe(
      "https://webimage.voxelshare.com/a/0.png?t=1&sign=2",
    );
    expect(originalImage({ url: "https://webimage.voxelshare.com/a/0.png?t=1&sign=2" })).toBe(
      "https://webimage.voxelshare.com/a/0.png?t=1&sign=2",
    );
    expect(originalImage("ftp://example.org/a.png")).toBeNull();
  });

  it("reads a model's own files: one kept zipped on its own named as a zip, a folder's in their folder", () => {
    expect(voxelshareFilesFrom(loadFixture("voxelshare", "files").data.items)).toEqual([
      { name: "highland.stl.zip", url: expect.stringContaining("0_highland.stl.zip?t="), folder: null },
    ]);
    const folder = voxelshareFilesFrom(loadFixture("voxelshare", "files-folder").data.items);
    expect(folder).toHaveLength(5);
    expect(folder.every((file) => file.folder === "New Folder1" && file.name.endsWith(".stl"))).toBe(true);
    // A link off its image host is no file of its.
    expect(voxelshareFilesFrom([{ type: 2, name: "a.stl", fileInfo: { url: "https://example.org/a.stl" } }])).toEqual(
      [],
    );
  });

  it("describes a print profile from its list of them", () => {
    const facts = voxelshareProfileFactsFrom(loadFixture("voxelshare", "profiles").data.items);
    expect(facts["1502104"]).toMatchObject({
      title: "0.2mm layer, 2 walls, 15% infill",
      origin: "designer",
      creator: "Maker 6",
      seconds: 8003,
      filaments: [{ type: "PLA", color: "#F2754E", grams: 38.43 }],
      plates: [{ index: 1, seconds: 8003, grams: 38.43 }],
      nozzleMm: 0.4,
    });
    // It lists several printers, so which it was made on is left to its 3MF.
    expect(facts["1502104"].printer).toBeUndefined();
  });
});
