import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Storage-template settings (get/setStorageTemplate) live in printService.ts — not duplicated here.

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

const ALLOW_REGISTRATIONS_KEY = "allow_registrations";

export async function getAllowRegistrations(fallback: boolean): Promise<boolean> {
  return getBoolSetting(ALLOW_REGISTRATIONS_KEY, fallback);
}

export async function setAllowRegistrations(value: boolean): Promise<void> {
  await setBoolSetting(ALLOW_REGISTRATIONS_KEY, value);
}

export type PreviewMode = "automatic" | "on-demand" | "disabled";
const PREVIEW_MODES = new Set<PreviewMode>(["automatic", "on-demand", "disabled"]);
const PREVIEW_MODE_KEY = "preview_mode";
const DEFAULT_PREVIEW_MODE: PreviewMode = "automatic";

// Instance-wide (not per-user): every browser hitting this API generates/serves previews
// against the same storage, so letting each user pick their own mode would just mean the last
// save wins anyway. Admin-configured instead, like the storage template above.
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

// Instance-wide, not per-user: it's a credential for api.thingiverse.com (the official
// Developer API -- see thingiverseApi.ts), tied to whichever Thingiverse account registered
// the app at thingiverse.com/apps/create, not to any one Thingport user's own account. Every
// user's Thingiverse imports share it, same as the storage template and preview mode above.
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

// Seeds from SMTP_HOST/SMTP_PORT/SMTP_SECURE/SMTP_USER/SMTP_PASS/SMTP_FROM the first time this is
// read on a fresh instance -- once an admin saves anything via PATCH /settings/smtp, the DB row
// becomes the sole source of truth (see setSmtpSettings) and these env vars are no longer
// consulted, same pattern as the storage template / preview mode / Thingiverse token above.
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

const AUTH_TOKEN_TTL_KEY = "auth_token_ttl_seconds";
// Matches the old AUTH_TOKEN_TTL env default (12 hours) -- used only when neither a DB row nor
// the env var itself is set.
const DEFAULT_AUTH_TOKEN_TTL_SECONDS = 43200;

// How long a signed-in session's token stays valid before requiring another login (see
// auth.ts's issueToken, which every login/register/verify route goes through). Seeds from the
// AUTH_TOKEN_TTL env var the first time this is read on a fresh instance -- once an admin saves
// a value via PATCH /settings/auth (AdminSettingsPage's Session section), the DB row becomes the
// sole source of truth, same pattern as SMTP/preview mode/Thingiverse token above. Changing this
// only affects tokens issued *after* the change; anyone already signed in keeps whatever TTL was
// active when their token was issued, since that's baked into the JWT itself.
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

// Database connection info + the live "Test & Save" switch live in databaseSettingsService.ts,
// not here -- unlike everything else in this file, it isn't just a Setting-table row; it needs
// db.ts's client-swap primitive and its own Postgres-specific connection testing.
