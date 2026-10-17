import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// The mailer is mocked; tests read the invitation link from its calls.
vi.mock("../src/services/mailer", () => ({
  sendVerificationEmail: vi.fn<(to: string, displayName: string, token: string) => Promise<void>>(
    async () => undefined,
  ),
  sendInvitationEmail: vi.fn<(to: string, inviterName: string, link: string, expiresInDays: number) => Promise<void>>(
    async () => undefined,
  ),
}));

import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { sendInvitationEmail, sendVerificationEmail } from "../src/services/mailer";
import {
  getAllowRegistrations,
  getSmtpSettings,
  setAllowRegistrations,
  setSmtpSettings,
} from "../src/services/settingsService";

const app = createApp();
const sendInvitation = vi.mocked(sendInvitationEmail);
const sendVerification = vi.mocked(sendVerificationEmail);
let adminToken: string;
let memberToken: string;
// The database is shared across files, so restore the instance-wide settings afterwards.
let previousSmtpHost: string | null;
let previousAllowRegistrations: boolean;

const stamp = Date.now();
const email = (name: string) => `${name}-${stamp}@example.com`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function lastInvitationToken(): string {
  const link = sendInvitation.mock.calls.at(-1)![2];
  return new URL(link, "http://thingport.test").searchParams.get("invite")!;
}

async function closeRegistrationsWithSmtp() {
  await setAllowRegistrations(false);
  await setSmtpSettings({ host: "smtp.example.test" });
}

beforeAll(async () => {
  previousSmtpHost = (await getSmtpSettings()).host;
  previousAllowRegistrations = await getAllowRegistrations(true);
  await setAllowRegistrations(true);
  await setSmtpSettings({ host: null });

  const adminRegister = await request(app)
    .post("/api/register")
    .send({ displayName: "Invite Admin", email: email("invite-admin"), password: "password123" });
  await prisma.user.update({ where: { id: adminRegister.body.user.id }, data: { role: "ADMIN" } });
  adminToken = (
    await request(app)
      .post("/api/login")
      .send({ email: email("invite-admin"), password: "password123" })
  ).body.token;

  const memberRegister = await request(app)
    .post("/api/register")
    .send({ displayName: "Invite Member", email: email("invite-member"), password: "password123" });
  memberToken = memberRegister.body.token;
});

afterAll(async () => {
  await setAllowRegistrations(previousAllowRegistrations);
  await setSmtpSettings({ host: previousSmtpHost });
});

beforeEach(async () => {
  sendInvitation.mockClear();
  sendVerification.mockClear();
  await setAllowRegistrations(true);
  await setSmtpSettings({ host: null });
});

describe("closing registrations", () => {
  it("refuses a plain registration and hides registration from the sign-in page", async () => {
    await setAllowRegistrations(false);
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Nobody", email: email("closed"), password: "password123" });
    expect(res.status).toBe(403);
    expect((await request(app).get("/api/health")).body.allow_registrations).toBe(false);
  });

  it("only lets an admin change the setting", async () => {
    const asMember = await request(app)
      .post("/api/settings/registrations")
      .set(auth(memberToken))
      .send({ allow_registrations: false });
    expect(asMember.status).toBe(403);
    const asAdmin = await request(app)
      .post("/api/settings/registrations")
      .set(auth(adminToken))
      .send({ allow_registrations: false });
    expect(asAdmin.status).toBe(200);
    expect(await getAllowRegistrations(true)).toBe(false);
  });
});

