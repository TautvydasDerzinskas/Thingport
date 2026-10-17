import type { OidcProvider } from "@prisma/client";
import { type Response, Router } from "express";
import { z } from "zod";
import { issueToken, requireAdmin, requireAuth, signedInRecently } from "../auth";
import { prisma } from "../db";
import { toUserOut } from "../dto";
import { createLog } from "../services/auditLog";
import { getPublicUrl } from "../services/settingsService";
import { findValidInvitation } from "../services/invitationService";
import {
  SLUG_PATTERN,
  callbackPageUrl,
  checkIssuer,
  connectIdentity,
  clearFlowCookie,
  finishFlow,
  flowCookie,
  flowIdFromCookie,
  forgetProviderConfig,
  isConnectedIdentity,
  issueLoginCode,
  matchAccount,
  matchOut,
  normalizeIssuerUrl,
  otherWaysIn,
  recordTest,
  redeemLoginCode,
  redirectUriFor,
  signInWithClaims,
  startFlow,
  takeFlow,
  testOutcome,
} from "../services/oidcService";
import { asyncHandler } from "../utils/asyncHandler";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";

// Mounted before the settings routes, whose router signs every /api request in: the sign-in ones here are public.
const router = Router();

// Read once per request here, where links back to Thingport are built; not on every /api request this router sees.
router.use(["/auth/oidc", "/profile/sign-in", "/settings/auth/oidc"], (_req, res, next) => {
  getPublicUrl().then((url) => {
    res.locals.publicUrl = url;
    next();
  }, next);
});
const publicUrlOf = (res: Response): string => res.locals.publicUrl as string;

function failSignIn(res: Response, message: string, page?: string): void {
  res.setHeader("Set-Cookie", clearFlowCookie());
  const base = publicUrlOf(res);
  res.redirect(
    303,
    page ? callbackPageUrl(base, { sso_error: message }, page) : callbackPageUrl(base, { error: message }),
  );
}

// What the test window shows once it's done; the settings page polls for the result itself.
function testDonePage(res: Response, ok: boolean): void {
  res.setHeader("Set-Cookie", clearFlowCookie());
  res
    .type("html")
    .send(
      `<!doctype html><meta charset="utf-8"><title>Thingport</title>` +
        `<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">` +
        `<p>${ok ? "Test finished." : "Test failed."} You can close this window and go back to Thingport.</p>` +
        `<script>window.close()</script>`,
    );
}

function providerRefusal(provider: OidcProvider, query: URLSearchParams): string | null {
  const refused = query.get("error");
  if (!refused) return null;
  return refused === "access_denied"
    ? `Sign-in was cancelled at ${provider.name}.`
    : `${provider.name} said no: ${query.get("error_description") || refused}`;
}

function describeFailure(provider: OidcProvider, err: unknown): string {
  if (err instanceof HttpError) return err.message;
  console.error(`[oidc] Sign-in through ${provider.name} failed:`, err);
  return `Couldn't finish signing in with ${provider.name}: ${err instanceof Error ? err.message : String(err)}`;
}

router.get(
  "/auth/oidc/:slug/start",
  asyncHandler(async (req, res) => {
    const provider = await prisma.oidcProvider.findUnique({ where: { slug: req.params.slug } });
    if (!provider?.enabled) {
      failSignIn(res, "That sign-in option isn't available any more.");
      return;
    }
    const inviteToken = typeof req.query.invite === "string" && req.query.invite ? req.query.invite : undefined;
    if (inviteToken && !(await findValidInvitation(inviteToken))) {
      failSignIn(res, "This invitation link is invalid or has expired. Ask for a new one.");
      return;
    }
    try {
      const { url, flowId } = await startFlow(provider, { kind: "sign_in", inviteToken });
      res.setHeader("Set-Cookie", flowCookie(flowId, publicUrlOf(res)));
      res.redirect(303, url);
    } catch (err) {
      failSignIn(res, err instanceof Error ? err.message : String(err));
    }
  }),
);

