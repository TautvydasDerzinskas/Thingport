import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { FLARESOLVERR_URL, PUBLIC_URL } from "../config";
import { QUALITY_CHECK_KEYS, type QualityCheckKey } from "./meshQuality";

async function getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (row === null || row === undefined) return fallback;
  return typeof row.value === "boolean" ? row.value : fallback;
}

async function setBoolSetting(key: string, value: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export type CaptchaPlace = "login" | "register" | "import" | "change_password" | "change_email";
export type CaptchaSettings = Record<CaptchaPlace, boolean>;
export const CAPTCHA_PLACES: readonly CaptchaPlace[] = [
  "login",
  "register",
  "import",
  "change_password",
  "change_email",
];
const captchaKey = (place: CaptchaPlace) => `captcha_${place}`;

export async function getCaptchaSettings(): Promise<CaptchaSettings> {
  const values = await Promise.all(CAPTCHA_PLACES.map((place) => getBoolSetting(captchaKey(place), false)));
  return Object.fromEntries(CAPTCHA_PLACES.map((place, i) => [place, values[i]])) as CaptchaSettings;
}

export async function isCaptchaEnabled(place: CaptchaPlace): Promise<boolean> {
  return getBoolSetting(captchaKey(place), false);
}

export async function setCaptchaSettings(patch: Partial<CaptchaSettings>): Promise<CaptchaSettings> {
  for (const place of CAPTCHA_PLACES) {
    if (patch[place] !== undefined) await setBoolSetting(captchaKey(place), patch[place]);
  }
  return getCaptchaSettings();
}

// Custom widgets' scripts run in their users' dashboard pages with their access; an admin can turn off users' own
// widgets and the community's separately.
export const WIDGET_SOURCES = ["own", "community"] as const;
export type WidgetSource = (typeof WIDGET_SOURCES)[number];
export type WidgetSources = Record<WidgetSource, boolean>;

const widgetSourceKey = (source: WidgetSource) => `${source === "own" ? "user" : source}_widgets_enabled`;

export async function getWidgetSources(): Promise<WidgetSources> {
  const [own, community] = await Promise.all(
    WIDGET_SOURCES.map((source) => getBoolSetting(widgetSourceKey(source), true)),
  );
  return { own, community };
}

export async function setWidgetSources(patch: Partial<WidgetSources>): Promise<WidgetSources> {
  for (const source of WIDGET_SOURCES) {
    if (patch[source] !== undefined) await setBoolSetting(widgetSourceKey(source), patch[source]);
  }
  return getWidgetSources();
}

const ALLOW_REGISTRATIONS_KEY = "allow_registrations";

export async function getAllowRegistrations(fallback: boolean): Promise<boolean> {
  return getBoolSetting(ALLOW_REGISTRATIONS_KEY, fallback);
}

export async function setAllowRegistrations(value: boolean): Promise<void> {
  await setBoolSetting(ALLOW_REGISTRATIONS_KEY, value);
}

const SIMPLIFY_PREVIEWS_KEY = "simplify_previews";

export async function getSimplifyPreviews(): Promise<boolean> {
  return getBoolSetting(SIMPLIFY_PREVIEWS_KEY, false);
}

export async function setSimplifyPreviews(value: boolean): Promise<void> {
  await setBoolSetting(SIMPLIFY_PREVIEWS_KEY, value);
}

const QUALITY_CHECKS_KEY = "quality_checks";

// Instance-wide. On by default: a model is only checked when opened, so the cost comes a model at a time.
export async function getQualityChecks(): Promise<boolean> {
  return getBoolSetting(QUALITY_CHECKS_KEY, true);
}

export async function setQualityChecks(value: boolean): Promise<void> {
  await setBoolSetting(QUALITY_CHECKS_KEY, value);
}

const QUALITY_CHECKS_OFF_KEY = "quality_checks_off";

// The checks switched off rather than on, so a check added later starts on.
export async function getQualityChecksOff(): Promise<QualityCheckKey[]> {
  const row = await prisma.setting.findUnique({ where: { key: QUALITY_CHECKS_OFF_KEY } });
  const value = row?.value;
  return Array.isArray(value) ? QUALITY_CHECK_KEYS.filter((key) => (value as unknown[]).includes(key)) : [];
}

export async function setQualityChecksOff(keys: QualityCheckKey[]): Promise<void> {
  const value = QUALITY_CHECK_KEYS.filter((key) => keys.includes(key));
  await prisma.setting.upsert({
    where: { key: QUALITY_CHECKS_OFF_KEY },
    create: { key: QUALITY_CHECKS_OFF_KEY, value },
    update: { value },
  });
}

export type PreviewMode = "automatic" | "on-demand" | "disabled";
const PREVIEW_MODES = new Set<PreviewMode>(["automatic", "on-demand", "disabled"]);
const PREVIEW_MODE_KEY = "preview_mode";
const DEFAULT_PREVIEW_MODE: PreviewMode = "automatic";

// Instance-wide: every user's previews share the same storage.
export async function getPreviewMode(): Promise<PreviewMode> {
  const row = await prisma.setting.findUnique({ where: { key: PREVIEW_MODE_KEY } });
  const value = row?.value;
  return typeof value === "string" && PREVIEW_MODES.has(value as PreviewMode)
    ? (value as PreviewMode)
    : DEFAULT_PREVIEW_MODE;
}

export async function setPreviewMode(value: PreviewMode): Promise<void> {
  await prisma.setting.upsert({
    where: { key: PREVIEW_MODE_KEY },
    create: { key: PREVIEW_MODE_KEY, value },
    update: { value },
  });
}

// How a model file identical to one already stored (by SHA-256) is saved (services/fileReuse.ts), instance-wide
// since the copies may belong to different users. "reflink" clones it copy-on-write where the filesystem can (btrfs,
// XFS, ZFS >= 2.2), so the copies stay independent files and only take space once they differ; elsewhere it's stored
// as usual. There's deliberately no hard-link mode: a hard link is one file, so editing one user's copy on disk would
// silently change every other user's too. Off unless an admin chooses, since the storage folder may be mounted and
// its files edited outside Thingport; an unknown stored value (such as an old "hardlink") reads as off.
export type FileReuse = "off" | "reflink";
export const FILE_REUSE_MODES: readonly FileReuse[] = ["off", "reflink"];
const FILE_REUSE_KEY = "file_reuse";
const DEFAULT_FILE_REUSE: FileReuse = "off";

export async function getFileReuse(): Promise<FileReuse> {
  const row = await prisma.setting.findUnique({ where: { key: FILE_REUSE_KEY } });
  const value = row?.value;
  return typeof value === "string" && FILE_REUSE_MODES.includes(value as FileReuse)
    ? (value as FileReuse)
    : DEFAULT_FILE_REUSE;
}

export async function setFileReuse(value: FileReuse): Promise<void> {
  await prisma.setting.upsert({
    where: { key: FILE_REUSE_KEY },
    create: { key: FILE_REUSE_KEY, value },
    update: { value },
  });
}

// What API tokens may do at /api/mcp, instance-wide. "read" also keeps a write tool off for a token
// whose user ticked it, without forgetting the choice.
export type McpAccess = "off" | "read" | "write";
export const MCP_ACCESS_LEVELS: readonly McpAccess[] = ["off", "read", "write"];
const MCP_ACCESS_KEY = "mcp_access";
const DEFAULT_MCP_ACCESS: McpAccess = "write";

export async function getMcpAccess(): Promise<McpAccess> {
  const row = await prisma.setting.findUnique({ where: { key: MCP_ACCESS_KEY } });
  const value = row?.value;
  return typeof value === "string" && MCP_ACCESS_LEVELS.includes(value as McpAccess)
    ? (value as McpAccess)
    : DEFAULT_MCP_ACCESS;
}

export async function setMcpAccess(value: McpAccess): Promise<void> {
  await prisma.setting.upsert({
    where: { key: MCP_ACCESS_KEY },
    create: { key: MCP_ACCESS_KEY, value },
    update: { value },
  });
}

export type SmtpSettings = {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
};

const SMTP_SETTINGS_KEY = "smtp_settings";
const DEFAULT_SMTP_FROM = "Thingport <no-reply@localhost>";

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Seeds from SMTP_* env vars until an admin saves settings; then the DB row wins.
function smtpSeedFromEnv(): SmtpSettings {
  return {
    host: (process.env.SMTP_HOST || "").trim() || null,
    port: envInt("SMTP_PORT", 587),
    secure: process.env.SMTP_SECURE === "true",
    user: (process.env.SMTP_USER || "").trim() || null,
    pass: (process.env.SMTP_PASS || "").trim() || null,
    from: (process.env.SMTP_FROM || "").trim() || DEFAULT_SMTP_FROM,
  };
}

export async function getSmtpSettings(): Promise<SmtpSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SMTP_SETTINGS_KEY } });
  if (row && typeof row.value === "object" && row.value !== null && !Array.isArray(row.value)) {
    return { ...smtpSeedFromEnv(), ...(row.value as Partial<SmtpSettings>) };
  }
  return smtpSeedFromEnv();
}

