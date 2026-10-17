import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { getPublicUrl, setPublicUrl } from "../src/services/settingsService";

const app = createApp();
const stamp = Date.now();
const CLIENT_ID = "thingport";
const CLIENT_SECRET = "s3cret";

// A tiny OpenID provider: discovery, keys, a token endpoint that checks PKCE, and userinfo.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const codes = new Map<string, { nonce: string; challenge: string; claims: Record<string, unknown> }>();
let idp: Server;
let issuer: string;

function startIdp(): Promise<void> {
  const server = express();
  server.use(express.urlencoded({ extended: false }));
  server.get("/.well-known/openid-configuration", (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
    });
  });
  server.get("/jwks", (_req, res) => {
    res.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] });
  });
  server.post("/token", (req, res) => {
    const basic = Buffer.from((req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString();
    if (basic !== `${CLIENT_ID}:${CLIENT_SECRET}`) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }
    const entry = codes.get(String(req.body.code));
    codes.delete(String(req.body.code));
    const challenge = crypto.createHash("sha256").update(String(req.body.code_verifier)).digest("base64url");
    if (!entry || entry.challenge !== challenge) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const idToken = jwt.sign(
      { iss: issuer, aud: CLIENT_ID, nonce: entry.nonce, iat: now, exp: now + 300, ...entry.claims },
      privateKey,
      { algorithm: "RS256", keyid: "k1" },
    );
    res.json({ access_token: "at", token_type: "Bearer", expires_in: 300, id_token: idToken });
  });
  server.get("/userinfo", (_req, res) => {
    res.json({});
  });
  return new Promise((resolve) => {
    idp = server.listen(0, "127.0.0.1", () => {
      issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

let admin: string;
let member: string;
// The redirect URI and the callback page are built from it; it's one instance-wide row, so it's put back after.
let previousPublicUrl: string;

async function register(name: string, email: string): Promise<{ token: string; id: string }> {
  const res = await request(app).post("/api/register").send({ displayName: name, email, password: "password123" });
  expect(res.status).toBe(200);
  return { token: res.body.token, id: res.body.user.id };
}

const asAdmin = () => ({ Authorization: `Bearer ${admin}` });

async function addProvider(fields: Record<string, unknown> = {}): Promise<{ id: string; slug: string }> {
  const res = await request(app)
    .post("/api/settings/auth/oidc/providers")
    .set(asAdmin())
    .send({
      name: `Authentik ${stamp}`,
      slug: `idp-${stamp}-${crypto.randomBytes(3).toString("hex")}`,
      issuer_url: issuer,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      ...fields,
    });
  expect(res.status).toBe(201);
  return res.body;
}

/** Runs a sign-in end to end: where the callback sends the browser, as its #fragment. */
async function signIn(
  slug: string,
  claims: Record<string, unknown>,
  tamper: { state?: string; dropCookie?: boolean } = {},
): Promise<URLSearchParams> {
  const start = await request(app).get(`/api/auth/oidc/${slug}/start`);
  expect(start.status).toBe(303);
  const authorize = new URL(start.headers.location);
  if (!authorize.href.startsWith(issuer)) return new URLSearchParams(authorize.hash.slice(1));
  expect(authorize.searchParams.get("redirect_uri")).toBe(`http://thingport.test/api/auth/oidc/${slug}/callback`);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  const cookie = String(start.headers["set-cookie"]).split(";")[0];
  const code = crypto.randomBytes(8).toString("hex");
  codes.set(code, {
    nonce: authorize.searchParams.get("nonce")!,
    challenge: authorize.searchParams.get("code_challenge")!,
    claims,
  });
  const state = tamper.state ?? authorize.searchParams.get("state")!;
  const callback = request(app).get(`/api/auth/oidc/${slug}/callback?code=${code}&state=${state}`);
  const res = await (tamper.dropCookie ? callback : callback.set("Cookie", cookie));
  expect(res.status).toBe(303);
  const back = new URL(res.headers.location);
  expect(back.origin + back.pathname).toBe("http://thingport.test/oidc-callback");
  return new URLSearchParams(back.hash.slice(1));
}

async function exchange(fragment: URLSearchParams) {
  return request(app)
    .post("/api/auth/oidc/exchange")
    .send({ code: fragment.get("code") });
}

beforeAll(async () => {
  previousPublicUrl = await getPublicUrl();
  await setPublicUrl("http://thingport.test");
  await startIdp();
  const owner = await register("OIDC admin", `oidc-admin-${stamp}@example.com`);
  admin = owner.token;
  await prisma.user.update({ where: { id: owner.id }, data: { role: "ADMIN" } });
  member = (await register("OIDC member", `oidc-member-${stamp}@example.com`)).token;
});

afterAll(async () => {
  await setPublicUrl(previousPublicUrl || null);
  await prisma.oidcProvider.deleteMany({ where: { name: { contains: String(stamp) } } });
  await new Promise((resolve) => idp.close(resolve));
});

describe("OIDC providers (admin)", () => {
  it("keeps the client secret write-only and gives the redirect URI to register", async () => {
    const created = await addProvider({ name: `Pocket ID ${stamp}`, slug: undefined });
    const list = await request(app).get("/api/settings/auth/oidc").set(asAdmin());
    expect(list.status).toBe(200);
    expect(list.body.public_url).toBe("http://thingport.test");
    const out = list.body.providers.find((provider: { id: string }) => provider.id === created.id);
    expect(out).toMatchObject({
      slug: `pocket-id-${stamp}`,
      has_client_secret: true,
      redirect_uri: `http://thingport.test/api/auth/oidc/pocket-id-${stamp}/callback`,
      create_accounts: false,
      link_by_email: false,
    });
    expect(JSON.stringify(list.body)).not.toContain(CLIENT_SECRET);

    // Omitting the secret keeps it.
    const renamed = await request(app)
      .patch(`/api/settings/auth/oidc/providers/${created.id}`)
      .set(asAdmin())
      .send({ name: `PocketID ${stamp}` });
    expect(renamed.body).toMatchObject({ name: `PocketID ${stamp}`, has_client_secret: true });

    const clash = await request(app)
      .post("/api/settings/auth/oidc/providers")
      .set(asAdmin())
      .send({ name: "Again", slug: created.slug, issuer_url: issuer, client_id: "x" });
    expect(clash.status).toBe(409);
  });

  it("is for admins only", async () => {
    const res = await request(app)
      .get("/api/settings/auth/oidc")
      .set({ Authorization: `Bearer ${member}` });
    expect(res.status).toBe(403);
  });

  it("checks an issuer by its discovery document", async () => {
    const good = await request(app).post("/api/settings/auth/oidc/check").set(asAdmin()).send({ issuer_url: issuer });
    expect(good.body).toEqual({ ok: true, issuer });
    const bad = await request(app)
      .post("/api/settings/auth/oidc/check")
      .set(asAdmin())
      .send({ issuer_url: `${issuer}/nowhere` });
    expect(bad.body.ok).toBe(false);
  });
});

describe("signing in through a provider", () => {
  it("lists enabled providers on the sign-in page only", async () => {
    const on = await addProvider();
    const off = await addProvider({ enabled: false });
    const health = await request(app).get("/api/health");
    const slugs = health.body.oidc_providers.map((provider: { slug: string }) => provider.slug);
    expect(slugs).toContain(on.slug);
    expect(slugs).not.toContain(off.slug);
    const fragment = await signIn(off.slug, { sub: "x" });
    expect(fragment.get("error")).toMatch(/isn't available/);
  });

  it("refuses someone unknown unless the provider may create accounts", async () => {
    const provider = await addProvider();
    const fragment = await signIn(provider.slug, { sub: `new-${stamp}`, email: `new-${stamp}@example.com` });
    expect(fragment.get("error")).toMatch(/no Thingport account/);
    expect(await prisma.user.findUnique({ where: { email: `new-${stamp}@example.com` } })).toBeNull();
  });

  it("creates an account without a password, and signs the same person in again by their sub", async () => {
    const provider = await addProvider({ create_accounts: true });
    const email = `created-${stamp}@example.com`;
    const first = await signIn(provider.slug, { sub: `sub-${stamp}`, email, email_verified: true, name: "Ana" });
    const session = await exchange(first);
    expect(session.status).toBe(200);
    expect(session.body.user).toMatchObject({ email, display_name: "Ana", role: "MEMBER" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull();
    expect(await prisma.category.count({ where: { userId: user.id } })).toBeGreaterThan(0);

    // The code works once.
    expect((await exchange(first)).status).toBe(400);

    // A changed email at the provider still finds them.
    const again = await signIn(provider.slug, { sub: `sub-${stamp}`, email: `renamed-${stamp}@example.com` });
    expect((await exchange(again)).body.user.id).toBe(user.id);
    expect(await prisma.userIdentity.count({ where: { userId: user.id } })).toBe(1);

    // There's no password to sign in with.
    const login = await request(app).post("/api/login").send({ email, password: "anything" });
    expect(login.status).toBe(401);
  });

  it("links an existing account by email only when allowed and the provider verified it", async () => {
    const email = `linkme-${stamp}@example.com`;
    const existing = await register("Link me", email);
    const strict = await addProvider({ create_accounts: true });
    const refused = await signIn(strict.slug, { sub: `l1-${stamp}`, email, email_verified: true });
    expect(refused.get("error")).toMatch(/Sign in with your password/);

    const linking = await addProvider({ link_by_email: true });
    const unverified = await signIn(linking.slug, { sub: `l2-${stamp}`, email, email_verified: false });
    expect(unverified.get("error")).toMatch(/hasn't verified/);

    const linked = await signIn(linking.slug, { sub: `l2-${stamp}`, email, email_verified: "true" });
    expect((await exchange(linked)).body.user.id).toBe(existing.id);
    // Their password still works.
    expect((await request(app).post("/api/login").send({ email, password: "password123" })).status).toBe(200);
  });

  it("rejects a callback from another browser or with the wrong state", async () => {
    const provider = await addProvider({ create_accounts: true });
    const noCookie = await signIn(provider.slug, { sub: "c1" }, { dropCookie: true });
    expect(noCookie.get("error")).toMatch(/another browser/);
    const badState = await signIn(provider.slug, { sub: "c2" }, { state: "forged" });
    expect(badState.get("error")).toMatch(/Couldn't finish signing in/);
    expect(badState.get("code")).toBeNull();
  });

  it("says when the person cancelled at the provider", async () => {
    const provider = await addProvider();
    const start = await request(app).get(`/api/auth/oidc/${provider.slug}/start`);
    const cookie = String(start.headers["set-cookie"]).split(";")[0];
    const state = new URL(start.headers.location).searchParams.get("state");
    const res = await request(app)
      .get(`/api/auth/oidc/${provider.slug}/callback?error=access_denied&state=${state}`)
      .set("Cookie", cookie);
    expect(new URLSearchParams(new URL(res.headers.location).hash.slice(1)).get("error")).toMatch(/cancelled/);
  });
});

describe("testing a provider", () => {
  it("shows what the provider sends and who it would sign in, without signing anyone in", async () => {
    const provider = await addProvider({ create_accounts: true, enabled: false });
    const started = await request(app).post(`/api/settings/auth/oidc/providers/${provider.id}/test`).set(asAdmin());
    expect(started.status).toBe(200);
    const authorize = new URL(started.body.url);
    const cookie = String(started.headers["set-cookie"]).split(";")[0];
    const waiting = await request(app).get(`/api/settings/auth/oidc/tests/${started.body.test_id}`).set(asAdmin());
    expect(waiting.body).toEqual({ status: "waiting" });

    const email = `tested-${stamp}@example.com`;
    const code = "test-code";
    codes.set(code, {
      nonce: authorize.searchParams.get("nonce")!,
      challenge: authorize.searchParams.get("code_challenge")!,
      claims: { sub: `t-${stamp}`, email, email_verified: true, groups: ["family"] },
    });
    const callback = await request(app)
      .get(`/api/auth/oidc/${provider.slug}/callback?code=${code}&state=${authorize.searchParams.get("state")}`)
      .set("Cookie", cookie);
    expect(callback.status).toBe(200);
    expect(callback.text).toContain("Test finished");

    const done = await request(app).get(`/api/settings/auth/oidc/tests/${started.body.test_id}`).set(asAdmin());
    expect(done.body).toMatchObject({
      status: "done",
      ok: true,
      claims: { sub: `t-${stamp}`, email, groups: ["family"] },
      match: { action: "create", email },
    });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    // Another admin can't read it.
    const other = await request(app)
      .get(`/api/settings/auth/oidc/tests/${started.body.test_id}`)
      .set({ Authorization: `Bearer ${member}` });
    expect(other.status).toBe(403);
  });
});

/** Sends the browser through the provider as `claims`, from an authorize URL and flow cookie: where it lands. */
async function roundTrip(authorizeUrl: string, cookie: string, claims: Record<string, unknown>): Promise<URL> {
  const authorize = new URL(authorizeUrl);
  const code = crypto.randomBytes(8).toString("hex");
  codes.set(code, {
    nonce: authorize.searchParams.get("nonce")!,
    challenge: authorize.searchParams.get("code_challenge")!,
    claims,
  });
  const callback = new URL(authorize.searchParams.get("redirect_uri")!);
  const res = await request(app)
    .get(`${callback.pathname}?code=${code}&state=${authorize.searchParams.get("state")}`)
    .set("Cookie", cookie);
  expect(res.status).toBe(303);
  return new URL(res.headers.location);
}

const cookieOf = (res: request.Response) => String(res.headers["set-cookie"]).split(";")[0];
const fragmentOf = (url: URL) => new URLSearchParams(url.hash.slice(1));

/** A session for someone the provider created, signed in just now. */
async function ssoUser(slug: string, sub: string, email: string): Promise<{ token: string; id: string }> {
  const fragment = await signIn(slug, { sub, email, email_verified: true });
  const session = await exchange(fragment);
  expect(session.status).toBe(200);
  return { token: session.body.token, id: session.body.user.id };
}

describe("connecting providers from the profile", () => {
  it("lists the password and providers, and connects one to a password account", async () => {
    const provider = await addProvider({ name: `Connect ${stamp}` });
    const person = await register("Connector", `connector-${stamp}@example.com`);
    const as = { Authorization: `Bearer ${person.token}` };

    const before = await request(app).get("/api/profile/sign-in").set(as);
    expect(before.body.has_password).toBe(true);
    expect(before.body.providers.find((p: { slug: string }) => p.slug === provider.slug)).toMatchObject({
      connection: null,
    });

    const started = await request(app).post(`/api/profile/sign-in/${provider.slug}/connect`).set(as);
    expect(started.status).toBe(200);
    const landed = await roundTrip(started.body.url, cookieOf(started), { sub: `c-${stamp}`, email: "other@idp.lan" });
    expect(landed.pathname).toBe("/profile");
    expect(fragmentOf(landed).get("sso_connected")).toBe(provider.name);

    const after = await request(app).get("/api/profile/sign-in").set(as);
    expect(after.body.providers.find((p: { slug: string }) => p.slug === provider.slug).connection).toMatchObject({
      email: "other@idp.lan",
    });
    // Signing in through the provider now finds them, with "create accounts" and linking both off.
    const fragment = await signIn(provider.slug, { sub: `c-${stamp}` });
    expect((await exchange(fragment)).body.user.id).toBe(person.id);

    // The same provider account can't go to someone else, and they can't connect a second one.
    const someoneElse = await register("Someone", `someone-${stamp}@example.com`);
    const theirs = await request(app)
      .post(`/api/profile/sign-in/${provider.slug}/connect`)
      .set({ Authorization: `Bearer ${someoneElse.token}` });
    const refused = await roundTrip(theirs.body.url, cookieOf(theirs), { sub: `c-${stamp}` });
    expect(fragmentOf(refused).get("sso_error")).toMatch(/another Thingport account/);
    const second = await request(app).post(`/api/profile/sign-in/${provider.slug}/connect`).set(as);
    const twice = await roundTrip(second.body.url, cookieOf(second), { sub: `c2-${stamp}` });
    expect(fragmentOf(twice).get("sso_error")).toMatch(/already connected/);
  });

  it("won't disconnect someone's only way in", async () => {
    const provider = await addProvider({ create_accounts: true });
    const person = await ssoUser(provider.slug, `only-${stamp}`, `only-${stamp}@example.com`);
    const as = { Authorization: `Bearer ${person.token}` };
    const methods = await request(app).get("/api/profile/sign-in").set(as);
    expect(methods.body).toMatchObject({ has_password: false, signed_in_recently: true });
    const connection = methods.body.providers.find((p: { slug: string }) => p.slug === provider.slug).connection;
    const refused = await request(app).delete(`/api/profile/sign-in/connections/${connection.id}`).set(as);
    expect(refused.status).toBe(409);

    // With a password set, it can go.
    expect((await request(app).patch("/api/profile").set(as).send({ new_password: "brand-new-pass" })).status).toBe(
      200,
    );
    expect((await request(app).delete(`/api/profile/sign-in/connections/${connection.id}`).set(as)).status).toBe(204);
  });
});

describe("a password for someone who signs in through a provider", () => {
  it("can be set without one right after signing in, and then signs in", async () => {
    const provider = await addProvider({ create_accounts: true });
    const email = `setpw-${stamp}@example.com`;
    const person = await ssoUser(provider.slug, `setpw-${stamp}`, email);
    const res = await request(app)
      .patch("/api/profile")
      .set({ Authorization: `Bearer ${person.token}` })
      .send({ new_password: "my-new-password" });
    expect(res.status).toBe(200);
    expect((await request(app).post("/api/login").send({ email, password: "my-new-password" })).status).toBe(200);
    // Now it takes the current password like anyone else's.
    const again = await request(app)
      .patch("/api/profile")
      .set({ Authorization: `Bearer ${person.token}` })
      .send({ new_password: "another-password" });
    expect(again.status).toBe(400);
  });

  it("asks to confirm it's them when the sign-in wasn't recent, refreshing included", async () => {
    const provider = await addProvider({ create_accounts: true });
    const person = await ssoUser(provider.slug, `stale-${stamp}`, `stale-${stamp}@example.com`);
    const longAgo = Math.floor(Date.now() / 1000) - 60 * 60;
    const stale = jwt.sign(
      { sub: person.id, role: "MEMBER", sat: longAgo },
      process.env.AUTH_SECRET || "changeme-secret",
      {
        algorithm: "HS256",
        expiresIn: 600,
      },
    );
    const refused = await request(app)
      .patch("/api/profile")
      .set({ Authorization: `Bearer ${stale}` })
      .send({ new_password: "sneaky-password" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("REAUTH_REQUIRED");

    // A refreshed session keeps the old sign-in time.
    const refreshed = await request(app)
      .post("/api/refresh")
      .set({ Authorization: `Bearer ${stale}` });
    expect((jwt.decode(refreshed.body.token) as { sat: number }).sat).toBe(longAgo);

    // Confirming with the provider gives a fresh session, back on the page that asked.
    const started = await request(app)
      .post(`/api/profile/sign-in/${provider.slug}/confirm`)
      .set({ Authorization: `Bearer ${stale}` })
      .send({ next: "/profile/password" });
    const wrong = await roundTrip(started.body.url, cookieOf(started), { sub: "somebody-else" });
    expect(wrong.pathname).toBe("/profile/password");
    expect(fragmentOf(wrong).get("sso_error")).toMatch(/isn't the/);

    const again = await request(app)
      .post(`/api/profile/sign-in/${provider.slug}/confirm`)
      .set({ Authorization: `Bearer ${stale}` })
      .send({ next: "/profile/password" });
    const landed = await roundTrip(again.body.url, cookieOf(again), { sub: `stale-${stamp}` });
    expect(fragmentOf(landed).get("next")).toBe("/profile/password");
    const fresh = await exchange(fragmentOf(landed));
    const set = await request(app)
      .patch("/api/profile")
      .set({ Authorization: `Bearer ${fresh.body.token}` })
      .send({ new_password: "confirmed-password" });
    expect(set.status).toBe(200);
  });
});

describe("accepting an invitation through a provider", () => {
  it("creates the account for the invited address even when the provider doesn't create accounts", async () => {
    const provider = await addProvider();
    const email = `invited-${stamp}@example.com`;
    const invitation = await prisma.invitation.create({
      data: { email, token: `tok-${stamp}`, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const start = (invite: string) => request(app).get(`/api/auth/oidc/${provider.slug}/start?invite=${invite}`);

    const mismatch = await start(invitation.token);
    const wrongEmail = await roundTrip(mismatch.headers.location, cookieOf(mismatch), {
      sub: `inv-${stamp}`,
      email: "someone@else.lan",
    });
    expect(fragmentOf(wrongEmail).get("error")).toMatch(/invitation is for/);
    expect(await prisma.invitation.findUnique({ where: { id: invitation.id } })).not.toBeNull();

    const matching = await start(invitation.token);
    const joined = await roundTrip(matching.headers.location, cookieOf(matching), {
      sub: `inv-${stamp}`,
      email,
      name: "Invitee",
    });
    const session = await exchange(fragmentOf(joined));
    expect(session.body.user).toMatchObject({ email, display_name: "Invitee" });
    expect(await prisma.invitation.findUnique({ where: { id: invitation.id } })).toBeNull();

    const gone = await start(invitation.token);
    expect(fragmentOf(new URL(gone.headers.location)).get("error")).toMatch(/invalid or has expired/);
  });
});

describe("the users list", () => {
  it("shows how each person signs in", async () => {
    const provider = await addProvider({ name: `Listed ${stamp}`, create_accounts: true });
    const person = await ssoUser(provider.slug, `listed-${stamp}`, `listed-${stamp}@example.com`);
    const users = await request(app).get("/api/admin/users").set(asAdmin());
    const row = users.body.find((user: { id: string }) => user.id === person.id);
    expect(row.sign_in).toEqual({ password: false, providers: [{ name: `Listed ${stamp}`, enabled: true }] });
    const adminRow = users.body.find((user: { email: string }) => user.email === `oidc-admin-${stamp}@example.com`);
    expect(adminRow.sign_in).toEqual({ password: true, providers: [] });
  });
});
