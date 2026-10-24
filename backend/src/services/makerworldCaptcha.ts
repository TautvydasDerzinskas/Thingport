import { MANIFESTS } from "../providers/_generated";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// MakerWorld's anti-abuse layer (separate from Cloudflare) answers a flagged request with a JSON
// body naming a captchaId, under either HTTP 418 or 200. It can't be solved without a real
// browser, so it's detected by shape and reported instead of surfacing as "no file found".
// The cloud API and collection listing share one cooldown so one can't re-trip the other.
// Only a captcha key or the reply's own error text counts: a design whose title or summary says
// "robot" would otherwise fail as a CAPTCHA on every retry, and start the cooloff for everyone.
// The key needs a value too, so a flag like {"captchaRequired": false} isn't a challenge.
export function isCaptchaChallenge(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (Object.entries(data).some(([key, value]) => key.toLowerCase().includes("captcha") && Boolean(value))) {
    return true;
  }
  return ["error", "message", "msg"].some((key) => {
    const value = data[key];
    return typeof value === "string" && /captcha|robot/i.test(value);
  });
}

export const MAKERWORLD_CAPTCHA_MESSAGE =
  "MakerWorld is challenging this account with a CAPTCHA before it will hand over a download link. " +
  "This can't be solved automatically. Open the model on makerworld.com, click the arrow next to " +
  '"Open in Bambu Studio", choose "Download 3MF" and solve the puzzle -- that usually clears it -- ' +
  "then retry the import.";

// The block is IP-scoped and clears on its own after 1-4 hours; retrying into it extends it.
// The cooloff only needs to stop a batch import hammering a known block, so 2h is enough.
const CAPTCHA_COOLOFF_MS = 2 * 60 * 60 * 1000;
// Any member's retry can lift the cooloff, and it's shared: without a gap, clicking Retry over and
// over would send MakerWorld a request each time and keep extending the block.
const MANUAL_LIFT_INTERVAL_MS = 5 * 60 * 1000;
let captchaBlockedUntil = 0;
let lastManualLift = 0;

export function makerworldCaptchaCooloffActive(): boolean {
  return Date.now() < captchaBlockedUntil;
}

export function noteCaptchaChallenge(): void {
  captchaBlockedUntil = Date.now() + CAPTCHA_COOLOFF_MS;
}

/** For a run someone starts by hand: they may have just solved the puzzle in the browser, which
 *  the cooloff can't know. A block that's still there costs one request before it trips again, and
 *  until MANUAL_LIFT_INTERVAL_MS has passed another start or retry fails on the cooloff instead. */
export function liftCaptchaCooloffByHand(): void {
  if (!makerworldCaptchaCooloffActive() || Date.now() - lastManualLift < MANUAL_LIFT_INTERVAL_MS) return;
  lastManualLift = Date.now();
  captchaBlockedUntil = 0;
}

export function resetCaptchaCooloffForTest(): void {
  captchaBlockedUntil = 0;
  lastManualLift = 0;
}

export class MakerworldCaptchaError extends Error {
  constructor() {
    super(MAKERWORLD_CAPTCHA_MESSAGE);
    this.name = "MakerworldCaptchaError";
  }
}

// The per-account daily download cap: HTTP 400 with {"code":-1,"error":"You've reached your daily
// download limit."}. Every later download fails the same way until it resets.
export function isDownloadLimitReply(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return ["error", "message", "msg"].some(
    (key) => typeof data[key] === "string" && /download limit/i.test(data[key] as string),
  );
}

export const MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE =
  "MakerWorld daily download limit reached for this account. Try again tomorrow.";

// The HttpError code, so batch runners can tell it from a CAPTCHA (both are 429).
export const MAKERWORLD_DOWNLOAD_LIMIT_CODE = MANIFESTS.makerworld.errorCodes.downloadLimit;
// On the 400 a MakerworldAuthError becomes, so a queued import can tell it from a bad link.
export const MAKERWORLD_AUTH_CODE = MANIFESTS.makerworld.errorCodes.session;

export class MakerworldDownloadLimitError extends Error {
  constructor() {
    super(MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE);
    this.name = "MakerworldDownloadLimitError";
  }
}

export class MakerworldAuthError extends Error {
  constructor() {
    super("Your MakerWorld session has expired or was rejected. Update the cookie in Settings and try again.");
    this.name = "MakerworldAuthError";
  }
}
