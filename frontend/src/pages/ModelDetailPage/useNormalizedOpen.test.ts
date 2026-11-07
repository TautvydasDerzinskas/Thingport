import { describe, expect, it } from "vitest";
import type { Plate } from "../../api/prints";
import { normalizeStateKey } from "./useNormalizedOpen";
import { type SlicerTarget, normalizedKey } from "./useOpenInSlicer";

const plate = (id: string) => ({ id }) as Plate;

function target(normalizeTarget: "flat" | "orca" | undefined, plateId = "p1"): SlicerTarget {
  return {
    key: normalizedKey(normalizeTarget, plateId),
    url: "/u",
    filename: "a.3mf",
    launchFilename: "a.3mf",
    index: 0,
    plate: plate(plateId),
    normalizeTarget,
    href: "x",
  };
}

describe("normalize state key", () => {
  it("keeps flat and orca of the same plate apart, so each gets its own prepare", () => {
    expect(normalizeStateKey(target("flat"))).not.toBe(normalizeStateKey(target("orca")));
  });

  it("keeps plates apart", () => {
    expect(normalizeStateKey(target("orca", "p1"))).not.toBe(normalizeStateKey(target("orca", "p2")));
  });

  it("is stable for the same target, and an unset kind counts as flat", () => {
    expect(normalizeStateKey(target("orca"))).toBe(normalizeStateKey(target("orca")));
    expect(normalizeStateKey(target(undefined))).toBe(normalizeStateKey(target("flat")));
  });
});
