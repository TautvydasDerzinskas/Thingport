import { afterEach, describe, expect, it, vi } from "vitest";
import {
  crealitycloudProfileFacts,
  crealitycloudProfileFactsFrom,
} from "../../src/providers/crealitycloud/profileFacts";
import { loadFixture } from "./support";

// Creality Cloud's print profiles, from a model's 3MF list and each profile's own details, recorded from its public API.
// No database.

type Recorded = {
  groupItem: Record<string, unknown>;
  profiles: Record<string, unknown>[];
  details: Record<string, Record<string, unknown> | null>;
};

const recorded = (name: string) => loadFixture<Recorded>("crealitycloud", `profile-facts-${name}`);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Creality Cloud profile facts", () => {
  it("reads a designer's profile with its plates from the profile's own details", () => {
    const { groupItem, profiles, details } = recorded("rainbow-piggybank");
    const profile = crealitycloudProfileFactsFrom(groupItem, profiles, details)["68fb65202f05b9e97908ca5d"];
    expect(profile).toMatchObject({
      title: "0.2mm layer, 2 walls, 15% infill",
      origin: "designer",
      creator: "Valeria Momo Mattia",
      seconds: 23371,
      grams: 247.75,
      printer: "Creality K1C",
      nozzleMm: 0.4,
      layerMm: 0.2,
      infill: "15%",
      walls: 2,
    });
    // Its colours come in lower case.
    expect(profile.filaments?.slice(0, 2)).toEqual([
      { type: "PLA", color: "#FFFFFF", grams: 78.21 },
      { type: "PLA", color: "#AE96D4", grams: 22.66 },
    ]);
    expect(profile.plates).toHaveLength(8);
    // "plate_2" is a slicer's default name.
    expect(profile.plates?.slice(0, 2)).toEqual([
      {
        index: 1,
        name: "Clud base",
        seconds: 5654,
        grams: 78.21,
        filaments: [{ type: "PLA", color: "#FFFFFF", grams: 78.21 }],
      },
      { index: 2, seconds: 2222, grams: 22.66, filaments: [{ type: "PLA", color: "#AE96D4", grams: 22.66 }] },
    ]);
  });

  it("calls other people's profiles the community's, and keeps a description as text", () => {
    const { groupItem, profiles, details } = recorded("rainbow-piggybank");
    const facts = crealitycloudProfileFactsFrom(groupItem, profiles, details);
    expect(facts["691b2da8ad9806c8e465548a"]).toMatchObject({ origin: "community", creator: "user9014663478" });
    // Its nozzle isn't given at all.
    expect(facts["691b2da8ad9806c8e465548a"]).not.toHaveProperty("nozzleMm");
    expect(facts["6a453f2e9fd80f401c15d0e2"].description).toBe(
      "Ready to print!\nIf you want to improve the quality even more, lower the print speed of the outer, inner, and " +
        "top walls to 30 or less.",
    );
  });

  it("leaves out the zeros of a profile the site failed to slice, and tells whose it is by the model's owner", () => {
    const { groupItem, profiles, details } = recorded("leonardo");
    expect(crealitycloudProfileFactsFrom(groupItem, profiles, details)).toEqual({
      "6aa7a8755c667a7fc8ae580b": {
        title: "0.2mm layer, 2 walls, 15% infill",
        origin: "community",
        creator: "Terryfolds",
        plates: [{ index: 1 }],
        printer: "Creality K2 Pro",
        nozzleMm: 0.4,
        layerMm: 0.2,
        infill: "15%",
        walls: 2,
      },
    });
  });

  it("drops the alpha some of its colours carry", () => {
    const { groupItem, profiles } = recorded("crystal-dragon");
    const facts = crealitycloudProfileFactsFrom(groupItem, profiles);
    expect(facts["6aee2640ae8da4658880aa03"]).toMatchObject({
      origin: "designer",
      printer: "Creality Ender-3 V3 KE",
      filaments: [
        { type: "PLA", color: "#FFFFFF", grams: 164.09 },
        { type: "PLA", color: "#6667AB", grams: 53.55 },
      ],
    });
  });

  it("reads one profile's details per wanted profile, publicly, and knows a model the site doesn't", async () => {
    const { groupItem, profiles, details } = recorded("rainbow-piggybank");
    const calls: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
    const answer = (code: number, result: unknown) => Response.json({ code, msg: "ok", result });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname.replace(/^\/api\/cxy/, "");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push({ path, body, headers: init.headers as Record<string, string> });
        if (path === "/v3/model/modelGroupDetail") {
          return body.id === "rainbow-piggybank" ? answer(0, { groupItem }) : answer(517, null);
        }
        if (path === "/v3/model/3mfList") return answer(0, { list: profiles, count: profiles.length });
        if (path === "/v3/model/3mfDetail") return answer(0, details[String(body.id)] ?? null);
        throw new Error(`unexpected call ${path}`);
      }),
    );
    const facts = await crealitycloudProfileFacts("user-1", "rainbow-piggybank", ["68fb65202f05b9e97908ca5d"]);
    expect(Object.keys(facts ?? {})).toHaveLength(3);
    expect(facts?.["68fb65202f05b9e97908ca5d"].plates).toHaveLength(8);
    // Only the wanted profile's plates were asked for; the others keep what their list row says.
    expect(facts?.["6a453f2e9fd80f401c15d0e2"]).not.toHaveProperty("plates");
    const detailCalls = calls.filter((call) => call.path === "/v3/model/3mfDetail");
    expect(detailCalls.map((call) => call.body)).toEqual([
      { modelGroupId: groupItem.id, id: "68fb65202f05b9e97908ca5d" },
    ]);
    expect(calls.every((call) => !("__cxy_token_" in call.headers))).toBe(true);
    expect(await crealitycloudProfileFacts("user-1", "gone", [])).toBeNull();
  });

  it("keeps the plates that came when another profile's fail", async () => {
    const { groupItem, profiles, details } = recorded("rainbow-piggybank");
    const answer = (code: number, result: unknown) => Response.json({ code, msg: "ok", result });
    const failing = "6a453f2e9fd80f401c15d0e2";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname.replace(/^\/api\/cxy/, "");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (path === "/v3/model/modelGroupDetail") return answer(0, { groupItem });
        if (path === "/v3/model/3mfList") return answer(0, { list: profiles, count: profiles.length });
        if (path === "/v3/model/3mfDetail" && body.id === failing) throw new TypeError("fetch failed");
        if (path === "/v3/model/3mfDetail") return answer(0, details[String(body.id)] ?? null);
        throw new Error(`unexpected call ${path}`);
      }),
    );
    const facts = await crealitycloudProfileFacts("user-1", "rainbow-piggybank", ["68fb65202f05b9e97908ca5d", failing]);
    expect(facts?.["68fb65202f05b9e97908ca5d"].plates).toHaveLength(8);
    expect(facts?.["68fb65202f05b9e97908ca5d"]).not.toHaveProperty("partial");
    expect(facts?.[failing]).toMatchObject({ partial: true });
    expect(facts?.[failing]).not.toHaveProperty("plates");
  });

  it("keeps every profile's facts when one profile's plates fail to come, and asks for those again", async () => {
    const { groupItem, profiles } = recorded("rainbow-piggybank");
    const answer = (code: number, result: unknown) => Response.json({ code, msg: "ok", result });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const path = new URL(url).pathname.replace(/^\/api\/cxy/, "");
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (path === "/v3/model/modelGroupDetail") return answer(0, { groupItem });
        if (path === "/v3/model/3mfList") return answer(0, { list: profiles, count: profiles.length });
        // The first profile's details fail outright, the second's come back empty.
        if (path === "/v3/model/3mfDetail" && body.id === "68fb65202f05b9e97908ca5d")
          throw new TypeError("fetch failed");
        if (path === "/v3/model/3mfDetail") return answer(1, null);
        throw new Error(`unexpected call ${path}`);
      }),
    );
    const wanted = ["68fb65202f05b9e97908ca5d", "6a453f2e9fd80f401c15d0e2"];
    const facts = await crealitycloudProfileFacts("user-1", "rainbow-piggybank", wanted);
    for (const id of wanted) {
      expect(facts?.[id]).toMatchObject({ partial: true });
      expect(facts?.[id]).not.toHaveProperty("plates");
    }
    // The list's own facts stay.
    expect(facts?.["68fb65202f05b9e97908ca5d"]).toMatchObject({ seconds: 23371, printer: "Creality K1C" });
    // A profile whose plates weren't asked for isn't partial: there was nothing to fail.
    const unasked = Object.keys(facts ?? {}).find((id) => !wanted.includes(id))!;
    expect(facts?.[unasked]).not.toHaveProperty("partial");
  });
});
