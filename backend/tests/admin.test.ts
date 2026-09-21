import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../src/app";
import { prisma } from "../src/db";

const app = createApp();
let adminToken: string;
let memberToken: string;
let memberUserId: string;

function tmpFile(name: string, contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingport-test-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, contents);
  return p;
}

beforeAll(async () => {
  const adminEmail = `admin-test-${Date.now()}@example.com`;
  const adminRegister = await request(app)
    .post("/api/register")
    .send({ displayName: "Admin Test", email: adminEmail, password: "password123" });
  if (adminRegister.status !== 200) {
    throw new Error(`Failed to register admin during test setup: ${adminRegister.status} ${JSON.stringify(adminRegister.body)}`);
  }
  await prisma.user.update({ where: { id: adminRegister.body.user.id }, data: { role: "ADMIN" } });
  // Tokens embed the role at issue time, so a promoted account needs a fresh login to pick it up.
  const adminLogin = await request(app).post("/api/login").send({ email: adminEmail, password: "password123" });
  adminToken = adminLogin.body.token;

  const memberEmail = `member-test-${Date.now()}@example.com`;
  const memberRegister = await request(app)
    .post("/api/register")
    .send({ displayName: "Member Test", email: memberEmail, password: "password123" });
  memberToken = memberRegister.body.token;
  memberUserId = memberRegister.body.user.id;
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Log writes are fire-and-forget (see services/auditLog.ts) so the HTTP response can return
// before the row lands -- poll briefly instead of asserting immediately after the triggering call.
async function waitForLog(
  token: string,
  predicate: (log: { action: string; target_id: string | null; details: Record<string, unknown> }) => boolean,
  timeoutMs = 2000,
): Promise<{ action: string; target_id: string | null; details: Record<string, unknown> } | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app).get("/api/admin/logs").set(auth(token));
    const found = (res.body as Array<{ action: string; target_id: string | null; details: Record<string, unknown> }>).find(predicate);
    if (found || Date.now() > deadline) return found;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("admin user management", () => {
  it("rejects a non-admin from listing users", async () => {
    const res = await request(app).get("/api/admin/users").set(auth(memberToken));
    expect(res.status).toBe(403);
  });

  it("rejects a non-admin from triggering a deletion", async () => {
    const res = await request(app).post(`/api/admin/users/${memberUserId}/delete-all-prints`).set(auth(memberToken));
    expect(res.status).toBe(403);
  });

  it("lists users with their print counts", async () => {
    await request(app)
      .post("/api/upload")
      .set(auth(memberToken))
      .attach("files", tmpFile("admin-test-a.stl", "solid a endsolid"));
    await request(app)
      .post("/api/upload")
      .set(auth(memberToken))
      .attach("files", tmpFile("admin-test-b.stl", "solid b endsolid"));

    const res = await request(app).get("/api/admin/users").set(auth(adminToken));
    expect(res.status).toBe(200);
    const member = res.body.find((u: { id: string }) => u.id === memberUserId);
    expect(member).toBeTruthy();
    expect(member.print_count).toBe(2);
    expect(member.collection_count).toBe(0);
    expect(member.makerworld_connected).toBe(false);
    expect(typeof member.created_at).toBe("string");
  });

  it("404s for deleting prints of a nonexistent user", async () => {
    const res = await request(app).post("/api/admin/users/does-not-exist/delete-all-prints").set(auth(adminToken));
    expect(res.status).toBe(404);
  });

  it("deletes every print belonging to the target user, leaving other users untouched", async () => {
    const deleteRes = await request(app)
      .post(`/api/admin/users/${memberUserId}/delete-all-prints`)
      .set(auth(adminToken));
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deleted).toBe(2);

    const printsRes = await request(app).get("/api/prints").set(auth(memberToken));
    expect(printsRes.body).toEqual([]);

    const usersRes = await request(app).get("/api/admin/users").set(auth(adminToken));
    const member = usersRes.body.find((u: { id: string }) => u.id === memberUserId);
    expect(member.print_count).toBe(0);
  });
});

