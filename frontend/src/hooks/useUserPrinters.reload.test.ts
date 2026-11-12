import { afterEach, describe, expect, it, vi } from "vitest";
import type { MyPrinters } from "../api/printers";

// The hook's state as a mounted component keeps it, without a DOM: each useState is a cell kept between renders, an
// effect runs once, on the first (its dependencies don't change here), and a callback is the function itself.
const cells: unknown[] = [];
const ran = new Set<number>();
let cursor = 0;
vi.mock("react", () => ({
  useState: <T>(initial: T) => {
    const index = cursor++;
    if (!(index in cells)) cells[index] = initial;
    return [cells[index], (next: T) => (cells[index] = next)];
  },
  useEffect: (effect: () => void) => {
    const index = cursor++;
    if (ran.has(index)) return;
    ran.add(index);
    effect();
  },
  useCallback: <T>(callback: T) => callback,
}));

const mine = vi.fn<() => Promise<MyPrinters>>();
vi.mock("../api/printers", () => ({ printersApi: { mine: () => mine() } }));

const answer: MyPrinters = { printers: [], suggestions: [], bambu: true };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function pending() {
  let reject: (err: Error) => void = () => undefined;
  let resolve: (value: MyPrinters) => void = () => undefined;
  const promise = new Promise<MyPrinters>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A component using the hook, mounted afresh: `render()` is what it gets each time it renders. */
async function mounted() {
  vi.resetModules();
  cells.length = 0;
  ran.clear();
  const { useUserPrinters } = await import("./useUserPrinters");
  return () => {
    cursor = 0;
    return useUserPrinters();
  };
}

afterEach(() => {
  mine.mockReset();
});

describe("trying the user's printers again", () => {
  it("leaves them unknown while it runs after a read that failed, and known again when it's done", async () => {
    const render = await mounted();
    mine.mockRejectedValueOnce(new Error("down"));
    render();
    await settle();
    expect(render()).toMatchObject({ loaded: true, failed: true });

    const retry = pending();
    mine.mockReturnValueOnce(retry.promise);
    const reloading = render().reload();
    // Nothing to show meanwhile: no copy is made for no printers.
    expect(render()).toMatchObject({ loaded: false, failed: false });
    retry.reject(new Error("still down"));
    await expect(reloading).rejects.toThrow("still down");
    expect(render()).toMatchObject({ loaded: true, failed: true });

    mine.mockResolvedValueOnce(answer);
    await render().reload();
    expect(render()).toMatchObject({ loaded: true, failed: false, bambu: true });
  });

  it("keeps the answer it has known while it reads them again", async () => {
    const render = await mounted();
    mine.mockResolvedValueOnce(answer);
    render();
    await settle();
    const retry = pending();
    mine.mockReturnValueOnce(retry.promise);
    const reloading = render().reload();
    expect(render()).toMatchObject({ loaded: true, failed: false, bambu: true });
    retry.resolve(answer);
    await reloading;
  });
});
