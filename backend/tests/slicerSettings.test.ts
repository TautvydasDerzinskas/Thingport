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
    expect(await get()).toEqual({ slicer: null, slicers: [] });
  });

  it("adds a slicer picked on its own to the installed ones", async () => {
    expect((await patch({ slicer: "orcaslicer" })).body).toEqual({ slicer: "orcaslicer", slicers: ["orcaslicer"] });
  });

  it("keeps the current slicer when more are installed, in a fixed order", async () => {
    expect((await patch({ slicers: ["prusaslicer", "orcaslicer", "bambustudio"] })).body).toEqual({
      slicer: "orcaslicer",
      slicers: ["bambustudio", "orcaslicer", "prusaslicer"],
    });
  });

  it("switches the current slicer without changing the installed ones", async () => {
    expect((await patch({ slicer: "prusaslicer" })).body).toEqual({
      slicer: "prusaslicer",
      slicers: ["bambustudio", "orcaslicer", "prusaslicer"],
    });
    expect((await get()).slicer).toBe("prusaslicer");
  });

  it("moves to the first one left when the current slicer is removed", async () => {
    expect((await patch({ slicers: ["orcaslicer", "cura"] })).body).toEqual({
      slicer: "orcaslicer",
      slicers: ["orcaslicer", "cura"],
    });
  });

  it("has none once every slicer is removed", async () => {
    expect((await patch({ slicers: [] })).body).toEqual({ slicer: null, slicers: [] });
  });

  it("takes changes that arrive at once one after the other", async () => {
    const results = await Promise.all([
      patch({ slicers: ["bambustudio", "orcaslicer"] }),
      patch({ slicer: "cura" }),
      patch({ slicers: ["prusaslicer"] }),
      patch({ slicer: "orcaslicer" }),
    ]);
    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    const final = await get();
    expect(final.slicers).toContain(final.slicer);
  });

  it("rejects an unknown slicer", async () => {
    expect((await patch({ slicers: ["notepad"] })).status).toBe(400);
    expect((await patch({ slicer: "notepad" })).status).toBe(400);
  });
});