export async function isSmtpConfigured(): Promise<boolean> {
  return Boolean((await getSmtpSettings()).host);
}

export async function setSmtpSettings(patch: Partial<SmtpSettings>): Promise<SmtpSettings> {
  const next = { ...(await getSmtpSettings()), ...patch };
  await prisma.setting.upsert({
    where: { key: SMTP_SETTINGS_KEY },
    create: { key: SMTP_SETTINGS_KEY, value: next as unknown as Prisma.InputJsonValue },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

const FLARESOLVERR_URL_KEY = "flaresolverr_url";
/** FlareSolverr only answers at /v1, so the base URL works too: `http://host:8191` → `http://host:8191/v1`. */
export function normalizeFlaresolverrUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export const FLARESOLVERR_URL_POLICY_ERROR =
  "Use HTTPS for a remote FlareSolverr. HTTP is allowed only for flaresolverr, localhost, 127.0.0.1 or [::1].";

/** Credentials may travel to the solver. Only the standard Compose service and explicit loopback names
 * may use plaintext HTTP; do not infer trust from DNS, LAN ranges or URL parser IP aliases. */
export function isAllowedFlaresolverrUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        /^http:\/\/(?:flaresolverr|localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value))
    );
  } catch {
    return false;
  }
}

// Until a row exists (seeded at startup or saved by an admin) the env var is the fallback; after that the row wins.
export async function getFlaresolverrUrl(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: FLARESOLVERR_URL_KEY } });
  if (row) return typeof row.value === "string" ? normalizeFlaresolverrUrl(row.value) : null;
  return normalizeFlaresolverrUrl(FLARESOLVERR_URL);
}

