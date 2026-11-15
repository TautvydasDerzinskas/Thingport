import { describe, expect, it } from "vitest";
import { pickedProfile, profileFiles, unbought } from "./adaptSite";

describe("a Creality Cloud model's print profiles", () => {
  const files = profileFiles({
    list: [
      { id: "6A53E0483BB1F114764BB323", secondName: " !New! Multicolor 3 Color 0.16mm layer ", size: 17890476 },
      { id: "686d66ff97fb0b32d54ef913", secondName: "", size: 0 },
      { secondName: "no id" },
    ],
  });

  it("are files shown by the profile's name, their file named once it's downloaded", () => {
    expect(files).toEqual([
      {
        id: "6a53e0483bb1f114764bb323",
        name: "!New! Multicolor 3 Color 0.16mm layer.3mf",
        title: "!New! Multicolor 3 Color 0.16mm layer",
        size: 17890476,
      },
      { id: "686d66ff97fb0b32d54ef913", name: "model.3mf", title: "", size: null },
    ]);
    expect(profileFiles(null)).toEqual([]);
  });

  it("follow the one the page has picked, by its own address or a link Thingport made", () => {
    const page = "https://www.crealitycloud.com/model-detail/articulated-cute-crab";
    expect(pickedProfile(`${page}?profileId=686D66FF97FB0B32D54EF913`, files)).toMatchObject({
      id: "686d66ff97fb0b32d54ef913",
    });
    expect(pickedProfile(`${page}#profileId-686d66ff97fb0b32d54ef913`, files)).toMatchObject({
      id: "686d66ff97fb0b32d54ef913",
    });
    expect(pickedProfile(page, files)).toBeNull();
  });

  it("don't put another in place of a profile the page names but the site gives no file for", () => {
    const page = "https://www.crealitycloud.com/model-detail/articulated-cute-crab";
    expect(pickedProfile(`${page}?profileId=0123456789abcdef01234567`, files)).toBe("other");
    expect(pickedProfile(`${page}#profileId-0123456789abcdef01234567`, files)).toBe("other");
  });
});

describe("a paid Creality Cloud model", () => {
  it("has nothing to offer until it's bought", () => {
    expect(unbought({ isPay: true, isPurchased: false })).toBe(true);
    expect(unbought({ isPay: true })).toBe(true);
    expect(unbought({ isPay: true, isPurchased: true })).toBe(false);
    expect(unbought({ isPay: false, isPurchased: false })).toBe(false);
    expect(unbought(undefined)).toBe(false);
  });
});
