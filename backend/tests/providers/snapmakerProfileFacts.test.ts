import { afterEach, describe, expect, it, vi } from "vitest";
import { snapmakerProfileFacts, snapmakerProfileFactsFrom } from "../../src/providers/snapmaker/profileFacts";
import { loadFixture } from "./support";

// Snapmaker Space's print profiles as a model's public details describe them, recorded from its API. No database.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Snapmaker profile facts", () => {
  it("reads each profile's time, filaments and plates, and a nozzle from its toolheads", () => {
    const facts = snapmakerProfileFactsFrom(loadFixture("snapmaker", "profile-facts-45661").data);
    expect(facts["49371"]).toEqual({
      title: "2 color",
      origin: "designer",
      creator: "Katona Gábor",
      seconds: 16584,
      grams: 69.62,
      filaments: [
        { type: "PLA", color: "#FFFFFF", grams: 24.63 },
        { type: "PLA", color: "#FF0000", grams: 45 },
      ],
      // "Plate 1" is the slicer's default name, which says no more than its number.
      plates: [
        {
          index: 1,
          seconds: 16584,
          grams: 69.62,
          filaments: [
            { type: "PLA", color: "#FFFFFF", grams: 24.63 },
            { type: "PLA", color: "#FF0000", grams: 45 },
          ],
        },
      ],
      nozzleMm: 0.4,
    });
    // "<p></p>" is no description; "<p>4 color</p>" is one.
    expect(facts["49504"].description).toBe("4 color");
  });

  it("calls a profile someone else made the community's", () => {
    const detail = loadFixture("snapmaker", "profile-facts-45661").data;
    detail.printProfiles[1].creatorId = "424242";
    detail.printProfiles[1].creatorName = "Someone Else";
    const facts = snapmakerProfileFactsFrom(detail);
    expect([facts["49371"].origin, facts["49504"].origin, facts["49504"].creator]).toEqual([
      "designer",
      "community",
      "Someone Else",
    ]);
  });

  it("reads the public details without a sign-in, and knows a model Snapmaker doesn't", async () => {
    const recorded = loadFixture("snapmaker", "profile-facts-45661");
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return url.endsWith("/model/detail/45661")
          ? Response.json(recorded)
          : Response.json({ code: 603000, msg: "not found", data: null });
      }),
    );
    expect(Object.keys((await snapmakerProfileFacts("user-1", "45661")) ?? {})).toEqual(["49371", "49504"]);
    expect(calls[0].headers).not.toHaveProperty("Authorization");
    expect(await snapmakerProfileFacts("user-1", "1")).toBeNull();
  });
});
