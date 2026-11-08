import { afterEach, describe, expect, it, vi } from "vitest";
import { makerworldProfileFacts, makerworldProfileFactsFrom } from "../../src/providers/makerworld/profileFacts";
import { loadFixture } from "./support";

// MakerWorld's print profiles as its public design data describes them, recorded from the cloud API. No database.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MakerWorld profile facts", () => {
  it("reads a multi-plate, multi-colour designer profile in seconds, grams and the printer's full name", () => {
    const facts = makerworldProfileFactsFrom(loadFixture("makerworld", "profile-facts-3541343"));
    const profile = facts["4050294"];
    expect(profile).toMatchObject({
      origin: "designer",
      creator: "BamBam Design",
      seconds: 91880,
      grams: 295,
      printer: "Bambu Lab A1 mini",
      nozzleMm: 0.4,
      layerMm: 0.12,
      infill: "15%",
      walls: 2,
    });
    expect(profile.filaments).toHaveLength(8);
    expect(profile.filaments?.[0]).toEqual({ type: "PLA", color: "#FFFFFF", grams: 149 });
    expect(profile.plates?.map((plate) => [plate.index, plate.name, plate.seconds, plate.grams])).toEqual([
      [1, "Terrain Wheel Pins & Roofs", 32265, 100],
      [2, "Base & Train", 24380, 88],
      [3, "Houses", 12496, 37],
      [4, "Trees", 22739, 70],
    ]);
    expect(profile.plates?.[2].filaments).toEqual([
      { type: "PLA", color: "#D3B7A7", grams: 22 },
      { type: "PLA", color: "#FFFF00", grams: 8 },
      { type: "PLA", color: "#6F5034", grams: 7 },
    ]);
    // An empty summary says nothing.
    expect(profile).not.toHaveProperty("description");
    expect(facts["4050273"].description).toBe("All in one Plate! Much color changes! Tool Changer recommend");
  });

  it("tells the designer's profile from the community's, by who made each", () => {
    const facts = makerworldProfileFactsFrom(loadFixture("makerworld", "profile-facts-3532319"));
    expect(Object.entries(facts).map(([id, profile]) => [id, profile.origin, profile.creator])).toEqual([
      ["4038925", "designer", "Hesic"],
      ["4061809", "community", "zelenaomeba"],
      ["4073923", "community", "dnstuff"],
      ["4074554", "community", "AKOR"],
    ]);
    expect(facts["4074554"].printer).toBe("Bambu Lab P1S");
    // A plate without a name of its own keeps only its number.
    expect(facts["4038925"].plates).toEqual([
      { index: 1, seconds: 2415, grams: 10, filaments: [{ type: "PLA", color: "#F7F3F0", grams: 10 }] },
    ]);
  });

  it("leaves out what the design doesn't say, and can't tell whose a profile is without its designer", () => {
    const facts = makerworldProfileFactsFrom({
      id: 1,
      instances: [{ id: 7, title: "Draft", prediction: 0, weight: "0", instanceCreator: { uid: 5 }, extention: {} }],
    });
    expect(facts).toEqual({ "7": { title: "Draft" } });
  });

  it("reads the public design without a sign-in, and knows a design MakerWorld doesn't", async () => {
    const design = loadFixture("makerworld", "profile-facts-3532319");
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return url.endsWith("/design/3532319")
          ? Response.json(design)
          : Response.json({ code: 1, error: "not found" }, { status: 404 });
      }),
    );
    const facts = await makerworldProfileFacts("user-1", "3532319");
    expect(Object.keys(facts ?? {})).toEqual(["4038925", "4061809", "4073923", "4074554"]);
    expect(calls[0].url).toBe("https://api.bambulab.com/v1/design-service/design/3532319");
    expect(calls[0].headers).not.toHaveProperty("Authorization");
    expect(await makerworldProfileFacts("user-1", "999")).toBeNull();
  });

  it("throws when MakerWorld won't answer, so the profiles are read again later", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("busy", { status: 503 })),
    );
    await expect(makerworldProfileFacts("user-1", "3532319")).rejects.toThrow(/HTTP 503/);
  });
});
