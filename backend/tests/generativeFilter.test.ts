import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";

// A model is "generative" when it came with the script it was generated from. The script is kept beside the
// model, never as one of its plates, so that is what the filter and the listing both go by.

const app = createApp();
const stamp = Date.now();
let token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

const STL =
  "solid part\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid part\n";

async function makeModel(title: string): Promise<string> {
  const res = await request(app)
    .post("/api/upload")
    .set(auth())
    .field("title", title)
    .attach("files", Buffer.from(STL), { filename: "part.stl", contentType: "model/stl" });
  expect(res.status).toBe(200);
  return res.body.prints[0].id;
}

async function attachFile(printId: string, filename: string, body: string): Promise<void> {
  const res = await request(app)
    .post(`/api/print/${printId}/files`)
    .set(auth())
    .attach("file", Buffer.from(body), { filename, contentType: "text/plain" });
  expect(res.status).toBe(200);
}

let plain: string;
let generated: string;
let withNotes: string;

describe("models that came with a generator script", () => {
  beforeAll(async () => {
    const res = await request(app)
      .post("/api/register")
      .send({
        displayName: "Generative Filter Test",
        email: `generative-${stamp}@example.com`,
        password: "password123",
      });
    token = res.body.token;

    plain = await makeModel(`Plain ${stamp}`);
    generated = await makeModel(`Generated ${stamp}`);
    withNotes = await makeModel(`Notes ${stamp}`);
    await attachFile(generated, "keychain_customizable.scad", "base_width = 80;\n");
    await attachFile(withNotes, "readme.txt", "printed at 0.2mm\n");
  }, 120000);

  it("names the script on the model, so a list can mark it without asking for each one's files", async () => {
    const res = await request(app).get(`/api/print/${generated}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.generator_scripts).toEqual([{ id: expect.any(String), filename: "keychain_customizable.scad" }]);
  });

  it("leaves a model with no script, and one with an unrelated file, without any", async () => {
    const plainOut = await request(app).get(`/api/print/${plain}`).set(auth());
    const notesOut = await request(app).get(`/api/print/${withNotes}`).set(auth());

    expect(plainOut.body.generator_scripts).toEqual([]);
    expect(notesOut.body.supporting_file_count).toBe(1);
    expect(notesOut.body.generator_scripts).toEqual([]);
  });

  it("narrows the listing to them, and lists everything without the filter", async () => {
    const all = await request(app).get("/api/prints?limit=100").set(auth());
    const only = await request(app).get("/api/prints?limit=100&generative=1").set(auth());

    // The listing is the array itself; its paging is in X- headers.
    const ids = (body: { id: string }[]) => body.map((item) => item.id);
    expect(ids(all.body)).toEqual(expect.arrayContaining([plain, generated, withNotes]));
    expect(ids(only.body)).toEqual([generated]);
  });

  it("goes by the file beside the model, not by its plates", async () => {
    // A model whose *plate* happens to be named like a script is still an ordinary model: a plate is geometry.
    const odd = await makeModel(`Odd ${stamp}`);
    const res = await request(app).get(`/api/print/${odd}`).set(auth());
    expect(res.body.generator_scripts).toEqual([]);

    const only = await request(app).get("/api/prints?limit=100&generative=1").set(auth());
    expect(only.body.map((item: { id: string }) => item.id)).toEqual([generated]);
  });
});
