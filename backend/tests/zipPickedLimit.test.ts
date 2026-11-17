import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { extractZipEntriesToOneModel } from "../src/services/zipService";

// A 100-byte import limit, so a zip's picked entries may come to 400 bytes in all.
vi.mock("../src/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/config")>()),
  IMPORT_MAX_BYTES: 100,
}));

let userId: string;
beforeAll(async () => {
  const res = await request(createApp())
    .post("/api/register")
    .send({ displayName: "Picked", email: `zip-picked-${Date.now()}@example.com`, password: "password123" });
  userId = res.body.user.id;
});

describe("a zip's picked entries, in all", () => {
  it("writes out no more than four imports' worth, and names the ones past it", async () => {
    const zip = new JSZip();
    const names = ["a.stl", "b.stl", "c.stl", "d.stl", "e.stl"];
    for (const name of names) zip.file(name, `solid ${name}${" ".repeat(80)}endsolid`);
    const zipPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "zip-picked-")), "kit.zip");
    fs.writeFileSync(zipPath, await zip.generateAsync({ type: "nodebuffer" }));
    const { prints, failed } = await extractZipEntriesToOneModel(userId, zipPath, "kit.zip", names, {});
    expect(prints[0].plates.map((plate) => plate.filename)).toEqual(["a.stl", "b.stl", "c.stl", "d.stl"]);
    expect(failed).toEqual(["e.stl"]);
  });
});
