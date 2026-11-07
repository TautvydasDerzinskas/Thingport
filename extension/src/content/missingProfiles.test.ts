import { describe, expect, it, vi } from "vitest";
import type { ImportStatus } from "../shared/api";
import { hasMissingProfiles } from "./missingProfiles";

const held = (already_imported: boolean): ImportStatus => ({ already_imported });

describe("hasMissingProfiles", () => {
  it("is true when one of the page's profiles isn't on the model, as after a partial import", async () => {
    const statuses: Record<string, ImportStatus> = { "1": held(true), "2": held(false), "3": held(true) };
    expect(await hasMissingProfiles(["1", "2", "3"], async (id) => statuses[id])).toBe(true);
  });

  it("is false when every profile is on the model", async () => {
    expect(await hasMissingProfiles(["1", "2"], async () => held(true))).toBe(false);
  });

  it("counts a profile it can't ask about as held", async () => {
    expect(await hasMissingProfiles(["1", "2"], () => Promise.reject(new Error("offline")))).toBe(false);
  });

  it("asks nothing for a page with a single profile", async () => {
    const statusOf = vi.fn(async () => held(false));
    expect(await hasMissingProfiles(["1"], statusOf)).toBe(false);
    expect(statusOf).not.toHaveBeenCalled();
  });
});
