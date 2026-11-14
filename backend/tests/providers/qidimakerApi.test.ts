import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQidimakerDetail } from "../../src/providers/qidimaker/api";
import { installFetch, json, type FetchStub } from "./support";

// How QIDI Maker's API is asked: its retries, with their waits made instant. No database.

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

vi.mock("../../src/utils/concurrency", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/utils/concurrency")>()),
  sleep: async () => undefined,
}));

const STALE = 2012;

let stub: FetchStub | null = null;

afterEach(() => {
  stub?.restore();
  stub = null;
});

describe("QIDI Maker's API", () => {
  it("waits out a limit on the request sent again by its clock too, then says it's rate-limited", async () => {
    let calls = 0;
    stub = installFetch(({ url }) => {
      if (url.hostname !== "www.qidimaker.com") return undefined;
      calls++;
      // The first is turned down for its timestamp, and every one after it for the limit.
      if (calls === 1) return json({ code: STALE, message: "Request expired", timestamp: Date.now() + 120_000 });
      return json({ code: 429, message: "Too many requests" }, 429);
    });
    await expect(fetchQidimakerDetail("2094485343639777281")).rejects.toMatchObject({ status: 429 });
    // The first, the one by its clock, and the three that wait out the limit.
    expect(calls).toBe(5);
  });
});
