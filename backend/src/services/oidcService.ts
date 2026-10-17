import crypto from "node:crypto";
import * as oidc from "openid-client";
import type { Invitation, OidcProvider, User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { seedDefaultCategories } from "./categoryService";
import { getPublicUrl } from "./settingsService";

// Sign-in through OpenID Connect providers (Authentik, PocketID, ...): the authorization code flow with PKCE,
// state and nonce. It ends in the same Thingport session a password sign-in gets.

const FLOW_TTL_MS = 10 * 60 * 1000;
const LOGIN_CODE_TTL_MS = 60 * 1000;
const TEST_TTL_MS = 15 * 60 * 1000;
const CONFIG_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TIMEOUT_S = 10;

export const FLOW_COOKIE = "thingport_oidc";
export const FLOW_COOKIE_PATH = "/api/auth/oidc";

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Where the provider sends people back to; null until the public URL says where Thingport is. */
export function redirectUriFor(publicUrl: string, slug: string): string | null {
  return publicUrl ? `${publicUrl}/api/auth/oidc/${slug}/callback` : null;
}

/** The page that finishes a sign-in in the browser, with what happened in its #fragment. */
export function callbackPageUrl(publicUrl: string, fragment: Record<string, string>, page = "/oidc-callback"): string {
  return `${publicUrl}${page}#${new URLSearchParams(fragment).toString()}`;
}

export function normalizeIssuerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/\.well-known\/openid-configuration\/?$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(400, "Enter the provider's issuer URL, e.g. https://auth.example.com/application/o/thingport/");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "The issuer URL must start with https:// or http://");
  }
  return trimmed;
}

// Self-hosted providers on a home network often have no TLS; the provider still checks the redirect URI.
function allowHttp(issuer: URL): Array<(config: oidc.Configuration) => void> {
  return issuer.protocol === "http:" ? [oidc.allowInsecureRequests] : [];
}

