import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, unknown> = {};

vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (values: Record<string, unknown>) => void Object.assign(store, values),
      remove: async (key: string) => void delete store[key],
    },
  },
});

const { forgetProviderTab, forgetProviderTabs, getTabProvider, noteProviderTab } = await import("./providerTab");

describe("providerTab", () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
  });

  it("keeps a note per tab, so the popup finds the one it asks about", async () => {
    await noteProviderTab("printables", 1);
    await noteProviderTab("thingiverse", 2);
    expect(await getTabProvider(1)).toBe("printables");
    expect(await getTabProvider(2)).toBe("thingiverse");
    expect(await getTabProvider(3)).toBeNull();
  });

  it("loses neither of two tabs reporting at once", async () => {
    await Promise.all([noteProviderTab("printables", 1), noteProviderTab("thingiverse", 2)]);
    expect(await getTabProvider(1)).toBe("printables");
    expect(await getTabProvider(2)).toBe("thingiverse");
  });

  it("replaces the tab's own note when it moves to another provider", async () => {
    await noteProviderTab("printables", 1);
    await noteProviderTab("makerworld", 1);
    expect(await getTabProvider(1)).toBe("makerworld");
  });

  it("writes nothing when the tab says what it said before", async () => {
    await noteProviderTab("printables", 1);
    const set = vi.spyOn(chrome.storage.local, "set");
    await noteProviderTab("printables", 1);
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it("forgets one tab and leaves the others", async () => {
    await noteProviderTab("printables", 1);
    await noteProviderTab("thingiverse", 2);
    await forgetProviderTab(1);
    expect(await getTabProvider(1)).toBeNull();
    expect(await getTabProvider(2)).toBe("thingiverse");
  });

  it("clears the key once the last note goes, and on a new browser session", async () => {
    await noteProviderTab("printables", 1);
    await forgetProviderTab(1);
    expect(store).toEqual({});
    await noteProviderTab("printables", 1);
    await forgetProviderTabs();
    expect(store).toEqual({});
  });
});
