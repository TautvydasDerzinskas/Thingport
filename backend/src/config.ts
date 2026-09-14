import path from "node:path";
import dotenv from "dotenv";

// Every value below reads straight from process.env at module-evaluation time (a one-shot
// `export const`, not a function called later) -- so .env has to be loaded before any of them,
// not just before the app "starts" in some general sense. There was no explicit .env loading
// anywhere in this codebase; local dev only worked at all because requiring @prisma/client has
// the side effect of loading .env too, and most existing config reads happened to be evaluated
// after something had already pulled in db.ts/@prisma/client first -- an accident of import
// order, not a guarantee. A newly added config.ts export (this file is always the first module
// in the graph to read env vars) can land ahead of that side effect and silently read an empty
// string forever, which is exactly what happened to FLARESOLVERR_URL. Loading .env explicitly,
// right here, removes the dependency on that accident entirely. (Docker Compose deployments are
// unaffected either way -- environment: entries are already real process env vars before the
// Node process even starts, so there's nothing for dotenv to add there; this only matters for
// `tsx watch src/server.ts`-style local dev reading a .env file.)
dotenv.config();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const STORAGE = path.resolve(process.env.FILE_STORAGE || "./storage");
export const THUMBS = path.join(STORAGE, "thumbs");
export const BUNDLES = path.join(STORAGE, "bundles");
export const PREVIEWS = path.join(STORAGE, "previews");
// Pre-rendered GLB caches for the interactive 3D preview (see services/modelPreviewCache.ts) --
// generated once per .3mf Plate so the viewer never has to re-parse a huge raw 3MF on every open.
export const MODEL_PREVIEWS = path.join(STORAGE, "model-previews");

// Base URL this instance is publicly reachable at -- needed to build absolute links in outgoing
// emails (e.g. the email-verification link), which unlike API responses can't rely on the
// request's own Origin. Left blank in single-machine/local setups where no email is ever sent.
export const PUBLIC_URL = (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");

export const AUTH_SECRET = process.env.AUTH_SECRET || "changeme-secret";
export const AUTH_TOKEN_TTL = envInt("AUTH_TOKEN_TTL", 43200);
export const AUTH_ALGO = "HS256" as const;

export const IMPORT_ALLOWED_EXTS = new Set([".stl", ".3mf", ".step", ".stp", ".obj", ".lbrn", ".lbrn2", ".zip"]);
// Extensions the 3D viewer can actually render as a Plate -- mirrors frontend's MODEL_EXTS
// (constants/fileTypes.ts). A multiplate upload splits on this: only these become Plates, and
// anything else (e.g. a bundled .f3d source file) is attached as a SUPPORTING PrintFile instead
// of being force-rendered as an unviewable "plate".
export const RENDERABLE_MODEL_EXTS = new Set([".stl", ".3mf", ".step", ".stp", ".obj"]);
export const IMPORT_EXT_PRIORITY = [".3mf", ".stl", ".step", ".stp", ".lbrn2", ".lbrn", ".zip"];
export const IMPORT_BLOCKED_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".jfif", ".tif", ".tiff",
  ".css", ".js", ".mjs", ".map", ".json", ".ico", ".woff", ".woff2", ".ttf", ".eot",
]);
export const IMPORT_TIMEOUT_SECONDS = envInt("IMPORT_TIMEOUT_SECONDS", 30);
export const IMPORT_MAX_MB = envInt("IMPORT_MAX_MB", 512);
export const IMPORT_MAX_BYTES = Math.max(1, IMPORT_MAX_MB) * 1024 * 1024;
export const IMPORT_HTML_MAX_KB = envInt("IMPORT_HTML_MAX_KB", 4096);
export const IMPORT_HTML_MAX_BYTES = Math.max(64, IMPORT_HTML_MAX_KB) * 1024;
// Pacing gap between items in a batch import (see importJobRunner.ts) -- exists to avoid the
// burst request pattern most likely to trip a source site's anti-abuse defenses. Overridable
// mainly so tests don't have to actually wait it out. Thingiverse hasn't shown MakerWorld's
// sensitivity to request volume, so it keeps this lighter, per-item-only pace.
export const IMPORT_COLLECTION_DELAY_MS = envInt("IMPORT_COLLECTION_DELAY_MS", 1000);
// MakerWorld's anti-abuse CAPTCHA (see makerworldCaptcha.ts's isCaptchaChallenge) has proven far
// more sensitive than a simple gap between models accounted for: a 146-item collection tripped
// it almost immediately once we traced the actual call sequence -- the collection-listing step
// alone (title + paginated entries) fires a dozen-plus unpaced requests before a single model
// import even starts, and each model's own resolution is itself another handful of calls
// (design, profile/download-link, author, file, up to ~20 preview images) with no gap between
// them. So this one pace applies to *every single outbound MakerWorld-related request* in a
// collection batch -- listing pages, each step of each model's resolution, and each preview
// image -- not just the boundary between models. Deliberately slow (5s * dozens of calls per
// model adds up) in exchange for actually working instead of tripping on request #1. Left unset
// (no delay) for single-model imports, which have not needed it.
export const IMPORT_MAKERWORLD_CALL_DELAY_MS = envInt("IMPORT_MAKERWORLD_CALL_DELAY_MS", 5000);
// Pacing gap between a single model's own preview-image fetches (attachImportedPreviewImages in
// importService.ts) when *not* part of a MakerWorld collection batch (which uses
// IMPORT_MAKERWORLD_CALL_DELAY_MS instead) -- up to ~20 of these fire back to back for one
// model (cover + gallery photos), which is its own small burst even for a single-model import.
// Kept far shorter than the MakerWorld batch pace: these are plain image/CDN fetches, not
// confirmed to share the same anti-abuse bucket as MakerWorld's design/download-resolution API
// -- this is a cheap precaution, not a proven-necessary one.
export const IMPORT_PREVIEW_IMAGE_DELAY_MS = envInt("IMPORT_PREVIEW_IMAGE_DELAY_MS", 250);
export const IMPORT_USER_AGENT = "Thingport/1.0";
export const IMPORT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export const FLARESOLVERR_URL = (process.env.FLARESOLVERR_URL || "").trim();
export const FLARESOLVERR_TIMEOUT_MS = envInt("FLARESOLVERR_TIMEOUT_MS", 60000);
export const FLARESOLVERR_SESSION_TTL_MS = envInt("FLARESOLVERR_SESSION_TTL_MS", 15 * 60 * 1000);

export const API_PORT = envInt("API_PORT", 8000);
