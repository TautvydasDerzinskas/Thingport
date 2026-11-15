import { beforeEach, describe, expect, it, vi } from "vitest";

// Grab's optional sites: a provider's regions are asked for with it, but it counts as on with its main site alone, so
// one given a region in an update stays on for those who allowed it before.
let granted: string[] = [];
let scripts: { id: string; matches: string[] }[] = [];
// Holds an unregistering until released, as a slow browser call would.
let gate: { entered: () => void; until: Promise<void> } | null = null;

vi.stubGlobal("chrome", {
  permissions: {
    contains: async ({ origins }: { origins: string[] }) => origins.every((origin) => granted.includes(origin)),
  },
  scripting: {
    getRegisteredContentScripts: async () => scripts.map((script) => ({ ...script })),
    registerContentScripts: async (list: { id: string; matches: string[] }[]) => {
      scripts.push(...list.map(({ id, matches }) => ({ id, matches })));
    },
    unregisterContentScripts: async ({ ids }: { ids: string[] }) => {
      if (gate) {
        gate.entered();
        await gate.until;
      }
      scripts = scripts.filter((script) => !ids.includes(script.id));
    },
  },
});

const { OPTIONAL_SITES, regionEnabled, siteEnabled, syncSiteScripts } = await import("./optionalSites");

const snapmaker = OPTIONAL_SITES.find((site) => site.id === "snapmaker")!;
const MAIN = ["*://space.snapmaker.com/*", "*://id.snapmaker.com/*"];
const CHINA = ["*://space.snapmaker.cn/*", "*://id.snapmaker.cn/*"];

beforeEach(() => {
  granted = [];
  scripts = [];
  gate = null;
});

describe("a provider's regions among Grab's optional sites", () => {
  it("are asked for with it, and told apart from its main site", () => {
    expect(snapmaker.origins).toEqual([...MAIN, ...CHINA]);
    expect(snapmaker.main).toEqual(MAIN);
    expect(snapmaker.regions).toEqual({ cn: CHINA });
    // A provider without regions counts as on with everything it asks for.
    const plain = OPTIONAL_SITES.find((site) => site.id === "nexprint")!;
    expect(plain.main).toEqual(plain.origins);
    expect(plain.regions).toEqual({});
  });

  it("leave a site on that was allowed before it had them, and Grab off in the region until it's allowed too", async () => {
    granted = [...MAIN];
    expect(await siteEnabled(snapmaker)).toBe(true);
    expect(await regionEnabled(snapmaker, "cn")).toBe(false);
    await syncSiteScripts();
    expect(scripts.find((script) => script.id === "site-snapmaker")?.matches).toEqual(MAIN);

    granted = [...MAIN, ...CHINA];
    expect(await regionEnabled(snapmaker, "cn")).toBe(true);
    await syncSiteScripts();
    expect(scripts.filter((script) => script.id === "site-snapmaker")).toEqual([
      { id: "site-snapmaker", matches: [...MAIN, ...CHINA] },
    ]);
  });

  it("are registered a pass at a time, so one begun earlier can't undo a later one", async () => {
    granted = [...MAIN, ...CHINA];
    await syncSiteScripts();
    // China taken back, then given again while that pass is still dropping the registration.
    granted = [...MAIN];
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      gate = { entered: resolve, until: new Promise<void>((done) => (release = done)) };
    });
    const first = syncSiteScripts();
    await entered;
    granted = [...MAIN, ...CHINA];
    const second = syncSiteScripts();
    gate = null;
    release();
    await Promise.all([first, second]);
    expect(scripts.filter((script) => script.id === "site-snapmaker")).toEqual([
      { id: "site-snapmaker", matches: [...MAIN, ...CHINA] },
    ]);
  });

  it("don't turn a site on by themselves", async () => {
    granted = [...CHINA];
    expect(await siteEnabled(snapmaker)).toBe(false);
    await syncSiteScripts();
    expect(scripts.find((script) => script.id === "site-snapmaker")).toBeUndefined();
  });
});