/** Copies the env var into the DB once, at startup, so later env changes don't override what an admin saved. */
export async function seedFlaresolverrUrl(envValue: string = FLARESOLVERR_URL): Promise<void> {
  const seed = normalizeFlaresolverrUrl(envValue);
  if (!seed) return;
  await prisma.setting.upsert({
    where: { key: FLARESOLVERR_URL_KEY },
    create: { key: FLARESOLVERR_URL_KEY, value: seed },
    update: {},
  });
}

// Cleared is stored as "" so the env var doesn't come back on the next read.
export async function setFlaresolverrUrl(value: string | null): Promise<string | null> {
  const url = normalizeFlaresolverrUrl(value);
  await prisma.setting.upsert({
    where: { key: FLARESOLVERR_URL_KEY },
    create: { key: FLARESOLVERR_URL_KEY, value: url ?? "" },
    update: { value: url ?? "" },
  });
  return url;
}

const PUBLIC_URL_KEY = "public_url";

/** The address people open Thingport at, without a trailing slash; null when it isn't a usable http(s) URL. */
export function normalizePublicUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // Links and redirect URIs are built by appending to it, so no query or fragment.
    if (url.search || url.hash) return null;
    return trimmed;
  } catch {
    return null;
  }
}

// Seeded from PUBLIC_URL at startup; after that the row wins, so an admin's change sticks across restarts.
// "" when there's none: links in emails then can't be absolute, and single sign-on can't work.
export async function getPublicUrl(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: PUBLIC_URL_KEY } });
  if (row) return typeof row.value === "string" ? (normalizePublicUrl(row.value) ?? "") : "";
  return normalizePublicUrl(PUBLIC_URL) ?? "";
}

