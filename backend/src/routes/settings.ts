import type { AiConnection } from "@prisma/client";
import { currentStorageMove, startStorageMove, type StorageMoveRun } from "../services/storageMoveService";
import { assertSavableStorageTemplate, storageTemplateProblems } from "../services/storageTemplateRules";
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
  getFlaresolverrUrl,
  getPublicUrl,
  normalizeAiBaseUrl,
  normalizePublicUrl,
  setPublicUrl,
  setFlaresolverrUrl,
  getThingiverseAccessToken,
  setAllowRegistrations,
  setAuthTokenTtl,
  setPreviewMode,
  setSimplifyPreviews,
  setSmtpSettings,
  setThingiverseAccessToken,
  type SmtpSettings,
  getAiCategorizationPrefs,
  setAiCategorizationPrefs,
  getAiDescriptionPrefs,
  setAiDescriptionPrefs,
  type AiCategorizationPrefs,
  type AiDescriptionPrefs,
} from "../services/settingsService";
import { getDatabaseInfo, testAndSwitchDatabase } from "../services/databaseSettingsService";
import {
  DEFAULT_STORAGE_TEMPLATE,
  STORAGE_TEMPLATE_TOKENS,
  getStorageTemplate,
  storageOutOfPlace,
  samplePlateStoragePaths,
  setStorageTemplate,
  validateStorageTemplate,
} from "../services/printService";
import { getMakerworldConnection, setUserMakerworldCookie } from "../services/makerworldCookieService";
import { type MakerworldCookieCheck, verifyMakerworldCookie } from "../services/makerworldCloudApi";
import { verifyThingiverseAccessToken } from "../services/thingiverseApi";
import { SLICER_IDS, getUserSlicer, setUserSlicer } from "../services/slicerPreferenceService";
import { CATEGORIES_VIEWS, getCategoriesView, setCategoriesView } from "../services/categoriesViewService";
import {
  DASHBOARD_LAYOUTS,
  DASHBOARD_THUMBNAILS,
  DASHBOARD_WIDGETS,
  getDashboardLayout,
  getDashboardThumbnails,
  getDashboardWidgets,
  setDashboardLayout,
  setDashboardThumbnails,
  setDashboardWidgets,
} from "../services/dashboardWidgetsService";
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
import { getWeatherLocation, setWeatherLocation, weatherLocationSchema } from "../services/weatherLocationService";
import { dropPreviewsAffectedBySimplification } from "../services/modelPreviewCache";
import { aiCategorizationRunActive, listAiProviderModels, testAiProvider } from "../services/aiCategorizationService";
import { aiDescriptionRunActive } from "../services/aiDescriptionService";
import {
  createAiConnection,
  DEFAULT_AI_PROVIDER,
  deleteAiConnection,
  getAiConnection,
  listAiConnections,
  setDefaultAiConnection,
  updateAiConnection,
} from "../services/aiConnectionService";
import { getDisabledProviders, PROVIDERS, setProviderEnabled } from "../services/providerSettingsService";
import { createLog } from "../services/auditLog";
import { testFlaresolverr } from "../services/flaresolverr";

const router = Router();
router.use(requireAuth);

// Which providers are on: everyone's menus hide what an admin turned off.
router.get(
  "/settings/providers",
  asyncHandler(async (_req, res) => {
    const disabled = await getDisabledProviders();
    res.json({ providers: PROVIDERS.map((id) => ({ id, enabled: !disabled.has(id) })) });
  }),
);

router.patch(
  "/settings/providers/:provider",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const provider = z.enum(PROVIDERS).safeParse(req.params.provider);
    if (!provider.success) throw new HttpError(404, "No such provider");
    const { enabled } = parseBody(z.object({ enabled: z.boolean() }), req.body);
    const disabled = await setProviderEnabled(provider.data, enabled);
    void createLog({ userId: req.userId!, action: "provider_toggled", details: { provider: provider.data, enabled } });
    res.json({ providers: PROVIDERS.map((id) => ({ id, enabled: !disabled.has(id) })) });
  }),
);

function storageMoveOut(run: StorageMoveRun | null) {
  if (!run) return null;
  return {
    running: run.running,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    total: run.total,
    done: run.done,
    moved: run.moved,
    skipped: run.skipped,
  };
}

