import { beforeEach, describe, expect, it, vi } from "vitest";

// The instance as `apiCall` answers for it: by method and path, a value or an error.
const instance = vi.hoisted(() => ({
  calls: [] as { method: string; path: string; body?: unknown }[],
  answers: {} as Record<string, unknown>,
}));

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return {
    ...real,
    apiCall: async (method: string, path: string, body?: unknown) => {
      instance.calls.push({ method, path, ...(body === undefined ? {} : { body }) });
      const answer = instance.answers[`${method} ${path}`];
      if (answer instanceof Error) throw answer;
      return answer ?? null;
    },
  };
});

const store: Record<string, unknown> = {};
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async () => ({ ...store }),
      set: async (values: Record<string, unknown>) => void Object.assign(store, values),
      remove: async (keys: string | string[]) => {
        for (const key of [keys].flat()) delete store[key];
      },
    },
  },
});

const { ApiError } = await import("./api");
const { carryAdaptPicks, getAdaptView, setAdaptSettings } = await import("./adaptSettings");

const CONNECTED = { instanceUrl: "http://192.168.1.20", email: "me@example.com", connectionToken: "c" };
const MINE = {
  adaptSlicers: ["bambustudio", "prusaslicer"],
  adaptPrinters: [
    { id: "bambulab-p1s", nozzle: "0.4" },
    { id: "bambulab-h2d", nozzle: "0.6" },
  ],
};
const P1S = {
  printer: {
    id: "bambulab-p1s",
    model: "P1S",
    bed: { shape: "rectangle", x: 256, y: 256, origin: [0, 0] },
    height: 250,
  },
  brandName: "Bambu Lab",
  nozzle: "0.4",
};

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  instance.calls.length = 0;
  instance.answers = {};
});

describe("Adapt 3MFs' settings in the background", () => {
  it("are Grab's own while not connected, and the instance isn't asked", async () => {
    Object.assign(store, MINE, { adaptPlacement: "bubble" });
    expect(await getAdaptView()).toEqual({
      own: { slicers: ["bambustudio", "prusaslicer"], printers: MINE.adaptPrinters, placement: "bubble" },
      thingport: null,
      instanceUrl: "",
    });
    expect(instance.calls).toEqual([]);
  });

  it("are the instance's slicers and printers once connected", async () => {
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = {
      slicer: "orcaslicer",
      slicers: ["orcaslicer", "other", "cura"],
      unadapted: ["cura", "nope"],
      printers: { orcaslicer: "bambulab-p1s", cura: 3 },
    };
    instance.answers["GET /me/printers"] = { printers: [{ ...P1S, printer: { ...P1S.printer, extruders: 1 } }] };
    const { thingport, instanceUrl } = await getAdaptView();
    expect(instanceUrl).toBe(CONNECTED.instanceUrl);
    expect(thingport).toEqual({
      slicers: ["orcaslicer", "cura"],
      printers: [
        {
          id: "bambulab-p1s",
          brandName: "Bambu Lab",
          model: "P1S",
          nozzle: "0.4",
          bed: { shape: "rectangle", x: 256, y: 256 },
          height: 250,
          extruders: 1,
        },
      ],
      slicerPrinters: { orcaslicer: "bambulab-p1s" },
      unadapted: ["cura"],
    });
  });

  it("keep Grab's printers for an instance from before printers, and read its one slicer", async () => {
    Object.assign(store, CONNECTED);
    instance.answers["GET /settings/slicer"] = { slicer: "prusaslicer" };
    instance.answers["GET /me/printers"] = new ApiError("Not found", 404);
    const { thingport } = await getAdaptView();
    expect(thingport).toMatchObject({ slicers: ["prusaslicer"], printers: null, slicerPrinters: {}, unadapted: [] });
  });

  it("say why when the instance couldn't be asked", async () => {
    Object.assign(store, CONNECTED);
    instance.answers["GET /settings/slicer"] = new TypeError("Failed to fetch");
    expect((await getAdaptView()).thingport).toEqual({ error: "Failed to fetch" });
  });

  it("store a change cleaned, and give it back as stored", async () => {
    expect(await setAdaptSettings({ slicers: ["cura", "nope"], placement: "bubble" })).toEqual({
      slicers: ["cura"],
      printers: [],
      placement: "bubble",
    });
    expect(store).toMatchObject({ adaptSlicers: ["cura"], adaptPlacement: "bubble" });
  });
});

describe("Grab's slicers and printers on connecting", () => {
  it("go to an instance that has none of either, once", async () => {
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = { slicer: null, slicers: [] };
    instance.answers["GET /me/printers"] = { printers: [] };
    await carryAdaptPicks();
    expect(instance.calls.filter(({ method }) => method !== "GET")).toEqual([
      {
        method: "PATCH",
        path: "/settings/slicer",
        body: { slicer: "bambustudio", slicers: ["bambustudio", "prusaslicer"] },
      },
      { method: "PUT", path: "/me/printers/bambulab-p1s", body: { nozzle: "0.4" } },
      { method: "PUT", path: "/me/printers/bambulab-h2d", body: { nozzle: "0.6" } },
    ]);
    instance.calls.length = 0;
    await carryAdaptPicks();
    expect(instance.calls).toEqual([]);
  });

  it("leave what the instance has alone", async () => {
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = { slicer: "orcaslicer", slicers: ["orcaslicer"] };
    instance.answers["GET /me/printers"] = { printers: [P1S] };
    await carryAdaptPicks();
    expect(instance.calls.filter(({ method }) => method !== "GET")).toEqual([]);
    expect(store.adaptCarriedTo).toBe(`${CONNECTED.instanceUrl}|${CONNECTED.email}`);
  });

  it("send no printers to an instance from before printers, and skip one it doesn't know", async () => {
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = { slicers: ["cura"] };
    instance.answers["GET /me/printers"] = new ApiError("Not found", 404);
    await carryAdaptPicks();
    expect(instance.calls.filter(({ method }) => method !== "GET")).toEqual([]);

    for (const key of Object.keys(store)) delete store[key];
    Object.assign(store, CONNECTED, MINE);
    instance.calls.length = 0;
    instance.answers["GET /me/printers"] = { printers: [] };
    instance.answers["PUT /me/printers/bambulab-p1s"] = new ApiError("No such printer", 404);
    await carryAdaptPicks();
    expect(instance.calls.filter(({ method }) => method === "PUT").map(({ path }) => path)).toEqual([
      "/me/printers/bambulab-p1s",
      "/me/printers/bambulab-h2d",
    ]);
  });

  it("are nothing to send when Grab has none", async () => {
    Object.assign(store, CONNECTED);
    instance.answers["GET /settings/slicer"] = { slicers: [] };
    instance.answers["GET /me/printers"] = { printers: [] };
    await carryAdaptPicks();
    expect(instance.calls.filter(({ method }) => method !== "GET")).toEqual([]);
  });
});
