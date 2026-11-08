import { beforeEach, describe, expect, it, vi } from "vitest";

const contentModules: Record<string, Record<string, unknown>> = {};
vi.mock("../providers/content", () => ({
  CONTENT_MODULES: new Proxy({}, { get: (_target, provider: string) => contentModules[provider] ?? {} }),
}));

const { loadMissingProfiles, missingOf, profileUrl, withoutHeld } = await import("./profiles");

/** A page whose profiles 1 and 2 are the designer's and 3 and 4 the community's. */
const page = (scope: string) => (scope === "url" ? ["1"] : scope === "designer" ? ["1", "2"] : ["1", "2", "3", "4"]);

describe("a page's print profiles next to the library's model", () => {
  beforeEach(() => {
    for (const provider of Object.keys(contentModules)) delete contentModules[provider];
  });

  it("leaves out the ones the model has, whatever case the instance keeps them in", () => {
    expect(withoutHeld(["G1", "g2", "abc"], ["g1", "ABC"])).toEqual(["g2"]);
  });

  it("lists what's missing, every one and the designer's, the page's own first", () => {
    expect(missingOf(page, ["2"])).toEqual({ total: 4, all: ["1", "3", "4"], designer: ["1"] });
    expect(missingOf(page, ["1", "2", "3", "4"])).toEqual({ total: 4, all: [], designer: [] });
  });

  it("can't tell on a page without profiles", () => {
    expect(missingOf(() => [], [])).toBeNull();
  });

  it("can't tell from an instance that doesn't say which the model has", async () => {
    const loadProfiles = vi.fn(async () => page);
    contentModules.makerworld = { loadProfiles };
    expect(await loadMissingProfiles("makerworld", "https://makerworld.com/en/models/1", undefined)).toBeNull();
    expect(loadProfiles).not.toHaveBeenCalled();
  });

  it("can't tell where the site has no profiles, or won't list them", async () => {
    expect(await loadMissingProfiles("printables", "https://www.printables.com/model/1", [])).toBeNull();
    contentModules.makerworld = { loadProfiles: async () => Promise.reject(new Error("offline")) };
    expect(await loadMissingProfiles("makerworld", "https://makerworld.com/en/models/1", [])).toBeNull();
  });

  it("names a profile as the site's own links do, or in the hash", () => {
    contentModules.nexprint = { profileUrl: (url: string, id: string) => `${url}?printConfigId=${id}` };
    expect(profileUrl("nexprint", "https://www.nexprint.com/en/models/G1", "G2")).toBe(
      "https://www.nexprint.com/en/models/G1?printConfigId=G2",
    );
    expect(profileUrl("makerworld", "https://makerworld.com/en/models/1#profileId-5", "6")).toBe(
      "https://makerworld.com/en/models/1#profileId-6",
    );
  });
});