async function storageSettingsOut(template: string) {
  const move = currentStorageMove();
  return {
    template,
    default_template: DEFAULT_STORAGE_TEMPLATE,
    allowed_tokens: [...STORAGE_TEMPLATE_TOKENS],
    plate_paths: samplePlateStoragePaths(template),
    // A template saved before the rules: it still works, but the page asks for a new one.
    problems: storageTemplateProblems(template).problems,
    // Files left in an older structure, for the page to offer moving; not counted while a move is going.
    out_of_place: move?.running ? null : await storageOutOfPlace(template),
    move: storageMoveOut(move),
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
    res.json(await storageSettingsOut(template));
  }),
);

// What a template being edited would produce, and what's wrong with it, for the page to show as it's typed.
router.post(
  "/settings/storage/preview",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ template: z.string().max(500) }), req.body);
    const { template, problems } = storageTemplateProblems(body.template);
    let platePaths: string[] = [];
    try {
      platePaths = samplePlateStoragePaths(template);
    } catch {
      // Too broken to render; the problems say why.
    }
    res.json({ template, problems, plate_paths: platePaths });
  }),
);

// What saving a template would move, for the page to confirm first.
router.post(
  "/settings/storage/impact",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ template: z.string().max(500) }), req.body);
    res.json(await storageOutOfPlace(assertSavableStorageTemplate(body.template)));
  }),
);

router.get(
  "/settings/storage/move",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ move: storageMoveOut(currentStorageMove()) });
  }),
);

// Saving moves every user's files to the structure, in the background, so none are left in an older one. Saving
// the same one again moves the files that aren't where it puts them.
router.post(
  "/settings/storage",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ template: z.string().max(500) }), req.body);
    const template = assertSavableStorageTemplate(body.template);
    if (currentStorageMove()?.running) {
      throw new HttpError(409, "Model files are still being moved; save again once that's done", "storage_moving");
    }
    await setStorageTemplate(template);
    startStorageMove(req.userId!, template);
    res.json(await storageSettingsOut(template));
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

// Where people open Thingport: links in emails, and where single sign-on providers send people back to.
router.get(
  "/settings/public-url",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ public_url: (await getPublicUrl()) || null });
  }),
);

router.patch(
  "/settings/public-url",
  requireAdmin,
  asyncHandler(async (req, res) => {
    // Can't be cleared from here: emails and single sign-on would break.
    const body = parseBody(z.object({ public_url: z.string().max(500) }).strict(), req.body);
    if (!normalizePublicUrl(body.public_url)) {
      throw new HttpError(400, "Enter the full address, like https://thingport.example.com", "invalid_public_url");
    }
    res.json({ public_url: (await setPublicUrl(body.public_url)) || null });
  }),
);

router.get(
  "/settings/flaresolverr",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ url: await getFlaresolverrUrl() });
  }),
);

const flaresolverrUrlSchema = z.string().trim().url("Enter a full URL, like http://flaresolverr:8191");

// A URL is only saved once FlareSolverr answers on it; clearing it turns FlareSolverr off without a test.
const flaresolverrSettingsSchema = z.object({ url: flaresolverrUrlSchema.nullable().or(z.literal("")) }).strict();
router.patch(
  "/settings/flaresolverr",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(flaresolverrSettingsSchema, req.body);
    if (body.url) {
      const result = await testFlaresolverr(body.url);
      if (!result.ok)
        throw new HttpError(
          422,
          `Could not connect to FlareSolverr: ${result.error}`,
          "flaresolverr_connection_failed",
        );
    }
    res.json({ url: await setFlaresolverrUrl(body.url || null) });
  }),
);

