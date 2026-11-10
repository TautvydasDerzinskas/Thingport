import { afterEach, describe, expect, it, vi } from "vitest";
import { nexprintProfileFacts, nexprintProfileFactsFrom } from "../../src/providers/nexprint/profileFacts";
import { loadFixture } from "./support";

// NexPrint's print profiles ("settings") as a model's public details describe them, recorded from its API. No database.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NexPrint profile facts", () => {
  it("reads minutes as seconds, numbers plates from 1, and weighs each filament from its plates", () => {
    const facts = nexprintProfileFactsFrom(loadFixture("nexprint", "profile-facts-G4555401").data);
    const profile = facts.G4697158;
    expect(profile).toMatchObject({
      title: "0.2mm layer, 2 walls, 15% infill",
      origin: "designer",
      creator: "Ams Design",
      seconds: 440 * 60,
      grams: 235.31,
      nozzleMm: 0.4,
      layerMm: 0.2,
      infill: "15%",
      walls: 2,
      supports: false,
    });
    // In the profile's own filament order, each with what its plates use of it.
    expect(profile.filaments).toEqual([
      { type: "PLA", color: "#FEC600", grams: 45.43 },
      { type: "PLA", color: "#00B1B7", grams: 160.26 },
      { type: "PLA", color: "#EC008C", grams: 22.47 },
      { type: "PLA", color: "#0000FF", grams: 7.15 },
    ]);
    expect(profile.plates?.map((plate) => [plate.index, plate.name, plate.seconds, plate.grams])).toEqual([
      [1, undefined, 276 * 60, 160.26],
      [2, undefined, 57 * 60, 22.47],
      [3, undefined, 92 * 60, 45.43],
      [4, undefined, 16 * 60, 7.15],
    ]);
    expect(profile.description).toMatch(/^🍬 Sweet Twist – Functional Candy Dispenser\n\nParts are arranged/);
    // The site names no printer for it.
    expect(profile).not.toHaveProperty("printer");
  });

  it("keeps a profile under the id its plate is tagged with, and calls someone else's the community's", () => {
    const detail = loadFixture("nexprint", "profile-facts-G4545937").data;
    expect(nexprintProfileFactsFrom(detail)).toEqual({
      G4684460: expect.objectContaining({
        seconds: 61 * 60,
        filaments: [{ type: "PLA", color: "#36A8E1", grams: 28.84 }],
        plates: [
          { index: 1, seconds: 61 * 60, grams: 28.84, filaments: [{ type: "PLA", color: "#36A8E1", grams: 28.84 }] },
        ],
      }),
    });
    detail.settingInfoList[0].isCreator = false;
    detail.settingInfoList[0].userId = "1";
    expect(nexprintProfileFactsFrom(detail).G4684460.origin).toBe("community");
  });

  it("reads the public details without a sign-in, and knows a model NexPrint doesn't", async () => {
    const recorded = loadFixture("nexprint", "profile-facts-G4555401");
    const calls: { url: URL; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const parsed = new URL(url);
        calls.push({ url: parsed, headers: init.headers as Record<string, string> });
        // A model that isn't there comes back with every field null.
        return parsed.searchParams.get("id") === "G4555401"
          ? Response.json(recorded)
          : Response.json({ code: 0, msg: "ok", data: { id: null, modelId: null, settingInfoList: null } });
      }),
    );
    expect(Object.keys((await nexprintProfileFacts("user-1", "G4555401")) ?? {})).toEqual(["G4697158"]);
    expect(calls[0].url.pathname).toBe("/gateway/api/v1/model-library-server/model-base-info/get");
    expect(calls[0].url.searchParams.get("loadSupportPrintProfile")).toBe("true");
    expect(calls[0].headers).not.toHaveProperty("Authorization");
    expect(await nexprintProfileFacts("user-1", "G1")).toBeNull();
  });
});
