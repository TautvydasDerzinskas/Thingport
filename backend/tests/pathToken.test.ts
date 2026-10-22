import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

const app = createApp();
const STL =
  "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
const stamp = Date.now();
let session: string;

beforeAll(async () => {
  session = (
    await request(app)
      .post("/api/register")
      .send({ displayName: "Path token", email: `path-token-${stamp}@example.com`, password: "password123" })
  ).body.token;
});

// Slicer links carry the session in the path, so OrcaSlicer's filename (the last segment) stays clean.
describe("token in the path", () => {
  it("signs a GET in like ?token=", async () => {
    const res = await request(app).get(`/api/t/${session}/settings/slicer`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("slicer");
  });

  it("serves a plate's file, whose name stays the last segment", async () => {
    const upload = await request(app)
      .post("/api/upload")
      .set({ Authorization: `Bearer ${session}` })
      .attach("files", Buffer.from(STL), "keyboardHolder_logo.stl");
    const print = (
      await request(app)
        .get(`/api/print/${upload.body.prints[0].id}`)
        .set({ Authorization: `Bearer ${session}` })
    ).body;
    const url: string = print.plates[0].url;
    expect(url.endsWith("/keyboardHolder_logo.stl")).toBe(true);
    const res = await request(app).get(`/api/t/${session}${url}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe(STL);
  });

  it("keeps the query string after the token", async () => {
    const res = await request(app).get(`/api/t/${session}/prints?limit=1`);
    expect(res.status).toBe(200);
  });

  it("rejects a bad token", async () => {
    expect((await request(app).get("/api/t/not-a-token/settings/slicer")).status).toBe(401);
  });

  it("only reads", async () => {
    const res = await request(app).patch(`/api/t/${session}/settings/slicer`).send({ slicer: "cura" });
    expect(res.status).toBe(401);
    expect((await request(app).get(`/api/t/${session}/settings/slicer`)).body.slicer).not.toBe("cura");
  });

  it("never takes an API token, which is header-only", async () => {
    const apiToken = (
      await request(app)
        .post("/api/profile/api-token")
        .set({ Authorization: `Bearer ${session}` })
    ).body.token;
    expect((await request(app).get(`/api/t/${apiToken}/settings/slicer`)).status).toBe(401);
  });

  it("checks an API token's scope against the path it reaches", async () => {
    const upload = await request(app)
      .post("/api/upload")
      .set({ Authorization: `Bearer ${session}` })
      .attach("files", Buffer.from(STL), "scoped.stl");
    const print = (
      await request(app)
        .get(`/api/print/${upload.body.prints[0].id}`)
        .set({ Authorization: `Bearer ${session}` })
    ).body;
    const apiToken = (
      await request(app)
        .post("/api/profile/api-token")
        .set({ Authorization: `Bearer ${session}` })
        .send({ rest_scopes: ["other"] })
    ).body.token;
    const res = await request(app)
      .get(`/api/t/x${print.plates[0].url}`)
      .set({ Authorization: `Bearer ${apiToken}` });
    expect(res.status).toBe(403);
    expect(res.body.scope).toBe("files");
  });
});
