import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MIN_COUNT, parseMinCount, readMinCount, saveMinCount } from "./minCount";

function stubStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("parseMinCount", () => {
  it.each(["1", "2", "10", "9999"])("takes %s", (text) => {
    expect(parseMinCount(text)).toBe(Number(text));
  });

  it.each([null, "", "0", "-1", "2.5", "abc", "1e400"])("turns down %s", (text) => {
    expect(parseMinCount(text)).toBeNull();
  });
});

describe("the saved choice", () => {
  it("is the default until one is made", () => {
    stubStorage();
    expect(readMinCount()).toBe(DEFAULT_MIN_COUNT);
    expect(DEFAULT_MIN_COUNT).toBe(2);
  });

  it("comes back once saved", () => {
    stubStorage();
    saveMinCount(5);
    expect(readMinCount()).toBe(5);
  });

  it("falls back to the default on junk", () => {
    stubStorage({ thingport_tags_min_count: "lots" });
    expect(readMinCount()).toBe(DEFAULT_MIN_COUNT);
  });

  it("falls back to the default when storage can't be reached", () => {
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("denied");
      },
    });
    expect(readMinCount()).toBe(DEFAULT_MIN_COUNT);
    expect(() => saveMinCount(3)).not.toThrow();
  });
});