describe("admin audit logs", () => {
  it("rejects a non-admin from listing logs", async () => {
    const res = await request(app).get("/api/admin/logs").set(auth(memberToken));
    expect(res.status).toBe(403);
  });

  it("logs a login", async () => {
    const found = await waitForLog(adminToken, (l) => l.action === "user_logged_in" && l.details.email !== undefined);
    expect(found).toBeTruthy();
  });

  it("logs a logout", async () => {
    const res = await request(app).post("/api/logout").set(auth(memberToken));
    expect(res.status).toBe(200);
    const found = await waitForLog(adminToken, (l) => l.action === "user_logged_out");
    expect(found).toBeTruthy();
  });

  it("logs model upload, edit, and delete", async () => {
    const uploadRes = await request(app)
      .post("/api/upload")
      .set(auth(memberToken))
      .attach("files", tmpFile("audit-log-test.stl", "solid a endsolid"));
    const printId = uploadRes.body.prints[0].id;

    const uploaded = await waitForLog(adminToken, (l) => l.action === "model_uploaded" && l.target_id === printId);
    expect(uploaded).toBeTruthy();

    await request(app).post(`/api/print/${printId}/meta`).set(auth(memberToken)).send({ notes: "updated" });
    const edited = await waitForLog(adminToken, (l) => l.action === "model_edited" && l.target_id === printId);
    expect(edited).toBeTruthy();

    await request(app).delete(`/api/print/${printId}`).set(auth(memberToken));
    const deleted = await waitForLog(adminToken, (l) => l.action === "model_deleted" && l.target_id === printId);
    expect(deleted).toBeTruthy();
  });

  it("logs collection create, edit, and delete", async () => {
    const createRes = await request(app)
      .post("/api/collections")
      .set(auth(memberToken))
      .send({ name: "Audit Log Test Collection", tags: [] });
    const collectionId = createRes.body.id;

    const created = await waitForLog(adminToken, (l) => l.action === "collection_created" && l.target_id === collectionId);
    expect(created).toBeTruthy();

    await request(app)
      .patch(`/api/collection/${collectionId}`)
      .set(auth(memberToken))
      .send({ name: "Audit Log Test Collection Renamed", tags: [] });
    const edited = await waitForLog(adminToken, (l) => l.action === "collection_edited" && l.target_id === collectionId);
    expect(edited).toBeTruthy();

    await request(app).delete(`/api/collection/${collectionId}`).set(auth(memberToken));
    const deleted = await waitForLog(adminToken, (l) => l.action === "collection_deleted" && l.target_id === collectionId);
    expect(deleted).toBeTruthy();
  });

  it("filters logs by user", async () => {
    const res = await request(app).get(`/api/admin/logs?user_id=${memberUserId}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect((res.body as Array<{ user_id: string }>).every((l) => l.user_id === memberUserId)).toBe(true);
  });
});

describe("admin storage usage", () => {
  it("rejects a non-admin", async () => {
    const res = await request(app).get("/api/admin/storage").set(auth(memberToken));
    expect(res.status).toBe(403);
  });

  it("grows by exactly an uploaded model's file size and count", async () => {
    const before = await request(app).get("/api/admin/storage").set(auth(adminToken));
    expect(before.status).toBe(200);

    const content = "solid storage-usage endsolid";
    const upload = await request(app)
      .post("/api/upload")
      .set(auth(memberToken))
      .attach("files", tmpFile("admin-storage-test.stl", content));
    expect(upload.status).toBe(200);

    const after = await request(app).get("/api/admin/storage").set(auth(adminToken));
    expect(after.status).toBe(200);
    expect(after.body.model_count).toBe(before.body.model_count + 1);
    expect(after.body.model_bytes).toBe(before.body.model_bytes + Buffer.byteLength(content));
  });
});
