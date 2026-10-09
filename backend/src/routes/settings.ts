import { Router } from "express";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth";
import { HttpError } from "../utils/fileUtils";
import { parseBody } from "../utils/validate";
import { asyncHandler } from "../utils/asyncHandler";
import {
  getAllowRegistrations,
  setCaptchaSettings,
  getAuthTokenTtl,
  getPreviewMode,
  getSimplifyPreviews,
  getSmtpSettings,
  getThingiverseAccessToken,
  setAllowRegistrations,
  setAuthTokenTtl,
  setPreviewMode,
  setSimplifyPreviews,
  setSmtpSettings,
  setThingiverseAccessToken,
  type SmtpSettings,
  getAiCategorizationSettings,
  setAiCategorizationSettings,
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
import { CATEGORIES_VIEWS, getCategoriesView, setCategoriesView } from "../services/categoriesViewService";
import { DASHBOARD_WIDGETS, getDashboardWidgets, setDashboardWidgets } from "../services/dashboardWidgetsService";
import {
  CONSUME_MODES,
  NOT_IMPORTED_DIR,
  consumeAvailable,
  getConsumeMode,
  getConsumeUserId,
  setConsumeSettings,
} from "../services/consumeService";
import { CONSUME_DIR } from "../config";
import { THEME_SELECTIONS, getUserTheme, setUserTheme } from "../services/themePreferenceService";
import { getUserAuthorPreviewEnabled, setUserAuthorPreviewEnabled } from "../services/authorPreviewPreferenceService";
import { checkForUpdates } from "../services/versionService";
import { dropPreviewsAffectedBySimplification } from "../services/modelPreviewCache";
import { testAiCategorizationProvider } from "../services/aiCategorizationService";

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

// Compares the latest backend/ and frontend/ commits on main against this build's commit. The
// frontend compares its own baked-in commit against latest_frontend_sha.
router.get(
  "/settings/version-check",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await checkForUpdates());
  }),
);

router.get(
  "/settings/storage",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const template = validateStorageTemplate(await getStorageTemplate());
    res.json(storageSettingsOut(template));
  }),
);

// Admin-only: "apply to existing" relocates every user's files.
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

// Reading these is public (routes/captcha.ts): sign-in and register forms need them.
const captchaSettingsSchema = z
  .object({
    login: z.boolean(),
    register: z.boolean(),
    import: z.boolean(),
    change_password: z.boolean(),
    change_email: z.boolean(),
  })
  .partial();
router.patch(
  "/settings/captcha",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await setCaptchaSettings(parseBody(captchaSettingsSchema, req.body)));
  }),
);

// Closed registrations still admit invitees and the very first account.
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

router.get(
  "/settings/auth",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ token_ttl_seconds: await getAuthTokenTtl() });
  }),
);

// Bounds catch typos. Only affects tokens issued after saving.
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

// A change drops the cached previews it would alter, in the background.
router.get(
  "/settings/rendering",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ simplify_previews: await getSimplifyPreviews() });
  }),
);

const renderingSchema = z.object({ simplify_previews: z.boolean() });
router.patch(
  "/settings/rendering",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(renderingSchema, req.body);
    const previous = await getSimplifyPreviews();
    await setSimplifyPreviews(body.simplify_previews);
    if (previous !== body.simplify_previews) {
      void dropPreviewsAffectedBySimplification(body.simplify_previews).catch((err) =>
        console.error("Couldn't refresh previews after a simplification change", err),
      );
    }
    res.json({ simplify_previews: body.simplify_previews });
  }),
);

// Readable by every user so the UI can tell whether imports will work. GET never echoes the
// token, only whether one is set.
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

function smtpSettingsOut(smtp: SmtpSettings) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    user: smtp.user,
    from: smtp.from,
    configured: Boolean(smtp.host),
  };
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
  // Omitted means keep the current password.
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

// Tests the credentials before hot-swapping the live connection. Not persisted across restarts
// (see databaseSettingsService.ts); host/port can't change.
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

// Per-user, unlike the instance-wide Thingiverse token. GET only reports whether one is set.
router.get(
  "/settings/makerworld",
  asyncHandler(async (req, res) => {
    res.json({ configured: Boolean(await getUserMakerworldCookie(req.userId!)) });
  }),
);

// `verify` is opt-in: the extension's background sync sends a cookie it already knows works.
const MAKERWORLD_UNVERIFIABLE_MESSAGES: Record<
  Extract<MakerworldCookieCheck, { result: "unverifiable" }>["reason"],
  string
> = {
  cloudflare_no_flaresolverr:
    "Couldn't check this cookie: MakerWorld's Cloudflare protection blocked the request and FlareSolverr isn't configured. Set FLARESOLVERR_URL and try again.",
  flaresolverr_failed:
    "Couldn't check this cookie: MakerWorld's Cloudflare protection blocked the request and FlareSolverr didn't get past it. Make sure FlareSolverr is running and reachable at FLARESOLVERR_URL, then try again.",
  network:
    "Couldn't check this cookie: MakerWorld didn't respond. Check this server's internet connection and try again.",
};

