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
import { resolvePlateFilePath } from "../src/services/printCreation";
import { readThreeMfFormat } from "../src/services/threeMfFormat";

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

async function prusaProject(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "3D/3dmodel.model",
    '<?xml version="1.0"?><model><metadata name="Application">PrusaSlicer-2.9.2</metadata></model>',
  );
  zip.file("Metadata/Slic3r_PE.config", "; printer_settings_id = Original Prusa MK4\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

/** A print: G-code alongside the model, as a slicer's "export plate sliced file" writes it, under a plain name. */
async function slicedPrint(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await bambuProject());
  zip.file("Metadata/plate_1.gcode", "G28\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

async function uploadModel(
  content: Buffer,
  name: string,
): Promise<{ id: string; plates: { id: string; url: string }[] }> {
  const file = path.join(os.tmpdir(), `adapt-${Date.now()}-${name}`);
  fs.writeFileSync(file, content);
  const upload = await auth(request(app).post("/api/upload")).attach("files", file, name);
  fs.rmSync(file, { force: true });
  if (upload.status !== 200) throw new Error(`upload failed: ${upload.status}`);
  return upload.body.prints[0];
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await auth(request(app).get(`/api${url}`))
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  return res.body as Buffer;
}

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

  it("is read again once the file has changed in place, and keeps what it was read from to itself", async () => {
    const model = await uploadModel(await bambuProject(), "changing.3mf");
    try {
      const plate = await prisma.plate.findUniqueOrThrow({ where: { id: model.plates[0].id } });
      expect(plate.format).toMatchObject({ kind: "bambu", file: { size: expect.any(Number) } });
      const before = await auth(request(app).get(`/api/print/${model.id}`));
      expect(before.body.plates[0].format).not.toHaveProperty("file");

      const filePath = resolvePlateFilePath(plate)!;
      fs.writeFileSync(filePath, await prusaProject());
      const after = await auth(request(app).get(`/api/print/${model.id}`));
      expect(after.body.plates[0].format).toMatchObject({ kind: "prusa", printer: "Original Prusa MK4" });
      const adapt = `/api${model.plates[0].url.replace(/\/file\/[^/]+$/, "/adapt")}`;
      expect((await auth(request(app).post(adapt).send({ slicer: "prusaslicer" }))).body).toEqual({
        status: "original",
      });
    } finally {
      await auth(request(app).delete(`/api/print/${model.id}`));
    }
  });

  it("reads a plain 3MF's colours from its whole model, wherever they are", async () => {
    const vertices = Array.from({ length: 4000 }, (_, i) => `<vertex x="${i}" y="0" z="0"/>`).join("");
    const zip = new JSZip();
    zip.file(
      "3D/3dmodel.model",
      `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
 <resources>
  <m:colorgroup id="1"><m:color color="#FF0000FF"/></m:colorgroup>
  <object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${vertices}</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
  <m:colorgroup id="3"><m:color color="#00FF00FF"/><m:color color="#ff0000"/></m:colorgroup>
  <basematerials id="5"><base name="Blue" displaycolor="#0000FF"/></basematerials>
  <object id="4" type="model" pid="3" pindex="0"><mesh><vertices>${vertices}</vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
 </resources>
 <build><item objectid="2"/><item objectid="4"/></build>
</model>`,
    );
    const file = path.join(os.tmpdir(), `adapt-plain-${Date.now()}.3mf`);
    fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
    try {
      expect(await readThreeMfFormat(file)).toMatchObject({
        kind: "plain",
        filaments: 3,
        painted: false,
      });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it("counts the colours of the models a plain 3MF's objects come from, and whether every triangle is painted", async () => {
    const triangle = (paint: string) =>
      `<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"${paint}/></triangles></mesh>`;
    const plain = async (second: string) => {
      const zip = new JSZip();
      zip.file(
        "3D/3dmodel.model",
        `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <resources><object id="9" type="model"><components>
  <component p:path="/3D/parts.model" objectid="1"/><component p:path="/3D/parts.model" objectid="2"/>
 </components></object></resources>
 <build><item objectid="9"/></build>
</model>`,
      );
      zip.file(
        // Not 3D/Objects, which makes it Bambu Studio's layout.
        "3D/parts.model",
        `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
 <resources>
  <m:colorgroup id="5"><m:color color="#FF0000"/><m:color color="#00FF00"/></m:colorgroup>
  <object id="1" type="model" pid="5" pindex="0">${triangle(' slic3rpe:mmu_segmentation="4"')}</object>
  <object id="2" type="model" pid="5" pindex="1">${triangle(second)}</object>
 </resources>
</model>`,
      );
      const file = path.join(os.tmpdir(), `adapt-parts-${Date.now()}-${Math.random()}.3mf`);
      fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
      try {
        return await readThreeMfFormat(file);
      } finally {
        fs.rmSync(file, { force: true });
      }
    };
    // One of two painted: the other's colour is still the colour group's.
    expect(await plain("")).toMatchObject({ kind: "plain", filaments: 2, painted: false });
    expect(await plain(' slic3rpe:mmu_segmentation="8"')).toMatchObject({ kind: "plain", filaments: 2, painted: true });
  });

  it("finds its small files under names written with backslashes", async () => {
    const zip = new JSZip();
    zip.file("3D\\3dmodel.model", '<model><metadata name="Application">BambuStudio-02.08.02.61</metadata></model>');
    zip.file("Metadata\\project_settings.config", JSON.stringify({ printer_settings_id: "Bambu Lab P1S 0.4 nozzle" }));
    const file = path.join(os.tmpdir(), `adapt-slash-${Date.now()}.3mf`);
    fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
    try {
      expect(await readThreeMfFormat(file)).toMatchObject({
        kind: "bambu",
        app: "BambuStudio",
        printer: "Bambu Lab P1S 0.4 nozzle",
      });
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});

describe("GET a plate adapted for a slicer", () => {
  it("serves the copy that slicer gets", async () => {
    expect(await fetchApplication(adaptedUrl("prusaslicer"))).toBe("Thingport");
    expect(await fetchApplication(adaptedUrl("elegooslicer"))).toBe(COMPATIBLE_TAG);
  });

  it("serves a copy made for a printer, naming that slicer's presets for it", async () => {
    const url = fileUrl.replace(
      /\/file\/([^/]+)$/,
      (_all, name: string) => `/adapted/bambustudio/bambulab-p1s/0.4/${name}`,
    );
    const zip = await JSZip.loadAsync(await fetchBytes(url));
    const settings = JSON.parse(await zip.file("Metadata/project_settings.config")!.async("string"));
    expect(settings.printer_settings_id).toBe("Bambu Lab P1S 0.4 nozzle");
    expect(settings.inherits_group).toEqual(["", "", ""]);
    // One the slicer has no preset for gets the slicer's plain copy; a malformed printer isn't a link.
    const unknown = fileUrl.replace(
      /\/file\/([^/]+)$/,
      (_all, name: string) => `/adapted/bambustudio/no-such-printer/0.4/${name}`,
    );
    expect(await fetchApplication(unknown)).toBe("BambuStudio-02.07.01.57");
    const bad = fileUrl.replace(
      /\/file\/([^/]+)$/,
      (_all, name: string) => `/adapted/bambustudio/Bambu Lab/0.4/${name}`,
    );
    expect((await auth(request(app).get(`/api${encodeURI(bad)}`))).status).toBe(404);
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

  it("never makes the old normalized copy of a print, even one that isn't the model's first file", async () => {
    const model = await uploadModel(await bambuProject(), "project.3mf");
    try {
      const file = path.join(os.tmpdir(), `adapt-${Date.now()}-print.3mf`);
      fs.writeFileSync(file, await slicedPrint());
      const added = await auth(request(app).post(`/api/print/${model.id}/plates`)).attach("files", file, "print.3mf");
      fs.rmSync(file, { force: true });
      expect(added.status).toBe(200);
      const sliced = added.body.print.plates.find((p: { filename: string }) => p.filename === "print.3mf");
      const bytes = await fetchBytes(`${sliced.url}?normalize=1`);
      expect((await JSZip.loadAsync(bytes)).file("Metadata/plate_1.gcode")).not.toBeNull();
      const status = `/api${sliced.url.replace(/\/file\/[^/]+$/, "/normalize")}`;
      expect((await auth(request(app).post(status))).body).toEqual({ status: "ready" });
    } finally {
      await auth(request(app).delete(`/api/print/${model.id}`));
    }
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

  it("prepares a copy for a printer, which the slicer would open as it is otherwise", async () => {
    let status = "";
    for (let i = 0; i < 50 && status !== "ready"; i++) {
      const res = await auth(
        request(app)
          .post(adaptStatusUrl())
          .send({
            slicer: "bambustudio",
            printer: { id: "bambulab-p1s", nozzle: "0.4" },
          }),
      );
      expect(res.status).toBe(200);
      status = res.body.status;
      if (status !== "ready") await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe("ready");
    const bad = await auth(
      request(app)
        .post(adaptStatusUrl())
        .send({ slicer: "bambustudio", printer: { id: "../x" } }),
    );
    expect(bad.status).toBe(400);
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
