import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyPrinters } from "../api/printers";

const mine = vi.fn<() => Promise<MyPrinters>>();
vi.mock("../api/printers", () => ({ printersApi: { mine: () => mine() } }));

const answer = (bambu: boolean): MyPrinters => ({ printers: [], suggestions: [], bambu });

// The printers are kept for the whole page, so each test gets the module afresh.
async function freshModule() {
  vi.resetModules();
  return import("./useUserPrinters");
}

function pending() {
  let resolve: (value: MyPrinters) => void = () => undefined;
  const promise = new Promise<MyPrinters>((r) => (resolve = r));
  return { promise, resolve };
}

afterEach(() => {
  mine.mockReset();
});

describe("the user's printers", () => {
  it("read again after a read that was out when a change asked for one", async () => {
    const { reloadPrinters } = await freshModule();
    const first = pending();
    mine.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer(true));

    const before = reloadPrinters();
    const afterChange = reloadPrinters();
    const alsoAfterChange = reloadPrinters();
    first.resolve(answer(false));

    expect(await before).toEqual(answer(false));
    expect(await afterChange).toEqual(answer(true));
    expect(await alsoAfterChange).toEqual(answer(true));
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it("aren't read from a request made before a sign-in or sign-out", async () => {
    const { reloadPrinters, resetUserPrinters } = await freshModule();
    const old = pending();
    mine.mockReturnValueOnce(old.promise).mockResolvedValueOnce(answer(true));

    void reloadPrinters();
    resetUserPrinters();
    const fresh = reloadPrinters();
    old.resolve(answer(false));

    expect(await fresh).toEqual(answer(true));
    expect(mine).toHaveBeenCalledTimes(2);
  });
});
