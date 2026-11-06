import { describe, expect, it } from "vitest";
import type { PlateProfile } from "../api/prints";
import { platesToList } from "./ProfileDetails";

const profile = (over: Partial<PlateProfile>): PlateProfile => ({
  title: null,
  printer: null,
  nozzle_mm: null,
  layer_height_mm: null,
  materials: [],
  plates: null,
  estimated_seconds: null,
  weight_g: null,
  plate_stats: [],
  ...over,
});
const plate = (index: number) => ({ index, name: null, objectCount: 1 });

describe("platesToList", () => {
  it("drops viewer plates beyond the plate-JSON count so details and list agree", () => {
    const listed = platesToList([1, 2, 3, 4].map(plate), profile({ plates: 2 }), false);
    expect(listed.map((p) => p.index)).toEqual([1, 2]);
  });

  it("keeps every viewer plate when the profile has no count, or the count matches none", () => {
    expect(platesToList([1, 2].map(plate), null, false)).toHaveLength(2);
    expect(platesToList([3, 4].map(plate), profile({ plates: 2 }), false)).toHaveLength(2);
  });

  it("lists the stat plates when there is no geometry, else 1..N, else nothing", () => {
    const stats = [2, 1].map((index) => ({ index, estimated_seconds: 60, weight_g: 1 }));
    expect(platesToList([], profile({ plates: 5, plate_stats: stats }), true).map((p) => p.index)).toEqual([1, 2]);
    expect(platesToList([], profile({ plates: 3 }), true).map((p) => p.index)).toEqual([1, 2, 3]);
    expect(platesToList([], profile({}), true)).toEqual([]);
    expect(platesToList([], profile({ plates: 3 }), false)).toEqual([]);
  });
});
