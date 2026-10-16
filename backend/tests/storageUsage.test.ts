import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { THUMBS } from "../src/config";
import { prisma } from "../src/db";

const app = createApp();
let token: string;
const thumb = path.join(THUMBS, `storage-usage-${Date.now()}.jpg`);

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Storage", email: `storage-${Date.now()}@example.com`, password: "password123" });
  await prisma.user.update({ where: { id: res.body.user.id }, data: { role: "ADMIN" } });
  token = res.body.token;
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
});
