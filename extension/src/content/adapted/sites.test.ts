import { describe, expect, it } from "vitest";
import { MANIFESTS, PROVIDER_IDS } from "../../providers/index.generated";
import { ADAPT_SITES } from "./sites";

describe("the sites Download adapted works on", () => {
  it("are the providers whose manifests list kinds of 3MF to adapt, each under its own id", () => {
    const listed = PROVIDER_IDS.filter(
      (id) => (MANIFESTS[id].capabilities as { adapted3mfs?: readonly string[] }).adapted3mfs?.length,
    );
    expect(Object.keys(ADAPT_SITES).toSorted()).toEqual(listed.toSorted());
    for (const [id, site] of Object.entries(ADAPT_SITES)) expect(site?.id).toBe(id);
  });
});
