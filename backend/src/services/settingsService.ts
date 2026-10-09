import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

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

const THINGIVERSE_ACCESS_TOKEN_KEY = "thingiverse_access_token";

// Instance-wide: the token belongs to whichever Thingiverse account registered the app.
export async function getThingiverseAccessToken(): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key: THINGIVERSE_ACCESS_TOKEN_KEY } });
  const value = row?.value;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function setThingiverseAccessToken(value: string | null): Promise<void> {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    await prisma.setting.deleteMany({ where: { key: THINGIVERSE_ACCESS_TOKEN_KEY } });
    return;
  }
  await prisma.setting.upsert({
    where: { key: THINGIVERSE_ACCESS_TOKEN_KEY },
    create: { key: THINGIVERSE_ACCESS_TOKEN_KEY, value: trimmed },
    update: { value: trimmed },
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

export type AiCategorizationMode = "off" | "suggest" | "auto";
export type AiCategorizationSettings = {
  mode: AiCategorizationMode;
  baseUrl: string | null;
  apiKey: string | null;
  model: string | null;
  threshold: number;
  onImport: boolean;
  concurrency: number;
  sendImage: boolean;
  timeoutMs: number;
};

const AI_CATEGORIZATION_KEY = "ai_categorization";
export const DEFAULT_AI_CATEGORIZATION_SETTINGS: AiCategorizationSettings = {
  mode: "off",
  baseUrl: null,
  apiKey: null,
  model: null,
  threshold: 0.8,
  onImport: true,
  concurrency: 1,
  sendImage: false,
  timeoutMs: 60000,
};

function validAiSettings(value: unknown): Partial<AiCategorizationSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return {
    ...(raw.mode === "off" || raw.mode === "suggest" || raw.mode === "auto" ? { mode: raw.mode } : {}),
    ...(typeof raw.baseUrl === "string" || raw.baseUrl === null ? { baseUrl: raw.baseUrl?.trim() || null } : {}),
    ...(typeof raw.apiKey === "string" || raw.apiKey === null ? { apiKey: raw.apiKey?.trim() || null } : {}),
    ...(typeof raw.model === "string" || raw.model === null ? { model: raw.model?.trim() || null } : {}),
    ...(typeof raw.threshold === "number" && raw.threshold >= 0 && raw.threshold <= 1
      ? { threshold: raw.threshold }
      : {}),
    ...(typeof raw.onImport === "boolean" ? { onImport: raw.onImport } : {}),
    ...(typeof raw.concurrency === "number" &&
    Number.isInteger(raw.concurrency) &&
    raw.concurrency >= 1 &&
    raw.concurrency <= 4
      ? { concurrency: raw.concurrency }
      : {}),
    ...(typeof raw.sendImage === "boolean" ? { sendImage: raw.sendImage } : {}),
    ...(typeof raw.timeoutMs === "number" && Number.isInteger(raw.timeoutMs) && raw.timeoutMs > 0
      ? { timeoutMs: raw.timeoutMs }
      : {}),
  };
}

export async function getAiCategorizationSettings(): Promise<AiCategorizationSettings> {
  const row = await prisma.setting.findUnique({ where: { key: AI_CATEGORIZATION_KEY } });
  return { ...DEFAULT_AI_CATEGORIZATION_SETTINGS, ...validAiSettings(row?.value) };
}

export async function setAiCategorizationSettings(
  patch: Partial<AiCategorizationSettings>,
): Promise<AiCategorizationSettings> {
  const next = { ...(await getAiCategorizationSettings()), ...patch };
  await prisma.setting.upsert({
    where: { key: AI_CATEGORIZATION_KEY },
    create: { key: AI_CATEGORIZATION_KEY, value: next as unknown as Prisma.InputJsonValue },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export function aiCategorizationEnabled(settings: AiCategorizationSettings): boolean {
  return settings.mode !== "off" && Boolean(settings.baseUrl && settings.model);
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
