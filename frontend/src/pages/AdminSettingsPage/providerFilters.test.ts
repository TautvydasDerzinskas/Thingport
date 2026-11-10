import { describe, expect, it } from "vitest";
import { PROVIDER_IDS } from "../../providers/index.generated";
import { activeFilterCount, matchesFilters, NO_FILTERS, signInKind, sortProviders } from "./providerFilters";

const shown = (filters: Partial<typeof NO_FILTERS>, off: string[] = []) =>
  PROVIDER_IDS.filter((id) => matchesFilters(id, !off.includes(id), { ...NO_FILTERS, ...filters }));

describe("provider filters", () => {
  it("shows every provider with no filters", () => {
    expect(shown({})).toEqual([...PROVIDER_IDS]);
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
  });

  it("splits them by whether they're on", () => {
    expect(shown({ status: "off" }, ["pinshape", "owlcad"])).toEqual(["pinshape", "owlcad"]);
    expect(shown({ status: "on" }, ["pinshape"])).not.toContain("pinshape");
  });

  it("keeps only those with every feature asked for", () => {
    expect(shown({ features: ["profiles", "likes"] })).toEqual(["snapmaker", "makeronline", "crealitycloud"]);
    expect(shown({ features: ["paidModels"] })).toEqual([
      "myminifactory",
      "thangs",
      "cults3d",
      "toymakr3d",
      "cgtrader",
      "pixup3d",
      "fab365",
      "threedexport",
    ]);
  });

  it("takes any of the sign-ins asked for", () => {
    expect(shown({ signIns: ["none", "key"] })).toEqual(["printables", "thingiverse", "myminifactory", "owlcad"]);
    expect(signInKind("myminifactory")).toBe("key");
    expect(signInKind("eufymake")).toBe("optional");
  });

  it("reads what they need from their helpers", () => {
    expect(shown({ needs: ["grabOnly"] })).toEqual(["makeronline"]);
    expect(shown({ needs: ["flaresolverr"] })).toEqual(["printables", "thingiverse", "myminifactory", "cgtrader"]);
  });

  it("applies every kind of filter at once", () => {
    expect(shown({ status: "off", features: ["paidModels"] }, ["pinshape", "toymakr3d"])).toEqual(["toymakr3d"]);
    expect(shown({ features: ["paidModels"], signIns: ["key"] })).toEqual(["myminifactory"]);
    expect(shown({ features: ["likes"], needs: ["flaresolverr"] })).toEqual(["printables", "thingiverse", "cgtrader"]);
    expect(shown({ signIns: ["none"], needs: ["grabOnly"] })).toEqual([]);
  });

  it("counts the status as one filter", () => {
    expect(activeFilterCount({ status: "off", features: ["likes"], signIns: ["none", "user"], needs: [] })).toBe(4);
  });
});

describe("provider sort", () => {
  it("orders by when they were added, or by name", () => {
    expect(sortProviders(PROVIDER_IDS, "oldest").slice(0, 3)).toEqual(["makerworld", "printables", "thingiverse"]);
    expect(sortProviders(PROVIDER_IDS, "newest")[0]).toBe(PROVIDER_IDS.at(-1));
    // Case doesn't split eufyMake from the rest.
    expect(sortProviders(["thangs", "eufymake", "cgtrader"], "name", "en")).toEqual(["cgtrader", "eufymake", "thangs"]);
  });
});