/** Copies the env var into the DB once, at startup, so later env changes don't override what an admin saved. */
export async function seedPublicUrl(envValue: string = PUBLIC_URL): Promise<void> {
  const seed = normalizePublicUrl(envValue);
  if (!seed) return;
  await prisma.setting.upsert({
    where: { key: PUBLIC_URL_KEY },
    create: { key: PUBLIC_URL_KEY, value: seed },
    update: {},
  });
}

// Cleared is stored as "" so the env var doesn't come back on the next read.
export async function setPublicUrl(value: string | null): Promise<string> {
  const url = normalizePublicUrl(value) ?? "";
  await prisma.setting.upsert({
    where: { key: PUBLIC_URL_KEY },
    create: { key: PUBLIC_URL_KEY, value: url },
    update: { value: url },
  });
  return url;
}

export type AiCategorizationMode = "suggest" | "auto";
/** How categorization behaves; which AI it talks to is an AiConnection (aiConnectionService.ts). */
export type AiCategorizationPrefs = {
  /** Off hides it everywhere: no runs, no categorizing on import, no suggestions shown. */
  enabled: boolean;
  mode: AiCategorizationMode;
  threshold: number;
  onImport: boolean;
  sendImage: boolean;
  /** Null uses the default AI. */
  aiConnectionId: string | null;
};

const AI_CATEGORIZATION_KEY = "ai_categorization";
export const DEFAULT_AI_CATEGORIZATION_PREFS: AiCategorizationPrefs = {
  enabled: false,
  mode: "suggest",
  threshold: 0.8,
  onImport: true,
  sendImage: false,
  aiConnectionId: null,
};

/** Ollama, LM Studio, vLLM and OpenAI serve the API under /v1, so a bare origin gets it added. Any other path is
 * kept, for providers like OpenRouter (/api/v1) or Gemini (/v1beta/openai). */
export function normalizeAiBaseUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.pathname === "/" && !url.search && !url.hash) return `${trimmed}/v1`;
  } catch {}
  return trimmed;
}

function validAiPrefs(value: unknown): Partial<AiCategorizationPrefs> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return {
    // Saved before the switch, "off" was a mode: it reads as switched off, and either other mode as on.
    ...(typeof raw.enabled === "boolean"
      ? { enabled: raw.enabled }
      : raw.mode === "suggest" || raw.mode === "auto"
        ? { enabled: true }
        : {}),
    ...(raw.mode === "suggest" || raw.mode === "auto" ? { mode: raw.mode } : {}),
    ...(typeof raw.threshold === "number" && raw.threshold >= 0 && raw.threshold <= 1
      ? { threshold: raw.threshold }
      : {}),
    ...(typeof raw.onImport === "boolean" ? { onImport: raw.onImport } : {}),
    ...(typeof raw.sendImage === "boolean" ? { sendImage: raw.sendImage } : {}),
    ...(typeof raw.aiConnectionId === "string" || raw.aiConnectionId === null
      ? { aiConnectionId: raw.aiConnectionId || null }
      : {}),
  };
}

export async function getAiCategorizationPrefs(): Promise<AiCategorizationPrefs> {
  const row = await prisma.setting.findUnique({ where: { key: AI_CATEGORIZATION_KEY } });
  return { ...DEFAULT_AI_CATEGORIZATION_PREFS, ...validAiPrefs(row?.value) };
}