/** The provider's discovery document, to check an issuer URL before it's saved. */
export async function checkIssuer(
  issuerUrl: string,
): Promise<{ ok: true; issuer: string } | { ok: false; error: string }> {
  try {
    const issuer = new URL(normalizeIssuerUrl(issuerUrl));
    const config = await oidc.discovery(issuer, "thingport-check", undefined, oidc.None(), {
      execute: allowHttp(issuer),
      timeout: DISCOVERY_TIMEOUT_S,
    });
    return { ok: true, issuer: config.serverMetadata().issuer };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

function describeError(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : "";
  return err instanceof Error ? `${err.message}${cause}` : String(err);
}

// A provider's discovery document and keys, fetched once and kept while its settings are unchanged.
const configs = new Map<string, { version: number; at: number; config: Promise<oidc.Configuration> }>();

async function discover(provider: OidcProvider): Promise<oidc.Configuration> {
  const issuer = new URL(provider.issuerUrl);
  const execute = allowHttp(issuer);
  const found = await oidc.discovery(issuer, provider.clientId, undefined, oidc.None(), {
    execute,
    timeout: DISCOVERY_TIMEOUT_S,
  });
  const metadata = found.serverMetadata();
  // Basic is the spec's default; some providers only take the secret in the form.
  const methods = metadata.token_endpoint_auth_methods_supported;
  const auth = !provider.clientSecret
    ? oidc.None()
    : !methods || methods.includes("client_secret_basic")
      ? oidc.ClientSecretBasic(provider.clientSecret)
      : oidc.ClientSecretPost(provider.clientSecret);
  const config = new oidc.Configuration(metadata, provider.clientId, undefined, auth);
  for (const run of execute) run(config);
  config.timeout = DISCOVERY_TIMEOUT_S;
  return config;
}

function configFor(provider: OidcProvider): Promise<oidc.Configuration> {
  const version = provider.updatedAt.getTime();
  const cached = configs.get(provider.id);
  if (cached && cached.version === version && Date.now() - cached.at < CONFIG_TTL_MS) return cached.config;
  const config = discover(provider);
  configs.set(provider.id, { version, at: Date.now(), config });
  // A failed fetch isn't kept, so the next sign-in tries again.
  config.catch(() => {
    if (configs.get(provider.id)?.config === config) configs.delete(provider.id);
  });
  return config;
}

export function forgetProviderConfig(providerId: string): void {
  configs.delete(providerId);
}

// What a sign-in started in this browser needs at the callback. Kept in memory: a restart only means
// starting again, and the cookie that names the flow ties it to the browser that started it.
type Flow = {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: number;
  purpose: FlowPurpose;
};
/** What the round trip is for, which decides what the callback does with who came back. */
export type FlowPurpose =
  /** Signing in, maybe accepting an invitation on the way. */
  | { kind: "sign_in"; inviteToken?: string }
  /** An admin's test: shows what the provider sends and signs nobody in. */
  | { kind: "test"; testId: string }
  /** A signed-in user adding this provider as a way to sign in. */
  | { kind: "connect"; userId: string }
  /** A signed-in user proving it's still them, to set a password or change email; then back to `next`. */
  | { kind: "confirm"; userId: string; next: string };
type PurposeRequest =
  | { kind: "sign_in"; inviteToken?: string }
  | { kind: "test"; adminId: string }
  | { kind: "connect"; userId: string }
  | { kind: "confirm"; userId: string; next: string };
const flows = new Map<string, Flow>();
const loginCodes = new Map<string, { userId: string; expiresAt: number }>();

export type TestOutcome =
  | { status: "waiting" }
  | { status: "done"; ok: true; claims: Record<string, unknown>; match: AccountMatchOut }
  | { status: "done"; ok: false; error: string };
const tests = new Map<string, { adminId: string; providerId: string; expiresAt: number; outcome: TestOutcome }>();

function prune(): void {
  const now = Date.now();
  for (const [key, flow] of flows) if (flow.expiresAt < now) flows.delete(key);
  for (const [key, code] of loginCodes) if (code.expiresAt < now) loginCodes.delete(key);
  for (const [key, test] of tests) if (test.expiresAt < now) tests.delete(key);
}

/** Begins a round trip to the provider: returns its URL and the cookie naming the flow. */
export async function startFlow(
  provider: OidcProvider,
  request: PurposeRequest = { kind: "sign_in" },
): Promise<{ url: string; flowId: string; testId?: string }> {
  prune();
  const redirectUri = redirectUriFor(await getPublicUrl(), provider.slug);
  if (!redirectUri) {
    throw new HttpError(503, "Single sign-on needs Thingport's public URL set (Admin > Auth).");
  }
  let config: oidc.Configuration;
  try {
    config = await configFor(provider);
  } catch (err) {
    throw new HttpError(502, `Couldn't reach ${provider.name}: ${describeError(err)}`);
  }
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: provider.scopes,
    response_type: "code",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const flowId = crypto.randomBytes(24).toString("base64url");
  const testId = request.kind === "test" ? crypto.randomBytes(16).toString("hex") : undefined;
  const purpose: FlowPurpose = request.kind === "test" ? { kind: "test", testId: testId! } : request;
  flows.set(flowId, {
    providerId: provider.id,
    state,
    nonce,
    codeVerifier,
    redirectUri,
    expiresAt: Date.now() + FLOW_TTL_MS,
    purpose,
  });
  if (request.kind === "test" && testId) {
    tests.set(testId, {
      adminId: request.adminId,
      providerId: provider.id,
      expiresAt: Date.now() + TEST_TTL_MS,
      outcome: { status: "waiting" },
    });
  }
  return { url: url.href, flowId, testId };
}

/** Takes the flow out, so a callback can only be used once. */
export function takeFlow(flowId: string | undefined): Flow | null {
  prune();
  if (!flowId) return null;
  const flow = flows.get(flowId) ?? null;
  flows.delete(flowId);
  return flow;
}

export type Claims = {
  sub: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  raw: Record<string, unknown>;
};

/** Trades the code the provider sent back for the person's verified claims. */
export async function finishFlow(provider: OidcProvider, flow: Flow, query: URLSearchParams): Promise<Claims> {
  const config = await configFor(provider);
  const currentUrl = new URL(flow.redirectUri);
  currentUrl.search = query.toString();
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  let raw: Record<string, unknown> = { ...tokens.claims() };
  // Some providers only put the email in userinfo.
  if (typeof raw.email !== "string" && tokens.access_token && config.serverMetadata().userinfo_endpoint) {
    try {
      const info = await oidc.fetchUserInfo(config, tokens.access_token, String(raw.sub));
      raw = { ...info, ...raw, email: info.email, email_verified: info.email_verified };
    } catch {
      // The ID token alone still identifies them.
    }
  }
  return claimsFrom(raw);
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

export function claimsFrom(raw: Record<string, unknown>): Claims {
  return {
    sub: String(raw.sub),
    email: text(raw.email)?.toLowerCase(),
    // Some providers send it as a string.
    emailVerified: raw.email_verified === true || raw.email_verified === "true",
    name: text(raw.name) ?? text(raw.preferred_username) ?? text(raw.given_name) ?? text(raw.nickname),
    raw,
  };
}

export type AccountMatch =
  | { action: "sign_in"; user: User }
  | { action: "link"; user: User }
  | { action: "create"; email: string; displayName: string; invitationId?: string }
  | { action: "refuse"; reason: string };
export type AccountMatchOut =
  | { action: "sign_in" | "link"; user: { id: string; email: string; display_name: string } }
  | { action: "create"; email: string; display_name: string }
  | { action: "refuse"; reason: string };

/** Who these claims sign in as, without changing anything: the same answer the admin's test shows. An invitation
 *  lets someone in whom the provider alone wouldn't create an account for. */
export async function matchAccount(
  provider: OidcProvider,
  claims: Claims,
  invitation: Invitation | null = null,
): Promise<AccountMatch> {
  const identity = await prisma.userIdentity.findUnique({
    where: { providerId_subject: { providerId: provider.id, subject: claims.sub } },
    include: { user: true },
  });
  if (identity) return { action: "sign_in", user: identity.user };

  const sameEmail = claims.email ? await prisma.user.findUnique({ where: { email: claims.email } }) : null;
  if (invitation && !sameEmail) {
    // The invitation is for one address; joining through a provider account with another would hand it on.
    if (claims.email !== invitation.email) {
      return {
        action: "refuse",
        reason: claims.email
          ? `This invitation is for ${invitation.email}, but ${provider.name} signed you in as ${claims.email}. Sign in to ${provider.name} with the invited address, or register with a password instead.`
          : `This invitation is for ${invitation.email}, but ${provider.name} didn't share an email address. Register with a password instead.`,
      };
    }
    return {
      action: "create",
      email: invitation.email,
      displayName: claims.name ?? invitation.email.split("@")[0],
      invitationId: invitation.id,
    };
  }
  if (sameEmail) {
    if (provider.linkByEmail && claims.emailVerified) return { action: "link", user: sameEmail };
    return {
      action: "refuse",
      reason: provider.linkByEmail
        ? `Thingport already has an account with ${claims.email}, but ${provider.name} hasn't verified that address, so it can't be linked. Sign in with your password instead.`
        : `Thingport already has an account with ${claims.email}. Sign in with your password instead, or ask your admin to let ${provider.name} sign in to existing accounts.`,
    };
  }
  if (!provider.createAccounts) {
    return {
      action: "refuse",
      reason: `There's no Thingport account for your ${provider.name} account. Ask your admin for access.`,
    };
  }
  if (!claims.email) {
    return {
      action: "refuse",
      reason: `${provider.name} didn't share an email address, which a new Thingport account needs. Make sure the "email" scope is allowed.`,
    };
  }
  return {
    action: "create",
    email: claims.email,
    displayName: claims.name ?? claims.email.split("@")[0],
  };
}

export function matchOut(match: AccountMatch): AccountMatchOut {
  if (match.action === "sign_in" || match.action === "link") {
    return {
      action: match.action,
      user: { id: match.user.id, email: match.user.email, display_name: match.user.displayName },
    };
  }
  if (match.action === "create") return { action: "create", email: match.email, display_name: match.displayName };
  return match;
}

/** Signs the claims in: links or creates the account as matchAccount said. Refusals throw, to show the person. */
export async function signInWithClaims(
  provider: OidcProvider,
  claims: Claims,
  invitation: Invitation | null = null,
): Promise<{ user: User; created: boolean; linked: boolean }> {
  const match = await matchAccount(provider, claims, invitation);
  if (match.action === "refuse") throw new HttpError(403, match.reason);
  const identityData = { providerId: provider.id, subject: claims.sub, email: claims.email ?? null };
  if (match.action === "sign_in") {
    await prisma.userIdentity.update({
      where: { providerId_subject: { providerId: provider.id, subject: claims.sub } },
      data: { email: claims.email ?? null, lastUsedAt: new Date() },
    });
    return { user: match.user, created: false, linked: false };
  }
  try {
    if (match.action === "link") {
      await prisma.userIdentity.create({ data: { ...identityData, userId: match.user.id, lastUsedAt: new Date() } });
      return { user: match.user, created: false, linked: true };
    }
    const user = await prisma.$transaction(
      async (tx) => {
        const created = await tx.user.create({
          data: {
            email: match.email,
            passwordHash: null,
            displayName: match.displayName,
            role: "MEMBER",
            // The provider vouches for them; Thingport's own check is for password sign-ups.
            emailVerified: true,
          },
        });
        await seedDefaultCategories(tx, created.id);
        await tx.userIdentity.create({ data: { ...identityData, userId: created.id, lastUsedAt: new Date() } });
        if (match.invitationId) await tx.invitation.deleteMany({ where: { id: match.invitationId } });
        return created;
      },
      { timeout: 15000 },
    );
    return { user, created: true, linked: false };
  } catch (err) {
    // Two callbacks for the same person at once: the other one got there first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await matchAccount(provider, claims);
      if (again.action === "sign_in") return { user: again.user, created: false, linked: false };
    }
    throw err;
  }
}

/** Adds this provider account as a way for `userId` to sign in. Refusals throw, to show the person. */
export async function connectIdentity(provider: OidcProvider, claims: Claims, userId: string): Promise<void> {
  const taken = await prisma.userIdentity.findUnique({
    where: { providerId_subject: { providerId: provider.id, subject: claims.sub } },
  });
  if (taken?.userId === userId) return;
  if (taken) {
    throw new HttpError(409, `This ${provider.name} account is already connected to another Thingport account.`);
  }
  const existing = await prisma.userIdentity.findFirst({ where: { providerId: provider.id, userId } });
  if (existing) {
    throw new HttpError(
      409,
      `You're already connected to ${provider.name}${existing.email ? ` as ${existing.email}` : ""}. Disconnect it first to connect a different account.`,
    );
  }
  await prisma.userIdentity.create({
    data: { providerId: provider.id, subject: claims.sub, email: claims.email ?? null, userId, lastUsedAt: new Date() },
  });
}

/** Whether these claims are the provider account `userId` connected: confirming it's them. */
export async function isConnectedIdentity(provider: OidcProvider, claims: Claims, userId: string): Promise<boolean> {
  const identity = await prisma.userIdentity.findUnique({
    where: { providerId_subject: { providerId: provider.id, subject: claims.sub } },
  });
  if (identity?.userId !== userId) return false;
  await prisma.userIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date() } });
  return true;
}

