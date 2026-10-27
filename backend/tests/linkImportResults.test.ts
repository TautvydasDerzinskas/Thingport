import { describe, expect, it } from "vitest";
import {
  mergeLinkResult,
  readLinkResult,
  summarizeLinkResults,
  type LinkImportResult,
} from "../src/services/linkImportResults";

const partial: LinkImportResult = {
  processed: 2,
  imported: 1,
  alreadyInLibrary: 0,
  failed: 1,
  printId: "model",
  stopReason: "rateLimited",
  profiles: true,
};

describe("durable link import results", () => {
  it("counts a partial profile retry as one model while retaining both imported files", () => {
    const merged = mergeLinkResult(partial, {
      ...partial,
      imported: 1,
      alreadyInLibrary: 1,
      failed: 0,
      stopReason: null,
    });
    expect(merged.failed).toBe(0);
    expect(summarizeLinkResults([merged])).toEqual({
      imported: 1,
      alreadyInLibrary: 0,
      profilesImported: 2,
      profilesProcessed: 2,
      printId: "model",
      newPrintIds: ["model"],
    });
  });

  it("recovers completed item outcomes without relying on stale aggregate counters", () => {
    expect(
      summarizeLinkResults([
        partial,
        { ...partial, imported: 0, alreadyInLibrary: 1, printId: "existing", profiles: false },
      ]),
    ).toMatchObject({ imported: 1, alreadyInLibrary: 1, newPrintIds: ["model"] });
    expect(readLinkResult(null)).toBeNull();
  });
});
