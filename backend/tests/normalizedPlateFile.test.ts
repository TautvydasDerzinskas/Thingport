import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { deleteNormalized3mf, normalize3mfStatus, normalized3mfFor } from "../src/services/normalized3mfCache";

const app = createApp();
let token: string;
let printId: string;
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
  zip.file("Metadata/project_settings.config", JSON.stringify({ wall_loops: "3", filament_colour: ["#FF0000"] }));
  return zip.generateAsync({ type: "nodebuffer" });
}

async function fetchApplication(query = "?normalize=1"): Promise<string> {
  const res = await auth(request(app).get(`/api${fileUrl}${query}`))
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

beforeAll(async () => {
  const email = `normalize-test-${Date.now()}@example.com`;
  const registered = await request(app)
    .post("/api/register")
    .send({ displayName: "Normalize Test", email, password: "password123" });
  if (registered.status !== 200) throw new Error(`register failed: ${registered.status}`);
  token = registered.body.token;

  const file = path.join(os.tmpdir(), `normalize-${Date.now()}.3mf`);
  fs.writeFileSync(file, await bambuProject());
  const upload = await auth(request(app).post("/api/upload")).attach("files", file);
  fs.rmSync(file, { force: true });
  if (upload.status !== 200) throw new Error(`upload failed: ${upload.status}`);
  printId = upload.body.prints[0].id;
  fileUrl = upload.body.prints[0].plates[0].url;
});

afterAll(async () => {
  if (printId) await auth(request(app).delete(`/api/print/${printId}`));
});

describe("GET plate file with ?normalize=1", () => {
  it("serves the normalized copy when asked", async () => {
    expect(await fetchApplication()).toBe("Thingport");
  });

  it("serves the original without the flag, so downloads and the viewer are unaffected", async () => {
    expect(await fetchApplication("")).toMatch(/^BambuStudio/);
  });

  it("ignores other flag values", async () => {
    expect(await fetchApplication("?normalize=auto")).toMatch(/^BambuStudio/);
  });

  it("leaves non-3MF plates untouched", async () => {
    const file = path.join(os.tmpdir(), `normalize-${Date.now()}.stl`);
    fs.writeFileSync(file, "solid x endsolid");
    const upload = await auth(request(app).post("/api/upload")).attach("files", file);
    fs.rmSync(file, { force: true });
    const stl = upload.body.prints[0];
    try {
      const res = await auth(request(app).get(`/api${stl.plates[0].url}?normalize=1`)).responseType("blob");
      expect(res.status).toBe(200);
      expect(Buffer.from(res.body as Buffer).toString()).toBe("solid x endsolid");
    } finally {
      await auth(request(app).delete(`/api/print/${stl.id}`));
    }
  });
});

describe("POST plate normalize status", () => {
  const normalizeUrl = () => `/api${fileUrl.replace(/\/file\/[^/]+$/, "/normalize")}`;

  it("reports ready once the copy exists", async () => {
    let status = "";
    for (let i = 0; i < 50 && status !== "ready"; i++) {
      const res = await auth(request(app).post(normalizeUrl()));
      expect(res.status).toBe(200);
      status = res.body.status;
      expect(["preparing", "ready"]).toContain(status);
      if (status !== "ready") await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe("ready");
  });

  it("rejects plates that aren't plain 3MF projects", async () => {
    const file = path.join(os.tmpdir(), `normalize-${Date.now()}.stl`);
    fs.writeFileSync(file, "solid x endsolid");
    const upload = await auth(request(app).post("/api/upload")).attach("files", file);
    fs.rmSync(file, { force: true });
    const stl = upload.body.prints[0];
    try {
      const url = `/api${stl.plates[0].url.replace(/\/file\/[^/]+$/, "/normalize")}`;
      expect((await auth(request(app).post(url))).status).toBe(400);
    } finally {
      await auth(request(app).delete(`/api/print/${stl.id}`));
    }
  });

  it("404s for someone else's plate", async () => {
    const other = await request(app)
      .post("/api/register")
      .send({ displayName: "Other", email: `normalize-other-${Date.now()}@example.com`, password: "password123" });
    const res = await request(app).post(normalizeUrl()).set("Authorization", `Bearer ${other.body.token}`);
    expect(res.status).toBe(404);
  });
});

describe("normalized copy cache per target", () => {
  const plateId = `cache-test-${Date.now()}`;
  const dir = path.join(os.tmpdir(), plateId);
  const good = path.join(dir, "good.3mf");
  const bad = path.join(dir, "bad.3mf");
  const errorFileOf = (copy: string) => copy.replace(/\.3mf$/, ".error");

  beforeAll(async () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(good, await bambuProject());
    fs.writeFileSync(bad, "not a zip");
  });

  afterAll(async () => {
    await deleteNormalized3mf(plateId);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a failure per target, so an Orca error doesn't block the flat copy", async () => {
    expect(await normalized3mfFor(plateId, bad, "orca")).toBeNull();
    expect(await normalize3mfStatus(plateId, bad, "orca")).toBe("failed");
    const flat = await normalized3mfFor(plateId, good, "flat");
    expect(flat).not.toBeNull();
    expect(await normalize3mfStatus(plateId, good, "flat")).toBe("ready");
    await deleteNormalized3mf(plateId);
  });

  it("rebuilds the Orca copy when the source changed after it was made", async () => {
    const orca = (await normalized3mfFor(plateId, good, "orca"))!;
    expect(orca).toContain(".orca.");
    expect(await normalize3mfStatus(plateId, good, "orca")).toBe("ready");
    const now = Date.now();
    fs.utimesSync(orca, new Date(now - 60_000), new Date(now - 60_000));
    fs.utimesSync(good, new Date(now - 30_000), new Date(now - 30_000));
    expect(await normalize3mfStatus(plateId, good, "orca")).toBe("preparing");
    expect(await normalized3mfFor(plateId, good, "orca")).toBe(orca);
    expect(fs.statSync(orca).mtimeMs).toBeGreaterThanOrEqual(fs.statSync(good).mtimeMs);
    expect(await normalize3mfStatus(plateId, good, "orca")).toBe("ready");
  });

  it("deletes the copies and error markers of both targets", async () => {
    const flat = (await normalized3mfFor(plateId, good, "flat"))!;
    const orca = (await normalized3mfFor(plateId, good, "orca"))!;
    const orcaError = errorFileOf(orca);
    const flatError = errorFileOf(flat);
    fs.writeFileSync(orcaError, "x");
    fs.writeFileSync(flatError, "x");
    await deleteNormalized3mf(plateId);
    for (const file of [flat, orca, orcaError, flatError]) expect(fs.existsSync(file)).toBe(false);
  });
});
