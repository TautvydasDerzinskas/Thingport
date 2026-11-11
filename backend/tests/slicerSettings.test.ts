import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();
const stamp = Date.now();
let token: string;

const auth = () => ({ Authorization: `Bearer ${token}` });
const get = async () => (await request(app).get("/api/settings/slicer").set(auth())).body;
const patch = (body: object) => request(app).patch("/api/settings/slicer").set(auth()).send(body);

beforeAll(async () => {
  token = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Slicers", email: `slicers-${stamp}@example.com`, password: "password123" })
  ).body.token;
});

describe("slicer settings", () => {
  it("starts with none", async () => {
    expect(await get()).toEqual({ slicer: null, slicers: [], bridged: [], unadapted: [], printers: {} });
  });

  it("adds a slicer picked on its own to the installed ones", async () => {
    expect((await patch({ slicer: "orcaslicer" })).body).toEqual({
      slicer: "orcaslicer",
      slicers: ["orcaslicer"],
      bridged: [],
      unadapted: [],
      printers: {},
    });
  });

  it("keeps the current slicer when more are installed, in a fixed order", async () => {
    expect((await patch({ slicers: ["prusaslicer", "orcaslicer", "bambustudio"] })).body).toEqual({
      slicer: "orcaslicer",
      slicers: ["bambustudio", "orcaslicer", "prusaslicer"],
      bridged: [],
      unadapted: [],
      printers: {},
    });
  });

  it("switches the current slicer without changing the installed ones", async () => {
    expect((await patch({ slicer: "prusaslicer" })).body).toEqual({
      slicer: "prusaslicer",
      slicers: ["bambustudio", "orcaslicer", "prusaslicer"],
      bridged: [],
      unadapted: [],
      printers: {},
    });
    expect((await get()).slicer).toBe("prusaslicer");
  });

  it("moves to the first one left when the current slicer is removed", async () => {
    expect((await patch({ slicers: ["orcaslicer", "cura"] })).body).toEqual({
      slicer: "orcaslicer",
      slicers: ["orcaslicer", "cura"],
      bridged: [],
      unadapted: [],
      printers: {},
    });
  });

  it("has none once every slicer is removed", async () => {
    expect((await patch({ slicers: [] })).body).toEqual({
      slicer: null,
      slicers: [],
      bridged: [],
      unadapted: [],
      printers: {},
    });
  });

  it("keeps every slicer picked by changes that arrive at once", async () => {
    const results = await Promise.all(
      ["bambustudio", "orcaslicer", "prusaslicer", "cura"].map((slicer) => patch({ slicer })),
    );
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    expect((await get()).slicers).toEqual(["bambustudio", "orcaslicer", "prusaslicer", "cura"]);
  });

  it("switches one slicer on or off without touching the others", async () => {
    await patch({ slicers: ["orcaslicer"] });
    // As two devices that loaded the same list would send them.
    await Promise.all([patch({ enable: "cura" }), patch({ enable: "prusaslicer" })]);
    expect((await get()).slicers).toEqual(["orcaslicer", "prusaslicer", "cura"]);
    expect((await patch({ disable: "orcaslicer" })).body).toEqual({
      slicer: "prusaslicer",
      slicers: ["prusaslicer", "cura"],
      bridged: [],
      unadapted: [],
      printers: {},
    });
  });

  it("sends a slicer with its own protocol through the Bridge, and back", async () => {
    await patch({ slicers: ["orcaslicer", "crealityprintlink"] });
    // As two devices would send them.
    await Promise.all([patch({ bridge: "crealityprintlink" }), patch({ bridge: "eufystudio3d" })]);
    expect((await get()).bridged).toEqual(["crealityprintlink", "eufystudio3d"]);
    expect((await patch({ unbridge: "eufystudio3d" })).body.bridged).toEqual(["crealityprintlink"]);
  });

  it("keeps a slicer's way of opening while it's switched off", async () => {
    await patch({ disable: "crealityprintlink" });
    expect(await get()).toMatchObject({ slicers: ["orcaslicer"], bridged: ["crealityprintlink"] });
    await patch({ enable: "crealityprintlink" });
    expect((await get()).bridged).toEqual(["crealityprintlink"]);
  });

  it("has no choice to make for the slicers that always go through the Bridge", async () => {
    expect((await patch({ bridge: "bambustudio" })).status).toBe(400);
    expect((await patch({ unbridge: "other" })).status).toBe(400);
    expect((await patch({ bridge: "notepad" })).status).toBe(400);
  });

  it("rejects an unknown slicer", async () => {
    expect((await patch({ slicers: ["notepad"] })).status).toBe(400);
    expect((await patch({ slicer: "notepad" })).status).toBe(400);
    expect((await patch({ enable: "notepad" })).status).toBe(400);
    expect((await patch({ unadapt: "notepad" })).status).toBe(400);
  });

  it("switches a slicer's adapted copies off and on, as two devices would", async () => {
    await Promise.all([patch({ unadapt: "cura" }), patch({ unadapt: "orcaslicer" })]);
    expect((await get()).unadapted).toEqual(["orcaslicer", "cura"]);
    expect((await patch({ adapt: "cura" })).body.unadapted).toEqual(["orcaslicer"]);
  });

  it("makes a slicer's copies for one of the user's printers, or asks again", async () => {
    expect((await patch({ printer: { slicer: "orcaslicer", printer: "bambulab-p1s" } })).status).toBe(422);
    expect((await request(app).put("/api/me/printers/bambulab-p1s").set(auth()).send({})).status).toBe(200);
    expect((await patch({ printer: { slicer: "orcaslicer", printer: "bambulab-p1s" } })).body.printers).toEqual({
      orcaslicer: "bambulab-p1s",
    });
    expect((await patch({ printer: { slicer: "orcaslicer", printer: null } })).body.printers).toEqual({});
    expect((await patch({ printer: { slicer: "notepad", printer: null } })).status).toBe(400);
  });
});