router.get(
  "/auth/oidc/:slug/callback",
  asyncHandler(async (req, res) => {
    const flow = takeFlow(flowIdFromCookie(req.headers.cookie));
    const provider = await prisma.oidcProvider.findUnique({ where: { slug: req.params.slug } });
    if (!flow || !provider || flow.providerId !== provider.id) {
      failSignIn(
        res,
        `This sign-in took too long, or was started in another browser or at an address other than ${publicUrlOf(res)}. Please try again.`,
      );
      return;
    }
    const query = new URLSearchParams(req.originalUrl.split("?")[1] ?? "");
    const refusal = providerRefusal(provider, query);
    const { purpose } = flow;

    if (purpose.kind === "test") {
      if (refusal) {
        recordTest(purpose.testId, { status: "done", ok: false, error: refusal });
        testDonePage(res, false);
        return;
      }
      try {
        const claims = await finishFlow(provider, flow, query);
        recordTest(purpose.testId, {
          status: "done",
          ok: true,
          claims: claims.raw,
          match: matchOut(await matchAccount(provider, claims)),
        });
        testDonePage(res, true);
      } catch (err) {
        recordTest(purpose.testId, {
          status: "done",
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
        testDonePage(res, false);
      }
      return;
    }

    // Connecting and confirming end on the profile page they started from; signing in on the sign-in page.
    const page = purpose.kind === "connect" ? "/profile" : purpose.kind === "confirm" ? purpose.next : undefined;
    if (!provider.enabled) {
      failSignIn(res, "That sign-in option isn't available any more.", page);
      return;
    }
    if (refusal) {
      failSignIn(res, refusal, page);
      return;
    }
    try {
      const claims = await finishFlow(provider, flow, query);
      if (purpose.kind === "connect") {
        await connectIdentity(provider, claims, purpose.userId);
        res.setHeader("Set-Cookie", clearFlowCookie());
        res.redirect(303, callbackPageUrl(publicUrlOf(res), { sso_connected: provider.name }, "/profile"));
        void createLog({ userId: purpose.userId, action: "sign_in_connected", details: { provider: provider.name } });
        return;
      }
      if (purpose.kind === "confirm") {
        if (!(await isConnectedIdentity(provider, claims, purpose.userId))) {
          failSignIn(res, `That isn't the ${provider.name} account connected to you here.`, page);
          return;
        }
        // A fresh session: its sign-in time is now, which is what the profile change needs.
        res.setHeader("Set-Cookie", clearFlowCookie());
        res.redirect(
          303,
          callbackPageUrl(publicUrlOf(res), { code: issueLoginCode(purpose.userId), next: purpose.next }),
        );
        return;
      }
      const invitation = purpose.inviteToken ? await findValidInvitation(purpose.inviteToken) : null;
      if (purpose.inviteToken && !invitation) {
        failSignIn(res, "This invitation link is invalid or has expired. Ask for a new one.");
        return;
      }
      const { user, created, linked } = await signInWithClaims(provider, claims, invitation);
      res.setHeader("Set-Cookie", clearFlowCookie());
      res.redirect(303, callbackPageUrl(publicUrlOf(res), { code: issueLoginCode(user.id) }));
      void createLog({
        userId: user.id,
        action: "user_logged_in",
        details: {
          email: user.email,
          provider: provider.name,
          ...(created ? { created } : {}),
          ...(linked ? { linked } : {}),
        },
      });
    } catch (err) {
      failSignIn(res, describeFailure(provider, err), page);
    }
  }),
);

router.post(
  "/auth/oidc/exchange",
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ code: z.string().min(1) }), req.body);
    const userId = redeemLoginCode(body.code);
    const user = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user) throw new HttpError(400, "This sign-in link has expired. Please sign in again.");
    const { token, expiresIn } = await issueToken(user.id, user.role);
    res.json({ token, expires_in: expiresIn, user: toUserOut(user) });
  }),
);

// The signed-in user's side: their password and the providers they've connected.

// Where a confirm round trip may come back to: the profile pages that ask for it.
const CONFIRM_PAGES = ["/profile/password", "/profile/email"] as const;

