import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getAllowRegistrations,
  getAuthTokenTtl,
  getPreviewMode,
  getSmtpSettings,
  getThingiverseAccessToken,
  setAllowRegistrations,
  setAuthTokenTtl,
  setPreviewMode,
  setSmtpSettings,
  setThingiverseAccessToken,
  type SmtpSettings,
} from "../services/settingsService";
import { getDatabaseInfo, testAndSwitchDatabase } from "../services/databaseSettingsService";
import {
  DEFAULT_STORAGE_TEMPLATE,
  STORAGE_TEMPLATE_TOKENS,
  getStorageTemplate,
  reorganizeManagedPrints,
  samplePlateStoragePaths,
  setStorageTemplate,
  validateStorageTemplate,
} from "../services/printService";
import { getUserMakerworldCookie, setUserMakerworldCookie } from "../services/makerworldCookieService";
import { type MakerworldCookieCheck, verifyMakerworldCookie } from "../services/makerworldCloudApi";
import { verifyThingiverseAccessToken } from "../services/thingiverseApi";
import { SLICER_IDS, getUserSlicer, setUserSlicer } from "../services/slicerPreferenceService";
import { THEME_SELECTIONS, getUserTheme, setUserTheme } from "../services/themePreferenceService";
import { getUserAuthorPreviewEnabled, setUserAuthorPreviewEnabled } from "../services/authorPreviewPreferenceService";
import { checkForUpdates } from "../services/versionService";

const router = Router();
router.use(requireAuth);

function storageSettingsOut(template: string, moved = 0, skipped = 0) {
  return {
    template,
    default_template: DEFAULT_STORAGE_TEMPLATE,
    allowed_tokens: [...STORAGE_TEMPLATE_TOKENS],
    plate_paths: samplePlateStoragePaths(template),
    moved,
    skipped,
  };
}

// Admin-only, read-only -- queries GitHub for the latest commit touching backend/ and frontend/
// on main and compares each against this backend's own baked-in build commit (see
// versionService.ts for why raw main HEAD isn't the right comparison). Frontend compares its own
// baked commit (VITE_GIT_SHA, embedded at build time) against latest_frontend_sha itself; the
// backend doesn't know what commit served the calling browser's bundle.
router.get(
  "/settings/version-check",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await checkForUpdates());
  }),
);

// Admin-only end to end now: the storage template affects every user's files, and the only UI
// that reads this lives in the admin settings panel.
router.get(
  "/settings/storage",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const template = validateStorageTemplate(await getStorageTemplate());
    res.json(storageSettingsOut(template));
  }),
);

// Instance-wide: reorganizing "apply to existing" walks and relocates every user's files, not
// just the caller's, so this is admin-only.
const storageSettingsSchema = z.object({ template: z.string(), apply_existing: z.boolean().default(false) });
router.post(
  "/settings/storage",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(storageSettingsSchema, req.body);
    const template = validateStorageTemplate(body.template);
    await setStorageTemplate(template);
    const { moved, skipped } = body.apply_existing ? await reorganizeManagedPrints(template) : { moved: 0, skipped: 0 };
    res.json(storageSettingsOut(template, moved, skipped));
  }),
);

router.get(
  "/settings/registrations",
  asyncHandler(async (_req, res) => {
    res.json({ allow_registrations: await getAllowRegistrations(true) });
  }),
);

// No admin UI calls this yet -- added now so the "admin panel later" plan has a working
// endpoint to build against without another backend change.
const registrationsSchema = z.object({ allow_registrations: z.boolean() });
router.post(
  "/settings/registrations",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(registrationsSchema, req.body);
    await setAllowRegistrations(body.allow_registrations);
    res.json({ allow_registrations: body.allow_registrations });
  }),
);

// Admin-only both ways, like Storage above -- this affects every session on the instance
// (including whoever's editing it), not just the caller's own login.
router.get(
  "/settings/auth",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ token_ttl_seconds: await getAuthTokenTtl() });
  }),
);

// 5 minutes to 1 year -- wide enough to cover any real deployment, narrow enough that a typo
// (e.g. an extra zero) still lands somewhere sane instead of "never expires" or "expires
// immediately". Only affects tokens issued *after* saving -- see auth.ts's issueToken.
const MIN_AUTH_TOKEN_TTL_SECONDS = 5 * 60;
const MAX_AUTH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const authSettingsSchema = z.object({
  token_ttl_seconds: z.number().int().min(MIN_AUTH_TOKEN_TTL_SECONDS).max(MAX_AUTH_TOKEN_TTL_SECONDS),
});
router.patch(
  "/settings/auth",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(authSettingsSchema, req.body);
    await setAuthTokenTtl(body.token_ttl_seconds);
    res.json({ token_ttl_seconds: body.token_ttl_seconds });
  }),
);

