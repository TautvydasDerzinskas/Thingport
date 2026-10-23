import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { AUTH_ALGO, AUTH_SECRET } from "../src/config";
import { prisma } from "../src/db";

const app = createApp();
const password = "password123";

function auth(t: string) {
  return { Authorization: `Bearer ${t}` };
}

/** The session cookie a response set, as a browser would send it back. */
function sessionCookie(res: request.Response): string {
  const set = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = set.find((c) => c.startsWith("thingport_session=") && !c.includes("Max-Age=0"));
  if (!cookie) throw new Error(`No session cookie in ${JSON.stringify(set)}`);
  return cookie.split(";")[0];
}

async function signUp(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request(app).post("/api/register").send({ displayName: prefix, email, password });
  if (res.status !== 200) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, token: res.body.token as string, cookie: sessionCookie(res), userId: res.body.user.id as string };
}

/** The user's token as it is once it has run out: signed, but past its expiry. */
function expired(token: string): string {
  const { sub, role, sat, sid } = jwt.decode(token) as jwt.JwtPayload;
  return jwt.sign({ sub, role, sat, sid, exp: Math.floor(Date.now() / 1000) - 60 }, AUTH_SECRET, {
    algorithm: AUTH_ALGO,
  });
}

describe("browser sessions", () => {
  let account: Awaited<ReturnType<typeof signUp>>;

  beforeAll(async () => {
    account = await signUp("session-test");
  });

  it("signs in with an httpOnly, Strict cookie and a token that names the session", async () => {
    const res = await request(app).post("/api/login").send({ email: account.email, password });
    expect(res.status).toBe(200);
    const set = ([] as string[]).concat(res.headers["set-cookie"]);
    const cookie = set.find((c) => c.startsWith("thingport_session="))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).not.toMatch(/Secure/);
    expect((jwt.decode(res.body.token) as { sid?: string }).sid).toBeTruthy();
  });

  it("marks the cookie Secure behind https", async () => {
    const res = await request(app)
      .post("/api/login")
      .set("X-Forwarded-Proto", "https")
      .send({ email: account.email, password });
    expect(([] as string[]).concat(res.headers["set-cookie"]).join("\n")).toMatch(/thingport_session=[^;]+;.*Secure/);
  });

  it("gets a new token from the cookie once the old one has run out, keeping the sign-in time", async () => {
    const res = await request(app)
      .post("/api/refresh")
      .set({ ...auth(expired(account.token)), Cookie: account.cookie, "Sec-Fetch-Site": "same-origin" });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(account.email);
    const before = jwt.decode(account.token) as { sat: number; sid: string };
    const after = jwt.decode(res.body.token) as { sat: number; sid: string };
    expect(after.sid).toBe(before.sid);
    expect(after.sat).toBe(before.sat);
    const works = await request(app).get("/api/profile/api-token").set(auth(res.body.token));
    expect(works.status).toBe(200);
  });

  it("refreshes with the cookie alone", async () => {
    const res = await request(app).post("/api/refresh").set({ Cookie: account.cookie });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("won't trade the cookie for a token from another site", async () => {
    const res = await request(app).post("/api/refresh").set({ Cookie: account.cookie, "Sec-Fetch-Site": "same-site" });
    expect(res.status).toBe(403);
  });

  it("refuses without a token or a cookie, and with a made-up cookie", async () => {
    expect((await request(app).post("/api/refresh")).status).toBe(401);
    const res = await request(app).post("/api/refresh").set({ Cookie: "thingport_session=nonsense" });
    expect(res.status).toBe(401);
  });

  it("gives a token from before sessions a session of its own", async () => {
    const legacy = jwt.sign({ sub: account.userId, role: "MEMBER", sat: 1000 }, AUTH_SECRET, {
      algorithm: AUTH_ALGO,
      expiresIn: 600,
    });
    const res = await request(app).post("/api/refresh").set(auth(legacy));
    expect(res.status).toBe(200);
    const payload = jwt.decode(res.body.token) as { sid?: string; sat: number };
    expect(payload.sid).toBeTruthy();
    expect(payload.sat).toBe(1000);
    const again = await request(app)
      .post("/api/refresh")
      .set({ Cookie: sessionCookie(res) });
    expect(again.status).toBe(200);
  });

  it("refuses a cookie whose session has expired", async () => {
    const other = await signUp("session-expired");
    const { sid } = jwt.decode(other.token) as { sid: string };
    await prisma.session.update({ where: { id: sid }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await request(app).post("/api/refresh").set({ Cookie: other.cookie });
    expect(res.status).toBe(401);
  });

  it("signing out ends the session: its cookie and its tokens stop working", async () => {
    const other = await signUp("session-logout");
    const out = await request(app)
      .post("/api/logout")
      .set({ ...auth(other.token), Cookie: other.cookie });
    expect(out.status).toBe(200);
    expect(([] as string[]).concat(out.headers["set-cookie"]).join("\n")).toMatch(/thingport_session=;.*Max-Age=0/);
    expect((await request(app).post("/api/refresh").set({ Cookie: other.cookie })).status).toBe(401);
    expect((await request(app).get("/api/profile/api-token").set(auth(other.token))).status).toBe(401);
  });

  it("signs out by cookie alone, after the token has run out", async () => {
    const other = await signUp("session-logout-cookie");
    const out = await request(app).post("/api/logout").set({ Cookie: other.cookie });
    expect(out.status).toBe(200);
    expect((await request(app).post("/api/refresh").set({ Cookie: other.cookie })).status).toBe(401);
  });

  it("changing the password signs out every other browser, not this one", async () => {
    const other = await signUp("session-password");
    const second = await request(app).post("/api/login").send({ email: other.email, password });
    const changed = await request(app)
      .patch("/api/profile")
      .set(auth(other.token))
      .send({ current_password: password, new_password: "newpassword123" });
    expect(changed.status).toBe(200);
    expect((await request(app).get("/api/profile/api-token").set(auth(other.token))).status).toBe(200);
    expect((await request(app).get("/api/profile/api-token").set(auth(second.body.token))).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/refresh")
          .set({ Cookie: sessionCookie(second) })
      ).status,
    ).toBe(401);
  });

  it("deleting the user deletes their sessions", async () => {
    const other = await signUp("session-delete");
    await prisma.user.delete({ where: { id: other.userId } });
    expect(await prisma.session.count({ where: { userId: other.userId } })).toBe(0);
  });
});