router.get(
  "/profile/sign-in",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { passwordHash: true, identities: true },
    });
    if (!user) throw new HttpError(401, "Invalid or expired token");
    // Providers that are on, and any that are off but still connected, so those can be disconnected.
    const providers = await prisma.oidcProvider.findMany({
      where: { OR: [{ enabled: true }, { identities: { some: { userId: req.userId! } } }] },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    res.json({
      has_password: Boolean(user.passwordHash),
      signed_in_recently: signedInRecently(req),
      // Connecting needs the provider to send people back here.
      can_connect: Boolean(publicUrlOf(res)),
      providers: providers.map((provider) => {
        const identity = user.identities.find((each) => each.providerId === provider.id);
        return {
          slug: provider.slug,
          name: provider.name,
          enabled: provider.enabled,
          connection: identity
            ? {
                id: identity.id,
                email: identity.email,
                connected_at: identity.createdAt,
                last_used_at: identity.lastUsedAt,
              }
            : null,
        };
      }),
    });
  }),
);

async function enabledProvider(slug: string): Promise<OidcProvider> {
  const provider = await prisma.oidcProvider.findUnique({ where: { slug } });
  if (!provider?.enabled) throw new HttpError(404, "That sign-in option isn't available any more.");
  return provider;
}

router.post(
  "/profile/sign-in/:slug/connect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const provider = await enabledProvider(req.params.slug);
    const { url, flowId } = await startFlow(provider, { kind: "connect", userId: req.userId! });
    res.setHeader("Set-Cookie", flowCookie(flowId, publicUrlOf(res)));
    res.json({ url });
  }),
);

router.post(
  "/profile/sign-in/:slug/confirm",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ next: z.enum(CONFIRM_PAGES) }), req.body);
    const provider = await enabledProvider(req.params.slug);
    const connected = await prisma.userIdentity.findFirst({ where: { providerId: provider.id, userId: req.userId! } });
    if (!connected) throw new HttpError(400, `You haven't connected ${provider.name}.`);
    const { url, flowId } = await startFlow(provider, { kind: "confirm", userId: req.userId!, next: body.next });
    res.setHeader("Set-Cookie", flowCookie(flowId, publicUrlOf(res)));
    res.json({ url });
  }),
);

router.delete(
  "/profile/sign-in/connections/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const identity = await prisma.userIdentity.findFirst({
      where: { id: req.params.id, userId: req.userId! },
      include: { provider: { select: { name: true } } },
    });
    if (!identity) throw new HttpError(404, "Connection not found");
    if ((await otherWaysIn(req.userId!, identity.id)) === 0) {
      throw new HttpError(
        409,
        `${identity.provider.name} is your only way to sign in. Set a password or connect another provider first.`,
        "LAST_SIGN_IN_METHOD",
      );
    }
    await prisma.userIdentity.delete({ where: { id: identity.id } });
    res.status(204).end();
    void createLog({
      userId: req.userId!,
      action: "sign_in_disconnected",
      details: { provider: identity.provider.name },
    });
  }),
);

// The admin's side: the providers, and a test that shows what one sends without signing anybody in.

function providerOut(provider: OidcProvider & { _count?: { identities: number } }, publicUrl: string) {
  return {
    id: provider.id,
    slug: provider.slug,
    name: provider.name,
    issuer_url: provider.issuerUrl,
    client_id: provider.clientId,
    has_client_secret: Boolean(provider.clientSecret),
    scopes: provider.scopes,
    enabled: provider.enabled,
    create_accounts: provider.createAccounts,
    link_by_email: provider.linkByEmail,
    redirect_uri: redirectUriFor(publicUrl, provider.slug),
    user_count: provider._count?.identities ?? 0,
  };
}

async function listOut(publicUrl: string) {
  const providers = await prisma.oidcProvider.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { identities: true } } },
  });
  return { public_url: publicUrl || null, providers: providers.map((provider) => providerOut(provider, publicUrl)) };
}

const providerFields = {
  name: z.string().trim().min(1, "Give it a name").max(60),
  issuer_url: z.string().trim().min(1, "Enter the issuer URL").max(500),
  client_id: z.string().trim().min(1, "Enter the client ID").max(500),
  // Omitted keeps the saved one; null or "" means none (a public client).
  client_secret: z.string().max(2000).nullable().optional(),
  scopes: z
    .string()
    .trim()
    .max(500)
    .refine((scopes) => scopes.split(/\s+/).includes("openid"), 'Scopes must include "openid"'),
  enabled: z.boolean(),
  create_accounts: z.boolean(),
  link_by_email: z.boolean(),
};