const flaresolverrTestSchema = z.object({ url: flaresolverrUrlSchema }).strict();
router.post(
  "/settings/flaresolverr/test",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(flaresolverrTestSchema, req.body);
    const result = await testFlaresolverr(body.url);
    res.json(result.ok ? { ok: true, latency_ms: result.latencyMs, version: result.version } : result);
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

// Per-user, unlike the instance-wide Thingiverse token. GET only reports whether one is set, and
// whether MakerWorld has since turned it down.
router.get(
  "/settings/makerworld",
  asyncHandler(async (req, res) => {
    const connection = await getMakerworldConnection(req.userId!);
    res.json({ configured: connection !== "disconnected", expired: connection === "expired" });
  }),
);

// `verify` is opt-in: the extension's background sync sends a cookie it already knows works.
const MAKERWORLD_UNVERIFIABLE_MESSAGES: Record<
  Extract<MakerworldCookieCheck, { result: "unverifiable" }>["reason"],
  string
> = {
  cloudflare_no_flaresolverr:
    "Couldn't check this cookie: MakerWorld's Cloudflare protection blocked the request and FlareSolverr isn't configured. Set its URL in Administration → Connections and try again.",
  flaresolverr_failed:
    "Couldn't check this cookie: MakerWorld's Cloudflare protection blocked the request and FlareSolverr didn't get past it. Make sure FlareSolverr is running and reachable at the URL set in Administration → Connections, then try again.",
  network:
    "Couldn't check this cookie: MakerWorld didn't respond. Check this server's internet connection and try again.",
};

const makerworldSettingsSchema = z.object({ cookie: z.string().nullable(), verify: z.boolean().optional() });
router.patch(
  "/settings/makerworld",
  asyncHandler(async (req, res) => {
    const body = parseBody(makerworldSettingsSchema, req.body);
    const trimmed = (body.cookie ?? "").trim();
    let verified = false;
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
      verified = true;
    }
    const configured = await setUserMakerworldCookie(req.userId!, body.cookie, { verified });
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
  "/settings/dashboard-layout",
  asyncHandler(async (req, res) => {
    res.json({ layout: await getDashboardLayout(req.userId!) });
  }),
);

const dashboardLayoutSchema = z.object({ layout: z.enum(DASHBOARD_LAYOUTS) });
router.patch(
  "/settings/dashboard-layout",
  asyncHandler(async (req, res) => {
    const body = parseBody(dashboardLayoutSchema, req.body);
    res.json({ layout: await setDashboardLayout(req.userId!, body.layout) });
  }),
);

router.get(
  "/settings/dashboard-thumbnails",
  asyncHandler(async (req, res) => {
    res.json({ thumbnails: await getDashboardThumbnails(req.userId!) });
  }),
);

const dashboardThumbnailsSchema = z.object({ thumbnails: z.enum(DASHBOARD_THUMBNAILS) });
router.patch(
  "/settings/dashboard-thumbnails",
  asyncHandler(async (req, res) => {
    const body = parseBody(dashboardThumbnailsSchema, req.body);
    res.json({ thumbnails: await setDashboardThumbnails(req.userId!, body.thumbnails) });
  }),
);

router.get(
  "/settings/weather-location",
  asyncHandler(async (req, res) => {
    res.json({ location: await getWeatherLocation(req.userId!) });
  }),
);

// Null forgets the location.
const weatherLocationBodySchema = z.object({ location: weatherLocationSchema.nullable() });
router.patch(
  "/settings/weather-location",
  asyncHandler(async (req, res) => {
    const body = parseBody(weatherLocationBodySchema, req.body);
    res.json({ location: await setWeatherLocation(req.userId!, body.location) });
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

function aiCategorizationPrefsOut(prefs: AiCategorizationPrefs) {
  return {
    enabled: prefs.enabled,
    mode: prefs.mode,
    threshold: prefs.threshold,
    on_import: prefs.onImport,
    send_image: prefs.sendImage,
    ai_connection_id: prefs.aiConnectionId,
  };
}

router.get(
  "/settings/ai-categorization",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(aiCategorizationPrefsOut(await getAiCategorizationPrefs()));
  }),
);

const aiCategorizationPrefsSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["suggest", "auto"]).optional(),
    threshold: z.number().min(0).max(1).optional(),
    on_import: z.boolean().optional(),
    send_image: z.boolean().optional(),
    // Null uses the default AI.
    ai_connection_id: z.string().nullable().optional(),
  })
  .strict();
router.patch(
  "/settings/ai-categorization",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(aiCategorizationPrefsSchema, req.body);
    if (body.enabled === false && aiCategorizationRunActive()) {
      throw new HttpError(409, "AI categorization is running. Stop the run before turning it off.", "run_active");
    }
    if (body.ai_connection_id) await getAiConnection(body.ai_connection_id);
    const prefs = await setAiCategorizationPrefs({
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
      ...(body.on_import !== undefined ? { onImport: body.on_import } : {}),
      ...(body.send_image !== undefined ? { sendImage: body.send_image } : {}),
      ...(body.ai_connection_id !== undefined ? { aiConnectionId: body.ai_connection_id } : {}),
    });
    res.json(aiCategorizationPrefsOut(prefs));
  }),
);