describe("inviting", () => {
  it("is admin-only", async () => {
    await closeRegistrationsWithSmtp();
    const res = await request(app)
      .post("/api/admin/invitations")
      .set(auth(memberToken))
      .send({ email: email("by-member") });
    expect(res.status).toBe(403);
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("refuses while registrations are open", async () => {
    await setSmtpSettings({ host: "smtp.example.test" });
    const res = await request(app)
      .post("/api/admin/invitations")
      .set(auth(adminToken))
      .send({ email: email("open") });
    expect(res.status).toBe(400);
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("refuses without SMTP", async () => {
    await setAllowRegistrations(false);
    const res = await request(app)
      .post("/api/admin/invitations")
      .set(auth(adminToken))
      .send({ email: email("no-smtp") });
    expect(res.status).toBe(400);
    expect(sendInvitation).not.toHaveBeenCalled();
  });

  it("refuses an address that already has an account", async () => {
    await closeRegistrationsWithSmtp();
    const res = await request(app)
      .post("/api/admin/invitations")
      .set(auth(adminToken))
      .send({ email: email("invite-member") });
    expect(res.status).toBe(409);
  });

  it("emails a registration link carrying the email and a token, and logs it", async () => {
    await closeRegistrationsWithSmtp();
    const invitee = email("Invitee-Case");
    const res = await request(app)
      .post("/api/admin/invitations")
      .set({ ...auth(adminToken), Origin: "https://thingport.example.test" })
      .send({ email: invitee });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(invitee.toLowerCase());

    expect(sendInvitation).toHaveBeenCalledTimes(1);
    const [to, inviterName, link] = sendInvitation.mock.calls[0];
    expect(to).toBe(invitee.toLowerCase());
    expect(inviterName).toBe("Invite Admin");
    const url = new URL(link);
    expect(url.pathname).toBe("/register");
    expect(url.searchParams.get("email")).toBe(invitee.toLowerCase());
    expect(url.searchParams.get("invite")).toMatch(/^[0-9a-f]{64}$/);

    const lookup = await request(app).get(`/api/invitations/${lastInvitationToken()}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.email).toBe(invitee.toLowerCase());

    // The log is written after the response, so wait for it.
    await vi.waitFor(async () => {
      const log = await prisma.log.findFirst({
        where: { action: "user_invited", details: { path: ["email"], equals: invitee.toLowerCase() } },
      });
      expect(log).not.toBeNull();
    });
  });

  it("leaves no invitation behind when the email can't be sent", async () => {
    await closeRegistrationsWithSmtp();
    sendInvitation.mockRejectedValueOnce(new Error("SMTP down"));
    const invitee = email("send-fails");
    const res = await request(app).post("/api/admin/invitations").set(auth(adminToken)).send({ email: invitee });
    expect(res.status).toBe(500);
    expect(await prisma.invitation.findUnique({ where: { email: invitee } })).toBeNull();
  });
});

describe("registering with an invitation", () => {
  async function invite(address: string): Promise<string> {
    await closeRegistrationsWithSmtp();
    const res = await request(app).post("/api/admin/invitations").set(auth(adminToken)).send({ email: address });
    expect(res.status).toBe(200);
    return lastInvitationToken();
  }

  it("creates a verified account while registrations are closed, and the link works only once", async () => {
    const invitee = email("accepts");
    const token = await invite(invitee);

    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Invited User", email: invitee, password: "password123", invite_token: token });
    expect(res.status).toBe(200);
    // The invitation already proved the mailbox, so no verification email.
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(invitee);
    expect(sendVerification).not.toHaveBeenCalled();
    expect(await prisma.invitation.findUnique({ where: { email: invitee } })).toBeNull();

    const again = await request(app)
      .post("/api/register")
      .send({ displayName: "Second Try", email: email("reuse"), password: "password123", invite_token: token });
    expect(again.status).toBe(400);
    expect((await request(app).get(`/api/invitations/${token}`)).status).toBe(404);
  });

  it("refuses the token for a different email", async () => {
    const token = await invite(email("owner"));
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Someone Else", email: email("not-owner"), password: "password123", invite_token: token });
    expect(res.status).toBe(400);
    expect(await prisma.user.findUnique({ where: { email: email("not-owner") } })).toBeNull();
  });

  it("refuses an unknown token", async () => {
    await closeRegistrationsWithSmtp();
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Guesser", email: email("guesser"), password: "password123", invite_token: "0".repeat(64) });
    expect(res.status).toBe(400);
  });

  it("retires the old link when an address is invited again", async () => {
    const invitee = email("reinvited");
    const firstToken = await invite(invitee);
    const secondToken = await invite(invitee);
    expect(secondToken).not.toBe(firstToken);
    expect((await request(app).get(`/api/invitations/${firstToken}`)).status).toBe(404);
    expect((await request(app).get(`/api/invitations/${secondToken}`)).status).toBe(200);
  });

  it("refuses an expired invitation", async () => {
    const invitee = email("expired");
    const token = await invite(invitee);
    await prisma.invitation.update({ where: { email: invitee }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await request(app).get(`/api/invitations/${token}`)).status).toBe(404);
    const res = await request(app)
      .post("/api/register")
      .send({ displayName: "Too Late", email: invitee, password: "password123", invite_token: token });
    expect(res.status).toBe(400);
  });
});
