import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { QUALITY_CHECK_VERSION } from "../src/services/meshQuality";
import { READER_VERSION } from "../src/services/modelPreviewCache";
import { getQualityChecks, setQualityChecks } from "../src/services/settingsService";

const app = createApp();
let token: string;
let printId: string;
let plateId: string;
let checksWereOn: boolean;

const auth = (req: request.Test) => req.set("Authorization", `Bearer ${token}`);

/** A closed tetrahedron where Windows' 3D Builder puts its model, which older readers refused. */
async function builderThreeMf(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3DModel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
  );
  zip.file(
    "3D/3DModel.model",
    `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" unit="millimeter">
 <resources><object id="1" type="model"><mesh>
  <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices>
  <triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="3" v3="2"/><triangle v1="1" v2="2" v3="3"/></triangles>
 </mesh></object></resources>
 <build><item objectid="1"/></build>
</model>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function fileQuality(): Promise<{ status: string; triangles: number | null }> {
  const res = await auth(request(app).get(`/api/print/${printId}/quality`));
  expect(res.status).toBe(200);
  return res.body.files[0];
}

beforeAll(async () => {
  const registered = await request(app)
    .post("/api/register")
    .send({
      displayName: "Quality Recheck",
      email: `quality-recheck-${Date.now()}@example.com`,
      password: "password123",
    });
  if (registered.status !== 200) throw new Error(`register failed: ${registered.status}`);
  token = registered.body.token;

  const file = path.join(os.tmpdir(), `quality-recheck-${Date.now()}.3mf`);
  fs.writeFileSync(file, await builderThreeMf());
  const upload = await auth(request(app).post("/api/upload")).attach("files", file);
  fs.rmSync(file, { force: true });
  if (upload.status !== 200) throw new Error(`upload failed: ${upload.status}`);
  printId = upload.body.prints[0].id;
  plateId = upload.body.prints[0].plates[0].id;

  checksWereOn = await getQualityChecks();
  await setQualityChecks(true);
});

afterAll(async () => {
  await setQualityChecks(checksWereOn);
});

describe("print checks of files a reader refused", () => {
  it("checks a file again once an older reader's refusal is out of date", async () => {
    await prisma.plate.update({
      where: { id: plateId },
      data: { qualityCheck: { version: QUALITY_CHECK_VERSION, status: "skipped", reason: "unsupported" } },
    });
    expect((await fileQuality()).status).toBe("unchecked");

    expect((await auth(request(app).post(`/api/print/${printId}/quality`))).status).toBe(200);
    let file = await fileQuality();
    for (let tries = 0; file.status === "checking" && tries < 100; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      file = await fileQuality();
    }
    expect(file).toMatchObject({ status: "good", triangles: 4 });
  });

  it("leaves a refusal by the current reader as it is", async () => {
    await prisma.plate.update({
      where: { id: plateId },
      data: {
        qualityCheck: {
          version: QUALITY_CHECK_VERSION,
          status: "skipped",
          reason: "unsupported",
          reader: READER_VERSION,
        },
      },
    });
    expect((await fileQuality()).status).toBe("skipped");
  });
});
