import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

// Load .env before any export below reads process.env. Without this, values only worked when
// @prisma/client happened to load .env first.
dotenv.config();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** cgroup v2, then v1. Unlimited ("max", a near-2^63 sentinel, or >= machine RAM) returns null. */
export function cgroupMemoryLimitBytes(): number | null {
  for (const file of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const value = Number(fs.readFileSync(file, "utf-8").trim());
      if (Number.isFinite(value) && value > 0 && value < os.totalmem()) return value;
    } catch {}
  }
  return null;
}

/** Half the usable memory (container limit, else RAM), clamped to 256 MB-2 GB. */
function defaultPreviewMemoryMb(): number {
  const available = cgroupMemoryLimitBytes() ?? os.totalmem();
  return Math.min(2048, Math.max(256, Math.floor(available / 2 / (1024 * 1024))));
}

export const STORAGE = path.resolve(process.env.FILE_STORAGE || "./storage");
// Watched only while it exists, i.e. when the Docker setup mounts a host folder there.
export const CONSUME_DIR = path.resolve(process.env.CONSUME_DIR || "/app/consume");
export const THUMBS = path.join(STORAGE, "thumbs");
export const BUNDLES = path.join(STORAGE, "bundles");
export const PREVIEWS = path.join(STORAGE, "previews");
export const DESCRIPTION_IMAGES = path.join(STORAGE, "description-images");
export const MODEL_PREVIEWS = path.join(STORAGE, "model-previews");
// One picture per tag for the Tags page, built from its models' pictures.
export const TAG_MOSAICS = path.join(STORAGE, "tag-mosaics");
// Slicer-compatible copies of MakerWorld 3MFs, rebuilt when the source plate changes.
export const NORMALIZED_3MFS = path.join(STORAGE, "normalized-3mf");
// Large multi-part projects take minutes on a slow CPU; the page waits for it, not the request.
export const NORMALIZE_3MF_TIMEOUT_SECONDS = envInt("NORMALIZE_3MF_TIMEOUT_SECONDS", 600);
// Past either limit the render worker is killed and the plate gets no 3D preview. Memory is a
// watchdog check, so a fast burst can overshoot it briefly.
export const MODEL_PREVIEW_MAX_MEMORY_MB = envInt("MODEL_PREVIEW_MAX_MEMORY_MB", defaultPreviewMemoryMb());
export const MODEL_PREVIEW_TIMEOUT_SECONDS = envInt("MODEL_PREVIEW_TIMEOUT_SECONDS", 180);

// Only the first run's value: it's copied into the database, and managed there (Admin > Auth) from then on.
export const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");

export const AUTH_SECRET = process.env.AUTH_SECRET || "changeme-secret";
export const AUTH_ALGO = "HS256" as const;

export const IMPORT_ALLOWED_EXTS = new Set([".stl", ".3mf", ".step", ".stp", ".obj", ".lbrn", ".lbrn2", ".zip"]);
// Mirrors frontend's MODEL_EXTS. Other files in a multi-file upload become SUPPORTING files.
export const RENDERABLE_MODEL_EXTS = new Set([".stl", ".3mf", ".step", ".stp", ".obj"]);
// Mirrors frontend's UPLOAD_EXTS: what becomes a model on its own.
export const UPLOADABLE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".gif",
  ".svg",
  ".stl",
  ".step",
  ".stp",
  ".3mf",
  ".obj",
  ".f3d",
  ".lbrn",
  ".lbrn2",
  ".zip",
]);
export const IMPORT_EXT_PRIORITY = [".3mf", ".stl", ".step", ".stp", ".lbrn2", ".lbrn", ".zip"];
export const IMPORT_BLOCKED_EXTS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".jfif",
  ".tif",
  ".tiff",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".json",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);
export const IMPORT_TIMEOUT_SECONDS = envInt("IMPORT_TIMEOUT_SECONDS", 30);
export const IMPORT_MAX_MB = envInt("IMPORT_MAX_MB", 512);
export const IMPORT_MAX_BYTES = Math.max(1, IMPORT_MAX_MB) * 1024 * 1024;
export const IMPORT_HTML_MAX_KB = envInt("IMPORT_HTML_MAX_KB", 4096);
export const IMPORT_HTML_MAX_BYTES = Math.max(64, IMPORT_HTML_MAX_KB) * 1024;
// Gap between items in a batch import, to avoid anti-abuse bursts.
export const IMPORT_COLLECTION_DELAY_MS = envInt("IMPORT_COLLECTION_DELAY_MS", 1000);
// MakerWorld's CAPTCHA trips on bursts, so in collection imports this delay precedes every
// MakerWorld request (listing pages, each resolution step, each image), not just each model.
export const IMPORT_MAKERWORLD_CALL_DELAY_MS = envInt("IMPORT_MAKERWORLD_CALL_DELAY_MS", 5000);
// Synced collections are checked on each one's own interval; "false" turns the scheduled sync off
// ("Sync now" still works).
export const COLLECTION_SYNC_ENABLED = (process.env.COLLECTION_SYNC_ENABLED ?? "").trim().toLowerCase() !== "false";
// Gap between the models a sync imports. Nobody is waiting on it, so it can be long.
export const COLLECTION_SYNC_ITEM_DELAY_MS = envInt("COLLECTION_SYNC_ITEM_DELAY_MS", 60_000);
// Gap between a single import's preview-image fetches (up to ~20 per model).
export const IMPORT_PREVIEW_IMAGE_DELAY_MS = envInt("IMPORT_PREVIEW_IMAGE_DELAY_MS", 250);
export const IMPORT_USER_AGENT = "Thingport/1.0";
export const IMPORT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export const FLARESOLVERR_URL = (process.env.FLARESOLVERR_URL || "").trim();
export const FLARESOLVERR_TIMEOUT_MS = envInt("FLARESOLVERR_TIMEOUT_MS", 60000);
export const FLARESOLVERR_SESSION_TTL_MS = envInt("FLARESOLVERR_SESSION_TTL_MS", 15 * 60 * 1000);

export const DEFAULT_SYSTEM_NOTIFICATIONS_URL =
  "https://raw.githubusercontent.com/TautvydasDerzinskas/Thingport/main/system-notifications.json";
// Announcements for admins, e.g. known bugs. Set to an empty value to stop fetching them.
export const SYSTEM_NOTIFICATIONS_URL = (
  process.env.SYSTEM_NOTIFICATIONS_URL ?? DEFAULT_SYSTEM_NOTIFICATIONS_URL
).trim();

export const API_PORT = envInt("API_PORT", 8000);
