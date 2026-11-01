import { afterEach, describe, expect, it } from "vitest";
import { createKeyedLock } from "../src/utils/concurrency";

describe("createKeyedLock", () => {
  const seen: unknown[] = [];
  const note = (reason: unknown) => seen.push(reason);

  afterEach(() => {
    process.off("unhandledRejection", note);
    seen.length = 0;
  });

  it("a throw inside the lock reaches its caller and nobody else, so it can't end the process", async () => {
    process.on("unhandledRejection", note);
    const withLock = createKeyedLock();

    await expect(withLock("user", () => Promise.reject(new Error("409 This import changed")))).rejects.toThrow(
      "409 This import changed",
    );

    // Unhandled rejections are reported once the microtasks have run out.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).toEqual([]);
  });

  it("carries on with the next in line after one throws, in order", async () => {
    const withLock = createKeyedLock();
    const order: string[] = [];
    const first = withLock("user", async () => {
      order.push("first");
      throw new Error("no");
    });
    const second = withLock("user", async () => {
      order.push("second");
      return "fine";
    });
    await expect(first).rejects.toThrow("no");
    await expect(second).resolves.toBe("fine");
    expect(order).toEqual(["first", "second"]);
  });

  it("runs one at a time per key, and doesn't make other keys wait", async () => {
    const withLock = createKeyedLock();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const a1 = withLock("a", async () => {
      await held;
      order.push("a1");
    });
    const a2 = withLock("a", async () => {
      order.push("a2");
    });
    await withLock("b", async () => {
      order.push("b");
    });
    expect(order).toEqual(["b"]);
    release();
    await Promise.all([a1, a2]);
    expect(order).toEqual(["b", "a1", "a2"]);
  });
});
