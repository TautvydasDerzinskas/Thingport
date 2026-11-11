import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import JSZip from "jszip";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPATIBLE_TAG } from "../src/adapter";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
let token: string;
let printId: string;
let plateId: string;
let fileUrl: string;

function auth(req: request.Test) {
  return req.set("Authorization", `Bearer ${token}`);
}

async function bambuProject(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "3D/3dmodel.model",
    `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.07.01.57</metadata>
 <resources>
  <object id="2" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1"/></components></object>
 </resources>
 <build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 10 10 0" printable="1"/></build>
</model>`,
  );
  zip.file(
    "3D/Objects/object_1.model",
    `<?xml version="1.0"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" type="model"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices>
   <triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="2" v3="3"/><triangle v1="1" v2="2" v3="3"/></triangles>
  </mesh></object>
 </resources>
 <build/>
</model>`,
  );
  zip.file(
    "Metadata/project_settings.config",
    JSON.stringify({ wall_loops: "3", filament_colour: ["#FF0000"], printer_settings_id: "Bambu Lab A1 0.4 nozzle" }),
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function fetchApplication(url: string): Promise<string> {
  const res = await auth(request(app).get(`/api${url}`))
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  const xml = await (await JSZip.loadAsync(res.body as Buffer)).file("3D/3dmodel.model")!.async("string");
  return /<metadata name="Application">([^<]*)</.exec(xml)?.[1] ?? "";
}

const adaptedUrl = (slicer: string) =>
  fileUrl.replace(/\/file\/([^/]+)$/, (_all, name: string) => `/adapted/${slicer}/${name}`);
const adaptStatusUrl = () => `/api${fileUrl.replace(/\/file\/[^/]+$/, "/adapt")}`;

async function uploadStl(): Promise<{ id: string; plates: { url: string }[] }> {
  const file = path.join(os.tmpdir(), `adapt-${Date.now()}.stl`);
  fs.writeFileSync(file, "solid x endsolid");
  const upload = await auth(request(app).post("/api/upload")).attach("files", file);
  fs.rmSync(file, { force: true });
  return upload.body.prints[0];
}

beforeAll(async () => {
  const email = `adapt-test-${Date.now()}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "Adapt Test", email, password: "password123" });
  if (registered.status !== 200) throw new Error(`register failed: ${registered.status}`);
  token = registered.body.token;

  const file = path.join(os.tmpdir(), `adapt-${Date.now()}.3mf`);
  fs.writeFileSync(file, await bambuProject());
  const upload = await auth(request(app).post("/api/upload")).attach("files", file);
  fs.rmSync(file, { force: true });
  if (upload.status !== 200) throw new Error(`upload failed: ${upload.status}`);
  printId = upload.body.prints[0].id;
  plateId = upload.body.prints[0].plates[0].id;
  fileUrl = upload.body.prints[0].plates[0].url;
});

afterAll(async () => {
  if (printId) await auth(request(app).delete(`/api/print/${printId}`));
});

describe("a plate's 3MF format", () => {
  it("is read when the plate is stored", async () => {
    const res = await auth(request(app).get(`/api/print/${printId}`));
    expect(res.body.plates[0].format).toMatchObject({
      kind: "bambu",
      app: "BambuStudio",
      appVersion: "02.07.01.57",
      printer: "Bambu Lab A1 0.4 nozzle",
    });
  });

  it("is read on the model's next open for a plate stored before formats were", async () => {
    await prisma.plate.update({ where: { id: plateId }, data: { format: Prisma.DbNull } });
    const res = await auth(request(app).get(`/api/print/${printId}`));
    expect(res.body.plates[0].format).toMatchObject({ kind: "bambu" });
  });
});

describe("GET a plate adapted for a slicer", () => {
  it("serves the copy that slicer gets", async () => {
    expect(await fetchApplication(adaptedUrl("prusaslicer"))).toBe("Thingport");
    expect(await fetchApplication(adaptedUrl("elegooslicer"))).toBe(COMPATIBLE_TAG);
  });

  it("serves the file itself to a slicer that opens it as it is, or one it doesn't know", async () => {
    expect(await fetchApplication(adaptedUrl("bambustudio"))).toBe("BambuStudio-02.07.01.57");
    expect(await fetchApplication(adaptedUrl("other"))).toBe("BambuStudio-02.07.01.57");
  });

  it("still serves the old normalized copy, and the original without the flag", async () => {
    expect(await fetchApplication(`${fileUrl}?normalize=1`)).toBe("Thingport");
    expect(await fetchApplication(fileUrl)).toMatch(/^BambuStudio/);
    expect(await fetchApplication(`${fileUrl}?normalize=auto`)).toMatch(/^BambuStudio/);
  });

  it("leaves non-3MF plates untouched", async () => {
    const stl = await uploadStl();
    try {
      const url = stl.plates[0].url.replace(/\/file\/([^/]+)$/, "/adapted/prusaslicer/$1");
      const res = await auth(request(app).get(`/api${url}`)).responseType("blob");
      expect(res.status).toBe(200);
      expect(Buffer.from(res.body as Buffer).toString()).toBe("solid x endsolid");
    } finally {
      await auth(request(app).delete(`/api/print/${stl.id}`));
    }
  });
});

describe("POST a plate's adapt status", () => {
  it("prepares the copy and reports it ready", async () => {
    let status = "";
    for (let i = 0; i < 50 && status !== "ready"; i++) {
      const res = await auth(request(app).post(adaptStatusUrl()).send({ slicer: "cura" }));
      expect(res.status).toBe(200);
      status = res.body.status;
      expect(["preparing", "ready"]).toContain(status);
      if (status !== "ready") await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe("ready");
  });

  it("says original when the slicer opens the file as it is", async () => {
    const res = await auth(request(app).post(adaptStatusUrl()).send({ slicer: "bambustudio" }));
    expect(res.body).toEqual({ status: "original" });
    const none = await auth(request(app).post(adaptStatusUrl()).send({}));
    expect(none.body).toEqual({ status: "original" });
  });

  it("still answers the old normalize status, and rejects plates that aren't plain 3MF projects", async () => {
    const url = `/api${fileUrl.replace(/\/file\/[^/]+$/, "/normalize")}`;
    expect(["preparing", "ready"]).toContain((await auth(request(app).post(url))).body.status);
    const stl = await uploadStl();
    try {
      const stlUrl = `/api${stl.plates[0].url.replace(/\/file\/[^/]+$/, "/normalize")}`;
      expect((await auth(request(app).post(stlUrl))).status).toBe(400);
      const adaptUrl = `/api${stl.plates[0].url.replace(/\/file\/[^/]+$/, "/adapt")}`;
      expect((await auth(request(app).post(adaptUrl).send({ slicer: "prusaslicer" }))).body).toEqual({
        status: "original",
      });
    } finally {
      await auth(request(app).delete(`/api/print/${stl.id}`));
    }
  });

  it("404s for someone else's plate", async () => {
    const other = await request(app)
      .post("/api/register")
      .send({ displayName: "Other", email: `adapt-other-${Date.now()}@example.com`, password: "password123" });
    const res = await request(app)
      .post(adaptStatusUrl())
      .set("Authorization", `Bearer ${other.body.token}`)
      .send({ slicer: "prusaslicer" });
    expect(res.status).toBe(404);
  });
});
