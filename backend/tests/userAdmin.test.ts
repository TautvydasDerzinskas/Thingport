import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { STORAGE, TAG_MOSAICS } from "../src/config";
import { prisma } from "../src/db";

const app = createApp();
const STL =
  "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";

type Account = { id: string; token: string };
let seq = 0;

async function account(kind: "owner" | "admin" | "member"): Promise<Account> {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: kind, email: `roles-${kind}-${Date.now()}-${seq++}@example.com`, password: "password123" });
  const id = res.body.user.id as string;
  await prisma.user.update({
    where: { id },
    data: { role: kind === "member" ? "MEMBER" : "ADMIN", isOwner: kind === "owner" },
  });
  return { id, token: res.body.token as string };
}

const as = (who: Account) => ({ Authorization: `Bearer ${who.token}` });
const setRole = (who: Account, target: Account, role: "ADMIN" | "MEMBER") =>
  request(app).patch(`/api/admin/users/${target.id}/role`).set(as(who)).send({ role });
const remove = (who: Account, target: Account) => request(app).delete(`/api/admin/users/${target.id}`).set(as(who));
const roleOf = async (target: Account) => (await prisma.user.findUnique({ where: { id: target.id } }))?.role;

let owner: Account;
let admin: Account;
let member: Account;

beforeEach(async () => {
  owner = await account("owner");
  admin = await account("admin");
  member = await account("member");
});

describe("roles", () => {
  it("let any admin make a member an admin, but only the owner take it away", async () => {
    expect((await setRole(admin, member, "ADMIN")).status).toBe(200);
    expect(await roleOf(member)).toBe("ADMIN");

    expect((await setRole(admin, member, "MEMBER")).status).toBe(403);
    expect((await setRole(owner, member, "MEMBER")).status).toBe(200);
    expect(await roleOf(member)).toBe("MEMBER");
  });

  it("never let anyone demote the owner or themselves", async () => {
    const other = await account("owner");
    expect((await setRole(other, owner, "MEMBER")).status).toBe(403);
    expect((await setRole(owner, owner, "MEMBER")).status).toBe(403);
    expect((await setRole(admin, admin, "MEMBER")).status).toBe(403);
  });

  it("refuse members", async () => {
    const other = await account("member");
    expect((await setRole(member, other, "ADMIN")).status).toBe(403);
    expect((await remove(member, other)).status).toBe(403);
  });

  it("take effect at once, without waiting for the session to expire", async () => {
    expect((await request(app).get("/api/admin/users").set(as(admin))).status).toBe(200);
    await setRole(owner, admin, "MEMBER");
    expect((await request(app).get("/api/admin/users").set(as(admin))).status).toBe(403);
  });

  it("tell each admin what they may do to whom", async () => {
    const list = async (who: Account) =>
      new Map(
        ((await request(app).get("/api/admin/users").set(as(who))).body as { id: string }[]).map((u) => [u.id, u]),
      );
    const byAdmin = await list(admin);
    expect(byAdmin.get(member.id)).toMatchObject({ can_promote: true, can_demote: false, can_delete: true });
    expect(byAdmin.get(owner.id)).toMatchObject({
      is_owner: true,
      can_promote: false,
      can_demote: false,
      can_delete: false,
    });
    expect(byAdmin.get(admin.id)).toMatchObject({ can_demote: false, can_delete: false });
    const byOwner = await list(owner);
    expect(byOwner.get(admin.id)).toMatchObject({ can_promote: false, can_demote: true, can_delete: true });
  });
});

describe("deleting a user", () => {
  it("is for members by any admin, and for admins only by the owner; never the owner or yourself", async () => {
    expect((await remove(admin, owner)).status).toBe(403);
    expect((await remove(admin, admin)).status).toBe(403);
    const otherAdmin = await account("admin");
    expect((await remove(admin, otherAdmin)).status).toBe(403);
    expect((await remove(owner, otherAdmin)).status).toBe(200);
    expect((await remove(admin, member)).status).toBe(200);
  });

  it("removes the account, its models and every file, and logs it as the admin's", async () => {
    const upload = await request(app).post("/api/upload").set(as(member)).attach("files", Buffer.from(STL), "part.stl");
    expect(upload.status).toBe(200);
    const userFiles = path.join(STORAGE, `u-${member.id}`);
    const mosaics = path.join(TAG_MOSAICS, `u-${member.id}`);
    fs.mkdirSync(path.join(userFiles, "leftover"), { recursive: true });
    fs.mkdirSync(mosaics, { recursive: true });
    fs.writeFileSync(path.join(mosaics, "tag.webp"), "x");

    const res = await remove(admin, member);
    expect(res.status).toBe(200);
    expect(res.body.models).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: member.id } })).toBeNull();
    expect(await prisma.print.count({ where: { userId: member.id } })).toBe(0);
    expect(fs.existsSync(userFiles)).toBe(false);
    expect(fs.existsSync(mosaics)).toBe(false);
    // The deleted user's session no longer works.
    expect((await request(app).get("/api/prints").set(as(member))).status).toBe(401);
    // Logged once the response is out; give it a moment.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const log = await prisma.log.findFirst({
      where: { userId: admin.id, action: "user_deleted", targetId: member.id },
    });
    expect(log?.details).toMatchObject({ models: 1 });
  });

  it("404s for a user that isn't there", async () => {
    expect((await request(app).delete("/api/admin/users/nobody").set(as(owner))).status).toBe(404);
  });
});

describe("the first sign-up", () => {
  it("makes exactly one owner, however many arrive at once", async () => {
    // A fresh instance, for the length of this test: nobody is an admin yet.
    const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, isOwner: true } });
    await prisma.user.updateMany({ where: { role: "ADMIN" }, data: { role: "MEMBER", isOwner: false } });
    const created: string[] = [];
    try {
      const stamp = Date.now();
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          request(app)
            .post("/api/register")
            .send({ displayName: `First ${i}`, email: `first-${stamp}-${i}@example.com`, password: "password123" }),
        ),
      );
      for (const res of results) if (res.body.user) created.push(res.body.user.id);
      expect(results.map((res) => res.status).toSorted()).toEqual([200, 409, 409, 409, 409]);
      const winners = await prisma.user.findMany({ where: { id: { in: created } } });
      expect(winners.map((user) => [user.role, user.isOwner])).toEqual([["ADMIN", true]]);
    } finally {
      await prisma.user.deleteMany({ where: { id: { in: created } } });
      for (const previous of admins) {
        await prisma.user.update({ where: { id: previous.id }, data: { role: "ADMIN", isOwner: previous.isOwner } });
      }
    }
  });
});
