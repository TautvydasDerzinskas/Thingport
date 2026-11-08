import { afterEach, describe, expect, it, vi } from "vitest";
import { makeronlineProfileFacts, makeronlineProfileFactsFrom } from "../../src/providers/makeronline/profileFacts";
import { durationSeconds, hexColor } from "../../src/services/printProfileFacts";
import { loadFixture } from "./support";

// MakerOnline's print profiles as a model's details describe them, recorded from its API. No database.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the time and colour formats MakerOnline uses", () => {
  it("reads times as text, in any of the ways it writes them", () => {
    expect(durationSeconds("6h41m")).toBe(24060);
    expect(durationSeconds("1h 00m 47s")).toBe(3647);
    expect(durationSeconds("56m 33s")).toBe(3393);
    expect(durationSeconds("7.4h")).toBe(26640);
    expect(durationSeconds("1d 2h")).toBe(93600);
    expect(durationSeconds("soon")).toBeNull();
    expect(durationSeconds("3 weeks")).toBeNull();
    expect(durationSeconds("")).toBeNull();
  });

  it("reads R,G,B colours, and hex ones however they're written", () => {
    expect(hexColor("0,64,128")).toBe("#004080");
    expect(hexColor("256,0,0")).toBeNull();
    expect(hexColor("#6667abff")).toBe("#6667AB");
    expect(hexColor("fff")).toBe("#FFFFFF");
    expect(hexColor("red")).toBeNull();
  });
});

describe("MakerOnline profile facts", () => {
  it("reads text times, R,G,B colours and a plate per files row, and adds up the grams it gives no total of", () => {
    const facts = makeronlineProfileFactsFrom(loadFixture("makeronline", "profile-facts-152165").data);
    expect(facts["48891"]).toEqual({
      title: "Chute + Basket - .2mm",
      description: "Already oriented with the supports in the right places.",
      origin: "designer",
      creator: "ezafs",
      seconds: 6 * 3600 + 41 * 60,
      grams: 191.19,
      filaments: [{ type: "PLA", color: "#004080", grams: 191.19 }],
      plates: [
        {
          index: 1,
          seconds: 2 * 3600 + 33 * 60,
          grams: 78.92,
          filaments: [{ type: "PLA", color: "#004080", grams: 78.92 }],
        },
        {
          index: 2,
          seconds: 4 * 3600 + 8 * 60,
          grams: 112.27,
          filaments: [{ type: "PLA", color: "#004080", grams: 112.27 }],
        },
      ],
      nozzleMm: 0.4,
      layerMm: 0.2,
    });
    // Its printers are every one it suits, so the profile's 3MF names the printer instead.
    expect(facts["48891"]).not.toHaveProperty("printer");
  });

  it("leaves the total unknown while any filament's weight is", () => {
    const detail = loadFixture<{ data: Record<string, unknown> }>("makeronline", "profile-facts-152165").data;
    const profiles = detail.print_profiles as Record<string, unknown>[];
    const materials = [
      { paint_color: "0,64,128", material_type: "PLA", filament_used_g: 78.92 },
      { paint_color: "255,255,255", material_type: "PETG" },
    ];
    const facts = makeronlineProfileFactsFrom({
      ...detail,
      print_profiles: [{ ...profiles[0], materials_label: materials }],
    });
    expect(facts["48891"]).not.toHaveProperty("grams");
    expect(facts["48891"].filaments).toEqual([
      { type: "PLA", color: "#004080", grams: 78.92 },
      { type: "PETG", color: "#FFFFFF", grams: null },
    ]);
  });

  it("tells the designer's profile from the community's", () => {
    const facts = makeronlineProfileFactsFrom(loadFixture("makeronline", "profile-facts-152165").data);
    expect([facts["48891"].origin, facts["190636"].origin, facts["190636"].creator]).toEqual([
      "designer",
      "community",
      "szymon",
    ]);
  });

  it("reads times with seconds in them, several colours, and a nozzle given on the plates", () => {
    const profile = makeronlineProfileFactsFrom(loadFixture("makeronline", "profile-facts-20251").data)["8063"];
    expect(profile).toMatchObject({
      origin: "community",
      seconds: 11 * 3600 + 52 * 60 + 23,
      grams: 103.69,
      filaments: [
        { type: "PLA", color: "#000080", grams: 0.37 },
        { type: "PLA", color: "#FFFFFF", grams: 103.32 },
      ],
      nozzleMm: 0.4,
    });
  });

  it("reads the details without a sign-in, and knows a model MakerOnline doesn't", async () => {
    const recorded = loadFixture("makeronline", "profile-facts-152165");
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        return url.includes("id=152165")
          ? Response.json(recorded)
          : Response.json({ code: 1, message: "The model does not exist", data: null });
      }),
    );
    expect(Object.keys((await makeronlineProfileFacts("user-1", "152165")) ?? {})).toEqual(["48891", "190636"]);
    expect(calls[0].url).toBe("https://www.makeronline.com/api/mold/detail?id=152165");
    expect(calls[0].headers).not.toHaveProperty("Authorization");
    expect(await makeronlineProfileFacts("user-1", "1")).toBeNull();
  });
});
