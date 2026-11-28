import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { disputeTransactions } from "./transactions";

let nestedRan = false;
async function nested() {
  await prisma.$transaction(async () => {
    nestedRan = true;
  });
}
async function publish() {
  await nested();
  return prisma.$transaction(async () => "committed");
}
async function publishAndMore() {
  return prisma.$transaction(async () => "committed");
}

describe("disputeTransactions", () => {
  it("ends only the transaction the named function opens itself", async () => {
    const disputed = disputeTransactions({ caller: "publish", outcome: "fails" });
    try {
      // A longer name holding the caller's, and a nested call that opens its own first, run as they would.
      await expect(publishAndMore()).resolves.toBe("committed");
      await expect(publish()).rejects.toThrow("The database went away");
      expect(nestedRan).toBe(true);
      expect(disputed.unconsumed()).toEqual([]);
    } finally {
      disputed.mockRestore();
    }
  });
});
