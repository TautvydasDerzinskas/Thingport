import { afterEach, describe, expect, it, vi } from "vitest";
import type { Collection } from "../../api/collections";
import { collectionType, readHiddenTypes, saveHiddenTypes } from "./collectionTypes";

function stubStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
}

const collection = (fields: Partial<Collection>) => ({ system_key: null, tool_id: null, ...fields }) as Collection;

afterEach(() => vi.unstubAllGlobals());

describe("collectionType", () => {
  it("tells the three apart", () => {
    expect(collectionType(collection({ system_key: "favorites" }))).toBe("system");
    expect(collectionType(collection({ tool_id: "t1" }))).toBe("tool");
    expect(collectionType(collection({}))).toBe("user");
  });
});

describe("the hidden types", () => {
  it("are none until some are turned off", () => {
    stubStorage();
    expect(readHiddenTypes()).toEqual([]);
  });

  it("come back once saved", () => {
    stubStorage();
    saveHiddenTypes(["tool", "system"]);
    expect(readHiddenTypes()).toEqual(["system", "tool"]);
  });

  it.each(["not json", '{"a":1}', '["nonsense"]'])("ignore junk: %s", (stored) => {
    stubStorage({ thingport_collections_hidden_types: stored });
    expect(readHiddenTypes()).toEqual([]);
  });

  it("are none when storage can't be reached", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("denied");
      },
    });
    expect(readHiddenTypes()).toEqual([]);
    expect(() => saveHiddenTypes(["user"])).not.toThrow();
  });
});
