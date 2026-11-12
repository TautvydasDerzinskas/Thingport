import { beforeEach, describe, expect, it, vi } from "vitest";

// The instance as `apiCall` answers for it: by method and path, a value, an error or a function giving either. `asked`
// is the account each call was bound to, if any.
const instance = vi.hoisted(() => ({
  calls: [] as { method: string; path: string; body?: unknown }[],
  asked: [] as (string | null)[],
  answers: {} as Record<string, unknown>,
}));

vi.mock("./api", async (importOriginal) => {
  const real = await importOriginal<typeof import("./api")>();
  return {
    ...real,
    apiCall: async (method: string, path: string, body?: unknown, account?: { email: string }) => {
      instance.calls.push({ method, path, ...(body === undefined ? {} : { body }) });
      instance.asked.push(account?.email ?? null);
      let answer = instance.answers[`${method} ${path}`];
      if (typeof answer === "function") answer = await (answer as () => unknown)();
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
  instance.asked.length = 0;
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
    expect(store.adaptCarriedTo).toEqual({ [`${CONNECTED.instanceUrl}|${CONNECTED.email}`]: ["slicers", "printers"] });
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

  it("go once to each account, however often Grab switches between them", async () => {
    const OTHER = { ...CONNECTED, email: "other@example.com" };
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = { slicers: [] };
    instance.answers["GET /me/printers"] = { printers: [] };
    await carryAdaptPicks();
    Object.assign(store, OTHER);
    await carryAdaptPicks();
    expect(Object.keys(store.adaptCarriedTo as object)).toEqual([
      `${CONNECTED.instanceUrl}|${CONNECTED.email}`,
      `${OTHER.instanceUrl}|${OTHER.email}`,
    ]);
    // Back to the first, which has had the user remove what came: nothing goes again.
    Object.assign(store, CONNECTED);
    instance.calls.length = 0;
    await carryAdaptPicks();
    expect(instance.calls).toEqual([]);
  });

  it("try again only what didn't go, the next time", async () => {
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = { slicers: [] };
    instance.answers["GET /me/printers"] = { printers: [] };
    instance.answers["PUT /me/printers/bambulab-h2d"] = new TypeError("Failed to fetch");
    await carryAdaptPicks();
    expect(store.adaptCarriedTo).toEqual({ [`${CONNECTED.instanceUrl}|${CONNECTED.email}`]: ["slicers"] });

    // The slicers that went aren't sent again, though the user has since removed them there.
    instance.calls.length = 0;
    delete instance.answers["PUT /me/printers/bambulab-h2d"];
    await carryAdaptPicks();
    expect(instance.calls.filter(({ method }) => method !== "GET").map(({ path }) => path)).toEqual([
      "/me/printers/bambulab-p1s",
      "/me/printers/bambulab-h2d",
    ]);
    expect(store.adaptCarriedTo).toEqual({ [`${CONNECTED.instanceUrl}|${CONNECTED.email}`]: ["slicers", "printers"] });
  });

  it("leave a failed instance to be tried again", async () => {
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = new ApiError("Bad gateway", 502);
    await carryAdaptPicks();
    expect(store.adaptCarriedTo).toBeUndefined();
    instance.answers["GET /settings/slicer"] = { slicers: [] };
    instance.answers["GET /me/printers"] = { printers: [] };
    await carryAdaptPicks();
    expect(instance.calls.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  });

  it("go to the account they started for, should Grab connect to another meanwhile, which gets its own after", async () => {
    const OTHER = { ...CONNECTED, email: "other@example.com" };
    Object.assign(store, CONNECTED, MINE);
    instance.answers["GET /settings/slicer"] = () => {
      // Connecting to another account while the first one's carry is under way.
      if (store.email === CONNECTED.email) {
        Object.assign(store, OTHER);
        void carryAdaptPicks();
      }
      return { slicers: [] };
    };
    instance.answers["GET /me/printers"] = { printers: [] };
    await carryAdaptPicks();
    // The other account's, queued meanwhile; asking again waits for it, and sends nothing more.
    await carryAdaptPicks();
    const writes = instance.calls.flatMap((call, at) => (call.method === "GET" ? [] : [instance.asked[at]]));
    expect(writes).toEqual([...Array<string>(3).fill(CONNECTED.email), ...Array<string>(3).fill(OTHER.email)]);
    expect(Object.keys(store.adaptCarriedTo as object)).toHaveLength(2);
  });
});