/** Ways the user can still sign in without this connection: their password, and providers still on. */
export async function otherWaysIn(userId: string, exceptIdentityId: string): Promise<number> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  const others = await prisma.userIdentity.count({
    where: { userId, id: { not: exceptIdentityId }, provider: { enabled: true } },
  });
  return (user?.passwordHash ? 1 : 0) + others;
}

/** A short-lived, single-use code the browser trades for a session, so the session never sits in a URL. */
export function issueLoginCode(userId: string): string {
  prune();
  const code = crypto.randomBytes(32).toString("base64url");
  loginCodes.set(code, { userId, expiresAt: Date.now() + LOGIN_CODE_TTL_MS });
  return code;
}

export function redeemLoginCode(code: string): string | null {
  prune();
  const entry = loginCodes.get(code);
  loginCodes.delete(code);
  return entry ? entry.userId : null;
}

export function recordTest(testId: string, outcome: TestOutcome): void {
  const test = tests.get(testId);
  if (test) test.outcome = outcome;
}

export function testOutcome(testId: string, adminId: string): TestOutcome | null {
  prune();
  const test = tests.get(testId);
  return test && test.adminId === adminId ? test.outcome : null;
}

/** Reads the flow cookie from a request's Cookie header. */
export function flowIdFromCookie(header: string | undefined): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === FLOW_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function flowCookie(flowId: string, publicUrl: string): string {
  const secure = publicUrl.startsWith("https://") ? "; Secure" : "";
  // Lax: sent on the top-level redirect back from the provider, not on requests other sites make.
  return `${FLOW_COOKIE}=${encodeURIComponent(flowId)}; Path=${FLOW_COOKIE_PATH}; Max-Age=${FLOW_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`;
}

export function clearFlowCookie(): string {
  return `${FLOW_COOKIE}=; Path=${FLOW_COOKIE_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export async function enabledProvidersForSignIn(): Promise<Array<{ slug: string; name: string }>> {
  if (!(await getPublicUrl())) return [];
  const providers = await prisma.oidcProvider.findMany({
    where: { enabled: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { slug: true, name: true },
  });
  return providers;
}
