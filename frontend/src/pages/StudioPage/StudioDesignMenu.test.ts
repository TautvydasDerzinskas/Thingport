import { describe, expect, it } from "vitest";
import type { StudioDesignSummary } from "../../api/studio";
import { recentDesigns } from "./StudioDesignMenu";

const design = (id: string, updated_at: string): StudioDesignSummary => ({
  id,
  name: id,
  feature_count: 1,
  version: 1,
  updated_at,
});

describe("recentDesigns", () => {
  const designs = [
    design("old", "2026-11-01T10:00:00Z"),
    design("open", "2026-11-22T10:00:00Z"),
    design("newest", "2026-11-21T10:00:00Z"),
    design("middle", "2026-11-10T10:00:00Z"),
    design("older", "2026-11-05T10:00:00Z"),
  ];

  it("lists the last edited first, leaving out the open design", () => {
    expect(recentDesigns(designs, "open").map((entry) => entry.id)).toEqual(["newest", "middle", "older"]);
  });

  it("takes the latest ones when no design is open", () => {
    expect(recentDesigns(designs, null).map((entry) => entry.id)).toEqual(["open", "newest", "middle"]);
  });

  it("leaves the list it was given as it was", () => {
    const before = designs.map((entry) => entry.id);
    recentDesigns(designs, "open");
    expect(designs.map((entry) => entry.id)).toEqual(before);
  });
});
