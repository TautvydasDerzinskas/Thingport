import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyPrinters, PrinterSuggestion } from "../api/printers";

const mine = vi.fn<() => Promise<MyPrinters>>();
vi.mock("../api/printers", () => ({ printersApi: { mine: () => mine() } }));

const answer = (bambu: boolean): MyPrinters => ({ printers: [], suggestions: [], bambu });
const suggestion = (i: number): PrinterSuggestion => ({
  printer: {
    id: `brand-${i}`,
    brand: "brand",
    model: `Model ${i}`,
    bed: null,
    height: null,
    nozzles: ["0.4"],
    extruders: 1,
  },
  brandName: "Brand",
  nozzle: "0.4",
  sliced: i,
  projects: 0,
  declined: false,
});
// An answer told apart from others by its suggestions' count.
const nth = (n: number): MyPrinters => ({
  printers: [],
  suggestions: Array.from({ length: n }, (_, i) => suggestion(i)),
  bambu: false,
});

/** What a component using the hook gets now: its first render reads the shared cache. */
function seen(useUserPrinters: () => MyPrinters): MyPrinters {
  const rendered: MyPrinters[] = [];
  renderToStaticMarkup(
    createElement(() => {
      rendered.push(useUserPrinters());
      return null;
    }),
  );
  const [value] = rendered;
  if (!value) throw new Error("The hook didn't render");
  return value;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    const { reloadPrinters, resetUserPrinters, useUserPrinters } = await freshModule();
    const old = pending();
    mine.mockReturnValueOnce(old.promise).mockResolvedValueOnce(answer(true));

    void reloadPrinters();
    resetUserPrinters();
    expect(await reloadPrinters()).toEqual(answer(true));
    // The old account's answer comes last, and the new one's stays.
    old.resolve(answer(false));
    await settle();

    expect(seen(useUserPrinters).bambu).toBe(true);
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it("aren't read again for a reload queued before a sign-in or sign-out, beside the new account's reads", async () => {
    const { reloadPrinters, resetUserPrinters, useUserPrinters } = await freshModule();
    const [old, first, second, third] = [pending(), pending(), pending(), pending()];
    mine
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);

    void reloadPrinters();
    void reloadPrinters();
    resetUserPrinters();
    void reloadPrinters();
    old.resolve(answer(false));
    await settle();
    // A printer changed while the new account's first read was out.
    const afterChange = reloadPrinters();
    second.resolve(nth(2));
    third.resolve(nth(2));
    first.resolve(nth(1));

    expect((await afterChange).suggestions).toHaveLength(2);
    await settle();
    expect(seen(useUserPrinters).suggestions).toHaveLength(2);
    expect(mine).toHaveBeenCalledTimes(3);
  });
});