// Read is open to every user -- LibraryPage needs the current mode to know whether to generate
// previews at all. Only admins can change it (see getPreviewMode's instance-wide rationale).
router.get(
  "/settings/previews",
  asyncHandler(async (_req, res) => {
    res.json({ mode: await getPreviewMode() });
  }),
);

const previewsSchema = z.object({ mode: z.enum(["automatic", "on-demand", "disabled"]) });
router.post(
  "/settings/previews",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(previewsSchema, req.body);
    await setPreviewMode(body.mode);
    res.json({ mode: body.mode });
  }),
);

// Read is open to every user -- UserMenu's Thingiverse connection chip needs to know whether
// imports will actually work, same as /settings/previews above. Only admins can change it: the
// token is a shared credential for the whole instance's Thingiverse imports, not a per-user
// preference. GET never echoes the token itself back (write-only, like any other API secret) --
// only whether one is currently configured, so the admin UI can show "configured" / "not
// configured" without re-displaying the value.
router.get(
  "/settings/thingiverse",
  asyncHandler(async (_req, res) => {
    res.json({ configured: Boolean(await getThingiverseAccessToken()) });
  }),
);

const thingiverseSettingsSchema = z.object({ access_token: z.string().nullable() });
router.post(
  "/settings/thingiverse",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(thingiverseSettingsSchema, req.body);
    const trimmed = (body.access_token ?? "").trim();
    // Only a new, non-empty token needs testing -- clearing it always succeeds, since there's
    // nothing to verify a logged-out state against.
    if (trimmed && !(await verifyThingiverseAccessToken(trimmed))) {
      throw new HttpError(
        422,
        "Couldn't verify this Thingiverse Access Token -- it may be invalid, revoked, or Thingiverse is rate-limiting this instance right now. Double-check the token at thingiverse.com/apps/create and try again.",
      );
    }
    await setThingiverseAccessToken(body.access_token);
    res.json({ configured: Boolean(trimmed) });
  }),
);

// Admin-only "Connections" page: SMTP (editable, used by registration's email-verification flow
// -- see routes/auth.ts) and Database (editable "Test & Save", see databaseSettingsService.ts).

function smtpSettingsOut(smtp: SmtpSettings) {
  // pass is never echoed back, same write-only convention as the Thingiverse token above.
  return { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, from: smtp.from, configured: Boolean(smtp.host) };
}

router.get(
  "/settings/smtp",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(smtpSettingsOut(await getSmtpSettings()));
  }),
);

const smtpSettingsSchema = z.object({
  host: z.string().nullable().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().nullable().optional(),
  // Omitted entirely (not just empty-string) means "keep the current password" -- the frontend
  // only ever sends this key when the admin actually typed a new one.
  pass: z.string().nullable().optional(),
  from: z.string().optional(),
});
router.patch(
  "/settings/smtp",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(smtpSettingsSchema, req.body);
    const patch: Partial<SmtpSettings> = {};
    if (body.host !== undefined) patch.host = body.host?.trim() || null;
    if (body.port !== undefined) patch.port = body.port;
    if (body.secure !== undefined) patch.secure = body.secure;
    if (body.user !== undefined) patch.user = body.user?.trim() || null;
    if (body.pass !== undefined) patch.pass = body.pass?.trim() || null;
    if (body.from?.trim()) patch.from = body.from.trim();
    const next = await setSmtpSettings(patch);
    res.json(smtpSettingsOut(next));
  }),
);

router.get(
  "/settings/database",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(getDatabaseInfo());
  }),
);

// "Test & Save": connects with the candidate credentials and runs a sanity query *before*
// touching anything live -- on failure the app keeps running against whatever database it's
// currently on, same as before the request. Only on success does it hot-swap every `prisma.*`
// call in this process over to the new database. See databaseSettingsService.ts for why this
// does NOT persist across a restart -- host/port can't be changed here either, only
// database/user/password on the same Postgres server this process was started against.
const databaseSettingsSchema = z.object({
  database: z.string().trim().min(1, "Database name is required"),
  user: z.string().trim().min(1, "User is required"),
  password: z.string().min(1, "Password is required"),
});
router.post(
  "/settings/database",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(databaseSettingsSchema, req.body);
    let info;
    try {
      info = await testAndSwitchDatabase(body);
    } catch (err) {
      throw new HttpError(422, err instanceof Error ? err.message : "Failed to connect to that database.");
    }
    res.json(info);
  }),
);

// Per-user, not admin-only: each user brings their own MakerWorld login for their own imports
// (see services/makerworldCookieService.ts), unlike the instance-wide Thingiverse token above.
// Write-only like the other credentials here -- GET only ever reports whether one is set.
router.get(
  "/settings/makerworld",
  asyncHandler(async (req, res) => {
    res.json({ configured: Boolean(await getUserMakerworldCookie(req.userId!)) });
  }),
);