function aiDescriptionPrefsOut(prefs: AiDescriptionPrefs) {
  return {
    enabled: prefs.enabled,
    mode: prefs.mode,
    on_import: prefs.onImport,
    send_image: prefs.sendImage,
    ai_connection_id: prefs.aiConnectionId,
    actions: {
      remove_self_promotion: prefs.actions.removeSelfPromotion,
      remove_unrelated: prefs.actions.removeUnrelated,
      translate: prefs.actions.translate,
      generate_missing: prefs.actions.generateMissing,
      fix_spelling: prefs.actions.fixSpelling,
      improve_formatting: prefs.actions.improveFormatting,
    },
  };
}

router.get(
  "/settings/ai-descriptions",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(aiDescriptionPrefsOut(await getAiDescriptionPrefs()));
  }),
);

const aiDescriptionPrefsSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(["suggest", "auto"]).optional(),
    on_import: z.boolean().optional(),
    send_image: z.boolean().optional(),
    ai_connection_id: z.string().nullable().optional(),
    actions: z
      .object({
        remove_self_promotion: z.boolean(),
        remove_unrelated: z.boolean(),
        translate: z.boolean(),
        generate_missing: z.boolean(),
        fix_spelling: z.boolean(),
        improve_formatting: z.boolean(),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();
router.patch(
  "/settings/ai-descriptions",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(aiDescriptionPrefsSchema, req.body);
    if (body.enabled === false && aiDescriptionRunActive()) {
      throw new HttpError(409, "Improved descriptions is running. Stop the run before turning it off.", "run_active");
    }
    if (body.ai_connection_id) await getAiConnection(body.ai_connection_id);
    const actions = body.actions;
    const prefs = await setAiDescriptionPrefs({
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.mode !== undefined ? { mode: body.mode } : {}),
      ...(body.on_import !== undefined ? { onImport: body.on_import } : {}),
      ...(body.send_image !== undefined ? { sendImage: body.send_image } : {}),
      ...(body.ai_connection_id !== undefined ? { aiConnectionId: body.ai_connection_id } : {}),
      ...(actions
        ? {
            actions: {
              ...(actions.remove_self_promotion !== undefined
                ? { removeSelfPromotion: actions.remove_self_promotion }
                : {}),
              ...(actions.remove_unrelated !== undefined ? { removeUnrelated: actions.remove_unrelated } : {}),
              ...(actions.translate !== undefined ? { translate: actions.translate } : {}),
              ...(actions.generate_missing !== undefined ? { generateMissing: actions.generate_missing } : {}),
              ...(actions.fix_spelling !== undefined ? { fixSpelling: actions.fix_spelling } : {}),
              ...(actions.improve_formatting !== undefined ? { improveFormatting: actions.improve_formatting } : {}),
            },
          }
        : {}),
    });
    res.json(aiDescriptionPrefsOut(prefs));
  }),
);

function aiConnectionOut(connection: AiConnection) {
  return {
    id: connection.id,
    base_url: connection.baseUrl,
    model: connection.model,
    has_api_key: Boolean(connection.apiKey),
    timeout_ms: connection.timeoutMs,
    concurrency: connection.concurrency,
    thinking: connection.thinking,
    is_default: connection.isDefault,
  };
}

router.get(
  "/settings/ai-connections",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json((await listAiConnections()).map(aiConnectionOut));
  }),
);

// api_key: omitted keeps the saved one, null or "" means none.
const aiConnectionFields = {
  base_url: z.string().trim().min(1),
  model: z.string().trim().min(1),
  api_key: z.string().nullable().optional(),
  timeout_ms: z.number().int().min(1000).max(300000),
  concurrency: z.number().int().min(1).max(4),
  thinking: z.boolean(),
};

/** A saved AI (or the defaults, for a new one) with the form's values on top. */
async function providerFrom(
  id: string | undefined,
  body: Partial<{ base_url: string; model: string; api_key: string | null; timeout_ms: number; thinking: boolean }>,
) {
  const saved = id ? await getAiConnection(id) : null;
  return {
    baseUrl: body.base_url !== undefined ? normalizeAiBaseUrl(body.base_url) : (saved?.baseUrl ?? null),
    model: body.model ?? saved?.model ?? null,
    apiKey: body.api_key !== undefined ? body.api_key || null : (saved?.apiKey ?? DEFAULT_AI_PROVIDER.apiKey),
    timeoutMs: body.timeout_ms ?? saved?.timeoutMs ?? DEFAULT_AI_PROVIDER.timeoutMs,
    thinking: body.thinking ?? saved?.thinking ?? DEFAULT_AI_PROVIDER.thinking,
  };
}

