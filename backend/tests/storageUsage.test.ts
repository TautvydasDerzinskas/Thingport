import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { THUMBS } from "../src/config";
import { prisma } from "../src/db";

const app = createApp();
let token: string;
let userId: string;
const thumb = path.join(THUMBS, `storage-usage-${Date.now()}.jpg`);

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Storage", email: `storage-${Date.now()}@example.com`, password: "password123" });
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role: "ADMIN" } });
  token = res.body.token;
  userId = res.body.user.id;
  // A known picture, measured before anything else asks (the measurement is kept for a few minutes).
  fs.mkdirSync(THUMBS, { recursive: true });
  fs.writeFileSync(thumb, Buffer.alloc(50_000));
  return () => fs.rmSync(thumb, { force: true });
});

describe("storage usage", () => {
  it("adds what's on disk, models' pictures and previews included, to what the models take", async () => {
    const res = await request(app)
      .get("/api/admin/storage")
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const usage = res.body as Record<string, number>;
    expect(usage.picture_bytes).toBeGreaterThanOrEqual(50_000);
    expect(usage.total_bytes).toBeGreaterThanOrEqual(usage.picture_bytes + usage.other_generated_bytes);
    expect(usage.other_generated_bytes).toBeGreaterThanOrEqual(0);
  });

  it("tells the files kept beside the plates and the prepared prints apart, as parts of what the models take", async () => {
    const usage = async () =>
      (
        await request(app)
          .get("/api/admin/storage")
          .set({ Authorization: `Bearer ${token}` })
      ).body as Record<string, number>;
    const before = await usage();
    const print = await prisma.print.create({ data: { userId, name: "Sizes", nameNormalized: "sizes" } });
    const stamp = Date.now();
    // Rows only, as the sizes are read from them: no file is placed, so they go again below.
    await prisma.printFile.createMany({
      data: [
        {
          printId: print.id,
          role: "SUPPORTING",
          filename: "guide.pdf",
          mime: "application/pdf",
          size: 1234,
          storagePath: `sizes-${stamp}/guide.pdf`,
        },
        {
          printId: print.id,
          role: "PREPARED",
          filename: "tower.gcode",
          mime: "text/x-gcode",
          size: 99,
          storagePath: `sizes-${stamp}/tower.gcode`,
        },
      ],
    });
    try {
      const after = await usage();
      expect([after.supporting_bytes - before.supporting_bytes, after.prepared_bytes - before.prepared_bytes]).toEqual([
        1234, 99,
      ]);
      expect(after.model_bytes - before.model_bytes).toBe(1234 + 99);
      expect(after.supporting_bytes + after.prepared_bytes).toBeLessThanOrEqual(after.model_bytes);
    } finally {
      await prisma.print.delete({ where: { id: print.id } });
    }
  });
});