// `verify` is opt-in (defaults off) rather than always-on: this same endpoint also gets a
// best-effort background PATCH from the Chrome extension (extension/background.js,
// maybeSyncMakerworldCookie) piggybacking a live-captured browser cookie onto an import request
// -- that path already knows the cookie just worked (it came straight from an active MakerWorld
// tab) and deliberately swallows failures, so adding a live network test there would only add
// latency for no benefit. Only ProfilePage's manual Save (settingsApi.updateMakerworld) sends
// `verify: true`.
const MAKERWORLD_UNVERIFIABLE_MESSAGES: Record<
  Extract<MakerworldCookieCheck, { result: "unverifiable" }>["reason"],
  string
> = {
  cloudflare_no_flaresolverr:
    "Couldn't check this cookie: MakerWorld's Cloudflare protection blocked the request and FlareSolverr isn't configured. Set FLARESOLVERR_URL and try again.",
  flaresolverr_failed:
    "Couldn't check this cookie: MakerWorld's Cloudflare protection blocked the request and FlareSolverr didn't get past it. Make sure FlareSolverr is running and reachable at FLARESOLVERR_URL, then try again.",
  network: "Couldn't check this cookie: MakerWorld didn't respond. Check this server's internet connection and try again.",
};

const makerworldSettingsSchema = z.object({ cookie: z.string().nullable(), verify: z.boolean().optional() });
router.patch(
  "/settings/makerworld",
  asyncHandler(async (req, res) => {
    const body = parseBody(makerworldSettingsSchema, req.body);
    const trimmed = (body.cookie ?? "").trim();
    // Only a new, non-empty cookie needs testing -- clearing it (trimmed === "") always
    // succeeds, since there's nothing to verify a logged-out state against.
    if (body.verify && trimmed) {
      const check = await verifyMakerworldCookie(trimmed);
      if (check.result === "invalid") {
        throw new HttpError(
          422,
          "MakerWorld rejected this cookie -- it may be invalid or expired. Copy a fresh Cookie header from a logged-in makerworld.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the cookie, the check itself couldn't run.
      if (check.result === "unverifiable") throw new HttpError(503, MAKERWORLD_UNVERIFIABLE_MESSAGES[check.reason]);
    }
    const configured = await setUserMakerworldCookie(req.userId!, body.cookie);
    res.json({ configured });
  }),
);

// Per-user preferred slicer, for a future "open in {slicer}" launch via that slicer's own URL
// protocol -- see services/slicerPreferenceService.ts. Not a secret, so unlike the credentials
// above this echoes the value back plainly.
router.get(
  "/settings/slicer",
  asyncHandler(async (req, res) => {
    res.json({ slicer: await getUserSlicer(req.userId!) });
  }),
);

const slicerSettingsSchema = z.object({ slicer: z.enum(SLICER_IDS).nullable() });
router.patch(
  "/settings/slicer",
  asyncHandler(async (req, res) => {
    const body = parseBody(slicerSettingsSchema, req.body);
    const slicer = await setUserSlicer(req.userId!, body.slicer);
    res.json({ slicer });
  }),
);

// Per-user theme (light/dark/system), server-persisted so it follows the account across
// devices/browsers instead of being stuck in one browser's localStorage -- see
// services/themePreferenceService.ts. Not a secret, so like slicer above this echoes the value
// back plainly. Null means "never set"; the frontend falls back to its own default in that case.
router.get(
  "/settings/theme",
  asyncHandler(async (req, res) => {
    res.json({ theme: await getUserTheme(req.userId!) });
  }),
);

const themeSettingsSchema = z.object({ theme: z.enum(THEME_SELECTIONS).nullable() });
router.patch(
  "/settings/theme",
  asyncHandler(async (req, res) => {
    const body = parseBody(themeSettingsSchema, req.body);
    const theme = await setUserTheme(req.userId!, body.theme);
    res.json({ theme });
  }),
);

// Per-user on/off for the author preview card shown on hovering an author link -- see
// services/authorPreviewPreferenceService.ts. On by default.
router.get(
  "/settings/author-preview",
  asyncHandler(async (req, res) => {
    res.json({ enabled: await getUserAuthorPreviewEnabled(req.userId!) });
  }),
);

const authorPreviewSettingsSchema = z.object({ enabled: z.boolean() });
router.patch(
  "/settings/author-preview",
  asyncHandler(async (req, res) => {
    const body = parseBody(authorPreviewSettingsSchema, req.body);
    res.json({ enabled: await setUserAuthorPreviewEnabled(req.userId!, body.enabled) });
  }),
);

export default router;