/** An AI is only saved once it answers, so a feature never switches to one that can't. */
async function requireAnswer(provider: Awaited<ReturnType<typeof providerFrom>>): Promise<void> {
  const result = await testAiProvider(provider);
  if (!result.ok)
    throw new HttpError(422, `Could not connect to the AI provider: ${result.error}`, "ai_connection_failed");
}

const aiConnectionCreateSchema = z
  .object({
    ...aiConnectionFields,
    timeout_ms: aiConnectionFields.timeout_ms.optional(),
    concurrency: aiConnectionFields.concurrency.optional(),
    thinking: aiConnectionFields.thinking.optional(),
  })
  .strict();
router.post(
  "/settings/ai-connections",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(aiConnectionCreateSchema, req.body);
    const provider = await providerFrom(undefined, body);
    await requireAnswer(provider);
    const connection = await createAiConnection({
      baseUrl: provider.baseUrl!,
      model: provider.model!,
      apiKey: provider.apiKey,
      timeoutMs: provider.timeoutMs,
      thinking: provider.thinking,
      concurrency: body.concurrency ?? DEFAULT_AI_PROVIDER.concurrency,
    });
    res.status(201).json(aiConnectionOut(connection));
  }),
);

const aiConnectionUpdateSchema = z.object(aiConnectionFields).partial().strict();
router.patch(
  "/settings/ai-connections/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(aiConnectionUpdateSchema, req.body);
    const provider = await providerFrom(req.params.id, body);
    // Concurrency and thinking don't change whether it answers.
    if (
      body.base_url !== undefined ||
      body.model !== undefined ||
      body.api_key !== undefined ||
      body.timeout_ms !== undefined
    ) {
      await requireAnswer(provider);
    }
    const connection = await updateAiConnection(req.params.id, {
      ...(body.base_url !== undefined ? { baseUrl: provider.baseUrl! } : {}),
      ...(body.model !== undefined ? { model: provider.model! } : {}),
      ...(body.api_key !== undefined ? { apiKey: provider.apiKey } : {}),
      ...(body.timeout_ms !== undefined ? { timeoutMs: body.timeout_ms } : {}),
      ...(body.concurrency !== undefined ? { concurrency: body.concurrency } : {}),
      ...(body.thinking !== undefined ? { thinking: body.thinking } : {}),
    });
    res.json(aiConnectionOut(connection));
  }),
);

router.delete(
  "/settings/ai-connections/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await deleteAiConnection(req.params.id);
    // With no model left every feature switches off, so adding one later doesn't quietly start them again.
    if (!(await listAiConnections()).length) {
      await setAiCategorizationPrefs({ enabled: false, aiConnectionId: null });
      await setAiDescriptionPrefs({ enabled: false, aiConnectionId: null });
    } else {
      // A feature set to it goes back to the default.
      if ((await getAiCategorizationPrefs()).aiConnectionId === req.params.id) {
        await setAiCategorizationPrefs({ aiConnectionId: null });
      }
      if ((await getAiDescriptionPrefs()).aiConnectionId === req.params.id) {
        await setAiDescriptionPrefs({ aiConnectionId: null });
      }
    }
    res.status(204).end();
  }),
);

router.post(
  "/settings/ai-connections/:id/default",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(aiConnectionOut(await setDefaultAiConnection(req.params.id)));
  }),
);

// `id` is a saved AI whose values the form's fill in; without it, only the form's values count.
const aiModelListSchema = z
  .object({
    id: z.string().optional(),
    base_url: z.string().trim().min(1).optional(),
    api_key: z.string().nullable().optional(),
  })
  .strict();
router.post(
  "/settings/ai-connections/models",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(aiModelListSchema, req.body ?? {});
    res.json(await listAiProviderModels(await providerFrom(body.id, body)));
  }),
);

const aiConnectionTestSchema = z
  .object({ id: z.string().optional(), ...aiConnectionFields })
  .partial()
  .strict();
router.post(
  "/settings/ai-connections/test",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(aiConnectionTestSchema, req.body ?? {});
    const result = await testAiProvider(await providerFrom(body.id, body));
    res.json(result.ok ? { ok: true, latency_ms: result.latencyMs, model: result.model } : result);
  }),
);

export default router;
