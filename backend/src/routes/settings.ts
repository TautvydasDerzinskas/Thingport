import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getAllowRegistrations,
  getPreviewMode,
  getSmtpSettings,
  getThingiverseAccessToken,
  setAllowRegistrations,
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
import { SLICER_IDS, getUserSlicer, setUserSlicer } from "../services/slicerPreferenceService";
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
    await setThingiverseAccessToken(body.access_token);
    res.json({ configured: Boolean(body.access_token && body.access_token.trim()) });
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

const makerworldSettingsSchema = z.object({ cookie: z.string().nullable() });
router.patch(
  "/settings/makerworld",
  asyncHandler(async (req, res) => {
    const body = parseBody(makerworldSettingsSchema, req.body);
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

export default router;