export async function setAiCategorizationPrefs(patch: Partial<AiCategorizationPrefs>): Promise<AiCategorizationPrefs> {
  const next = { ...(await getAiCategorizationPrefs()), ...patch };
  await prisma.setting.upsert({
    where: { key: AI_CATEGORIZATION_KEY },
    create: { key: AI_CATEGORIZATION_KEY, value: next as unknown as Prisma.InputJsonValue },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

/** What Improved descriptions may change. Generating needs the image, so it only applies when that's sent. */
export type AiDescriptionActions = {
  removeSelfPromotion: boolean;
  removeUnrelated: boolean;
  translate: boolean;
  generateMissing: boolean;
  fixSpelling: boolean;
  improveFormatting: boolean;
};

export type AiDescriptionPrefs = {
  enabled: boolean;
  /** Auto applies a rewrite straight away; the original is kept either way, so it can be reverted. */
  mode: AiCategorizationMode;
  onImport: boolean;
  sendImage: boolean;
  aiConnectionId: string | null;
  actions: AiDescriptionActions;
};

const AI_DESCRIPTIONS_KEY = "ai_descriptions";
export const DEFAULT_AI_DESCRIPTION_PREFS: AiDescriptionPrefs = {
  enabled: false,
  mode: "suggest",
  onImport: true,
  sendImage: false,
  aiConnectionId: null,
  actions: {
    removeSelfPromotion: true,
    removeUnrelated: true,
    translate: true,
    generateMissing: false,
    fixSpelling: true,
    improveFormatting: true,
  },
};

function validAiDescriptionPrefs(value: unknown): Partial<AiDescriptionPrefs> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const actions = raw.actions && typeof raw.actions === "object" ? (raw.actions as Record<string, unknown>) : {};
  return {
    ...(typeof raw.enabled === "boolean" ? { enabled: raw.enabled } : {}),
    ...(raw.mode === "suggest" || raw.mode === "auto" ? { mode: raw.mode } : {}),
    ...(typeof raw.onImport === "boolean" ? { onImport: raw.onImport } : {}),
    ...(typeof raw.sendImage === "boolean" ? { sendImage: raw.sendImage } : {}),
    ...(typeof raw.aiConnectionId === "string" || raw.aiConnectionId === null
      ? { aiConnectionId: raw.aiConnectionId || null }
      : {}),
    actions: Object.fromEntries(
      Object.entries(DEFAULT_AI_DESCRIPTION_PREFS.actions).map(([key, fallback]) => [
        key,
        typeof actions[key] === "boolean" ? actions[key] : fallback,
      ]),
    ) as AiDescriptionActions,
  };
}

export async function getAiDescriptionPrefs(): Promise<AiDescriptionPrefs> {
  const row = await prisma.setting.findUnique({ where: { key: AI_DESCRIPTIONS_KEY } });
  return { ...DEFAULT_AI_DESCRIPTION_PREFS, ...validAiDescriptionPrefs(row?.value) };
}

export async function setAiDescriptionPrefs(
  patch: Partial<Omit<AiDescriptionPrefs, "actions">> & { actions?: Partial<AiDescriptionActions> },
): Promise<AiDescriptionPrefs> {
  const current = await getAiDescriptionPrefs();
  const next = { ...current, ...patch, actions: { ...current.actions, ...patch.actions } };
  await prisma.setting.upsert({
    where: { key: AI_DESCRIPTIONS_KEY },
    create: { key: AI_DESCRIPTIONS_KEY, value: next as unknown as Prisma.InputJsonValue },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

const AUTH_TOKEN_TTL_KEY = "auth_token_ttl_seconds";
const DEFAULT_AUTH_TOKEN_TTL_SECONDS = 43200;

// Seeds from AUTH_TOKEN_TTL until an admin saves a value. Only affects newly issued tokens.
export async function getAuthTokenTtl(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: AUTH_TOKEN_TTL_KEY } });
  const value = row?.value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.trunc(value);
  return envInt("AUTH_TOKEN_TTL", DEFAULT_AUTH_TOKEN_TTL_SECONDS);
}

export async function setAuthTokenTtl(seconds: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: AUTH_TOKEN_TTL_KEY },
    create: { key: AUTH_TOKEN_TTL_KEY, value: seconds },
    update: { value: seconds },
  });
}

const REMEMBER_SESSION_TTL_KEY = "remember_session_ttl_seconds";
const DEFAULT_REMEMBER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** How long a browser stays signed in without being used. 0 is off: it signs in again when its access token runs out. */
export async function getRememberSessionTtl(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: REMEMBER_SESSION_TTL_KEY } });
  const value = row?.value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  return Math.max(0, envInt("REMEMBER_SESSION_TTL", DEFAULT_REMEMBER_SESSION_TTL_SECONDS));
}

export async function setRememberSessionTtl(seconds: number): Promise<void> {
  await prisma.setting.upsert({
    where: { key: REMEMBER_SESSION_TTL_KEY },
    create: { key: REMEMBER_SESSION_TTL_KEY, value: seconds },
    update: { value: seconds },
  });
}
