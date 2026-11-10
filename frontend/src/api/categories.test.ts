import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categoriesApi, type Category } from "./categories";

const category = (id: string) => ({ id, name: id }) as Category;

describe("categoriesApi.listShared", () => {
  let served: Category[][];
  let fetches: number;

  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    fetches = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method) return new Response("{}", { status: 200 });
        fetches++;
        const next = served.shift();
        return next ? new Response(JSON.stringify(next), { status: 200 }) : new Response("no", { status: 500 });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fetches once for every lookup, again after a change or a failure, and once for an id it hasn't got", async () => {
    served = [[category("a")]];
    await categoriesApi.listShared("a");
    expect((await categoriesApi.listShared("a")).map((c) => c.id)).toEqual(["a"]);
    expect(fetches).toBe(1);

    // Made by an import since: fetched again once, and not every time after if it's someone else's.
    served = [[category("a"), category("b")], [category("a")]];
    expect((await categoriesApi.listShared("b")).map((c) => c.id)).toEqual(["a", "b"]);
    await categoriesApi.listShared("someone-elses");
    await categoriesApi.listShared("someone-elses");
    expect(fetches).toBe(3);

    // A change made here drops it.
    await categoriesApi.update("a", "A", []);
    served = [[category("a")]];
    await categoriesApi.listShared("a");
    expect(fetches).toBe(4);

    // A failure isn't kept: the next lookup tries again.
    await categoriesApi.update("a", "A", []);
    served = [];
    await expect(categoriesApi.listShared("a")).rejects.toThrow("Failed to list categories");
    served = [[category("a")]];
    expect((await categoriesApi.listShared("a")).map((c) => c.id)).toEqual(["a"]);
  });

  it("doesn't keep a list that was on its way when a category changed", async () => {
    await categoriesApi.update("x", "X", []);
    let release: (value: Response) => void = () => {};
    const stale = new Promise<Response>((resolve) => (release = resolve));
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => stale);
    const lookup = categoriesApi.listShared();
    await categoriesApi.update("a", "Renamed", []);
    // The answer sent before the rename, which has "a" under its old name.
    release(new Response(JSON.stringify([category("a")]), { status: 200 }));
    await lookup;
    served = [[{ ...category("a"), name: "Renamed" }]];
    expect((await categoriesApi.listShared("a")).map((c) => c.name)).toEqual(["Renamed"]);
  });

  it("starts afresh for another account", async () => {
    const users = new Map<string, string>();
    const localStorage = { getItem: (key: string) => users.get(key) ?? null, setItem: () => {}, removeItem: () => {} };
    vi.stubGlobal("window", { localStorage });
    users.set("thingport_auth_user", JSON.stringify({ id: "b" }));
    served = [[category("b-own")], [category("b-own")]];
    await categoriesApi.listShared("someone-elses");
    await categoriesApi.listShared("someone-elses");
    expect(fetches).toBe(2);
    // Signed in as someone else: their list, even for an id the last account had given up on.
    users.set("thingport_auth_user", JSON.stringify({ id: "a" }));
    served = [[category("someone-elses")]];
    expect((await categoriesApi.listShared("someone-elses")).map((c) => c.id)).toEqual(["someone-elses"]);
  });
});
