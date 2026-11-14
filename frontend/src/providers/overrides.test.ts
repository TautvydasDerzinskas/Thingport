import { describe, expect, it } from "vitest";
import type { ProviderState } from "../api/providers";
import { sitesOnInstance } from "./overrides";

// Which of a provider's sites the panel offers, connects and forgets: those the instance keeps a sign-in for.
const SITES = [{ slot: "default" }, { slot: "cn" }];
const off = { status: "disconnected", account: null } as const;

function state(slots: ProviderState["slots"]): ProviderState {
  return { id: "voxelshare", enabled: true, slots };
}

describe("a provider's sites on the instance", () => {
  it("is every site an instance lists, connected or not", () => {
    expect(sitesOnInstance(SITES, state({ default: off, cn: off }))).toEqual(SITES);
  });

  it("leaves out a site an instance from before it was added doesn't list, which it would turn away", () => {
    expect(sitesOnInstance(SITES, state({ default: off }))).toEqual([{ slot: "default" }]);
  });

  it("keeps the main site while the instance hasn't said", () => {
    expect(sitesOnInstance(SITES, undefined)).toEqual([{ slot: "default" }]);
  });
});