function slugFrom(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "sso"
  );
}

const createSchema = z
  .object({
    ...providerFields,
    slug: z.string().trim().toLowerCase().regex(SLUG_PATTERN, "Use lowercase letters, digits and dashes").optional(),
    scopes: providerFields.scopes.optional(),
    enabled: providerFields.enabled.optional(),
    create_accounts: providerFields.create_accounts.optional(),
    link_by_email: providerFields.link_by_email.optional(),
  })
  .strict();

router.get(
  "/settings/auth/oidc",
  requireAuth,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await listOut(publicUrlOf(res)));
  }),
);

router.post(
  "/settings/auth/oidc/check",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ issuer_url: z.string().trim().min(1).max(500) }), req.body);
    res.json(await checkIssuer(body.issuer_url));
  }),
);

router.post(
  "/settings/auth/oidc/providers",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req.body);
    const slug = body.slug ?? slugFrom(body.name);
    if (await prisma.oidcProvider.findUnique({ where: { slug } })) {
      throw new HttpError(409, `Another provider already uses "${slug}" in its address. Pick a different one.`);
    }
    const last = await prisma.oidcProvider.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
    const created = await prisma.oidcProvider.create({
      data: {
        slug,
        name: body.name,
        issuerUrl: normalizeIssuerUrl(body.issuer_url),
        clientId: body.client_id,
        clientSecret: body.client_secret || null,
        ...(body.scopes ? { scopes: body.scopes.split(/\s+/).join(" ") } : {}),
        enabled: body.enabled ?? true,
        createAccounts: body.create_accounts ?? false,
        linkByEmail: body.link_by_email ?? false,
        position: (last?.position ?? -1) + 1,
      },
    });
    res.status(201).json(providerOut(created, publicUrlOf(res)));
  }),
);

const updateSchema = z.object(providerFields).partial().strict();
router.patch(
  "/settings/auth/oidc/providers/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(updateSchema, req.body);
    const existing = await prisma.oidcProvider.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new HttpError(404, "Provider not found");
    const updated = await prisma.oidcProvider.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.issuer_url !== undefined ? { issuerUrl: normalizeIssuerUrl(body.issuer_url) } : {}),
        ...(body.client_id !== undefined ? { clientId: body.client_id } : {}),
        ...(body.client_secret !== undefined ? { clientSecret: body.client_secret || null } : {}),
        ...(body.scopes !== undefined ? { scopes: body.scopes.split(/\s+/).join(" ") } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.create_accounts !== undefined ? { createAccounts: body.create_accounts } : {}),
        ...(body.link_by_email !== undefined ? { linkByEmail: body.link_by_email } : {}),
      },
      include: { _count: { select: { identities: true } } },
    });
    forgetProviderConfig(updated.id);
    res.json(providerOut(updated, publicUrlOf(res)));
  }),
);

router.delete(
  "/settings/auth/oidc/providers/:id",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const deleted = await prisma.oidcProvider.deleteMany({ where: { id: req.params.id } });
    if (!deleted.count) throw new HttpError(404, "Provider not found");
    forgetProviderConfig(req.params.id);
    res.status(204).end();
  }),
);

router.post(
  "/settings/auth/oidc/providers/:id/test",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const provider = await prisma.oidcProvider.findUnique({ where: { id: req.params.id } });
    if (!provider) throw new HttpError(404, "Provider not found");
    const { url, flowId, testId } = await startFlow(provider, { kind: "test", adminId: req.userId! });
    res.setHeader("Set-Cookie", flowCookie(flowId, publicUrlOf(res)));
    res.json({ url, test_id: testId });
  }),
);

router.get(
  "/settings/auth/oidc/tests/:testId",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const outcome = testOutcome(req.params.testId, req.userId!);
    if (!outcome) throw new HttpError(404, "This test has expired. Run it again.");
    res.json(outcome);
  }),
);

export default router;
