import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const app = createApp();
const stamp = Date.now();
let session: string;
let userId: string;

const verifierAndChallenge = () => {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};

async function approve(challenge: string, name = "Chrome on macOS"): Promise<string> {
  const res = await request(app)
    .post("/api/grab/pairings")
    .set({ Authorization: `Bearer ${session}` })
    .send({ challenge, name });
  expect(res.status).toBe(200);
  return res.body.code;
}

beforeAll(async () => {
  const res = await request(app)
    .post("/api/register")
    .send({ displayName: "Grab", email: `grab-${stamp}@example.com`, password: "password123" });
  session = res.body.token;
  userId = res.body.user.id;
});

describe("connecting Thingport Grab by approval", () => {
  it("trades an approved code and the verifier for a connection that signs in until it's removed", async () => {
    const { verifier, challenge } = verifierAndChallenge();
    const code = await approve(challenge);
    const claimed = await request(app).post("/api/grab/pairings/claim").send({ code, verifier });
    expect(claimed.status).toBe(200);
    expect(claimed.body.connection_token).toMatch(/^tpg_/);
    expect(claimed.body.user.id).toBe(userId);
    // A Grab session isn't a recent sign-in.
    expect((jwt.decode(claimed.body.token) as { sat: number }).sat).toBe(0);

    // The code works once.
    expect((await request(app).post("/api/grab/pairings/claim").send({ code, verifier })).status).toBe(400);

    const renewed = await request(app)
      .post("/api/grab/session")
      .send({ connection_token: claimed.body.connection_token });
    expect(renewed.status).toBe(200);
    expect(renewed.body.user.id).toBe(userId);
    // The session it gets works like any other, writes included.
    const write = await request(app)
      .post("/api/collections")
      .set({ Authorization: `Bearer ${renewed.body.token}` })
      .send({ name: `From Grab ${stamp}` });
    expect(write.status).toBeLessThan(300);

    const listed = await request(app)
      .get("/api/profile/grab-connections")
      .set({ Authorization: `Bearer ${session}` });
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ name: "Chrome on macOS" });
    expect(listed.body[0].last_used_at).not.toBeNull();

    const removed = await request(app)
      .delete(`/api/profile/grab-connections/${listed.body[0].id}`)
      .set({ Authorization: `Bearer ${session}` });
    expect(removed.status).toBe(204);
    const refused = await request(app)
      .post("/api/grab/session")
      .send({ connection_token: claimed.body.connection_token });
    expect(refused.status).toBe(401);
  });

  it("refuses a code without its verifier, and burns it", async () => {
    const { verifier, challenge } = verifierAndChallenge();
    const code = await approve(challenge);
    const stolen = await request(app)
      .post("/api/grab/pairings/claim")
      .send({ code, verifier: crypto.randomBytes(32).toString("base64url") });
    expect(stolen.status).toBe(400);
    expect((await request(app).post("/api/grab/pairings/claim").send({ code, verifier })).status).toBe(400);
  });

  it("needs a signed-in user to approve", async () => {
    const { challenge } = verifierAndChallenge();
    const res = await request(app).post("/api/grab/pairings").send({ challenge, name: "x" });
    expect(res.status).toBe(401);
  });

  it("tells any origin what the instance offers", async () => {
    const res = await request(app).get("/api/health").set("Origin", "chrome-extension://abcdefgh");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body.grab_pairing).toBe(true);
    // Other routes keep the instance's own CORS rules.
    const other = await request(app).get("/api/captcha/settings").set("Origin", "chrome-extension://abcdefgh");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