const makerworldSettingsSchema = z.object({ cookie: z.string().nullable(), verify: z.boolean().optional() });
router.patch(
  "/settings/makerworld",
  asyncHandler(async (req, res) => {
    const body = parseBody(makerworldSettingsSchema, req.body);
    const trimmed = (body.cookie ?? "").trim();
    if (body.verify && trimmed) {
      const check = await verifyMakerworldCookie(trimmed);
      if (check.result === "invalid") {
        throw new HttpError(
          422,
          "MakerWorld rejected this cookie -- it may be invalid or expired. Copy a fresh Cookie header from a logged-in makerworld.com tab and try again.",
        );
      }
      // 503, not 422: nothing is known to be wrong with the cookie.
      if (check.result === "unverifiable") throw new HttpError(503, MAKERWORLD_UNVERIFIABLE_MESSAGES[check.reason]);
    }
    const configured = await setUserMakerworldCookie(req.userId!, body.cookie);
    res.json({ configured });
  }),
);

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

// Null means never set; the frontend applies its default.
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

async function consumeSettingsOut() {
  return {
    available: consumeAvailable(),
    path: CONSUME_DIR,
    not_imported_dir: NOT_IMPORTED_DIR,
    mode: await getConsumeMode(),
    user_id: await getConsumeUserId(),
  };
}

router.get(
  "/settings/consume",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await consumeSettingsOut());
  }),
);

const consumeSchema = z.object({ mode: z.enum(CONSUME_MODES).optional(), user_id: z.string().optional() });
router.patch(
  "/settings/consume",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(consumeSchema, req.body);
    await setConsumeSettings({ mode: body.mode, userId: body.user_id });
    res.json(await consumeSettingsOut());
  }),
);

router.get(
  "/settings/categories-view",
  asyncHandler(async (req, res) => {
    res.json({ view: await getCategoriesView(req.userId!) });
  }),
);

const categoriesViewSchema = z.object({ view: z.enum(CATEGORIES_VIEWS) });
router.patch(
  "/settings/categories-view",
  asyncHandler(async (req, res) => {
    const body = parseBody(categoriesViewSchema, req.body);
    res.json({ view: await setCategoriesView(req.userId!, body.view) });
  }),
);

router.get(
  "/settings/dashboard-widgets",
  asyncHandler(async (req, res) => {
    res.json({ widgets: await getDashboardWidgets(req.userId!) });
  }),
);

// Only the widgets being changed; the rest keep what's saved.
const dashboardWidgetsSchema = z.object({ widgets: z.record(z.enum(DASHBOARD_WIDGETS), z.boolean()) });
router.patch(
  "/settings/dashboard-widgets",
  asyncHandler(async (req, res) => {
    const body = parseBody(dashboardWidgetsSchema, req.body);
    res.json({ widgets: await setDashboardWidgets(req.userId!, body.widgets) });
  }),
);

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

function aiCategorizationSettingsOut(settings: Awaited<ReturnType<typeof getAiCategorizationSettings>>) {
  return {
    mode: settings.mode,
    base_url: settings.baseUrl,
    model: settings.model,
    has_api_key: Boolean(settings.apiKey),
    threshold: settings.threshold,
    on_import: settings.onImport,
    concurrency: settings.concurrency,
    send_image: settings.sendImage,
    timeout_ms: settings.timeoutMs,
  };
}

router.get(
  "/settings/ai-categorization",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(aiCategorizationSettingsOut(await getAiCategorizationSettings()));
  }),
);

const aiCategorizationSettingsSchema = z
  .object({
    mode: z.enum(["off", "suggest", "auto"]).optional(),
    base_url: z.string().trim().nullable().optional(),
    api_key: z.string().nullable().optional(),
    model: z.string().trim().nullable().optional(),
    threshold: z.number().min(0).max(1).optional(),
    on_import: z.boolean().optional(),
    concurrency: z.number().int().min(1).max(4).optional(),
    send_image: z.boolean().optional(),
    timeout_ms: z.number().int().min(1).max(300000).optional(),
  })
  .strict();
router.patch(
  "/settings/ai-categorization",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(aiCategorizationSettingsSchema, req.body);
    const settings = await setAiCategorizationSettings({
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.base_url !== undefined ? { baseUrl: body.base_url?.replace(/\/+$/, "") || null } : {}),
      ...(body.api_key !== undefined ? { apiKey: body.api_key } : {}),
      ...(body.model !== undefined ? { model: body.model } : {}),
      ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
      ...(body.on_import !== undefined ? { onImport: body.on_import } : {}),
      ...(body.concurrency !== undefined ? { concurrency: body.concurrency } : {}),
      ...(body.send_image !== undefined ? { sendImage: body.send_image } : {}),
      ...(body.timeout_ms !== undefined ? { timeoutMs: body.timeout_ms } : {}),
    });
    res.json(aiCategorizationSettingsOut(settings));
  }),
);

router.post(
  "/settings/ai-categorization/test",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const result = await testAiCategorizationProvider();
    res.json(result.ok ? { ok: true, latency_ms: result.latencyMs, model: result.model } : result);
  }),
);

export default router;
