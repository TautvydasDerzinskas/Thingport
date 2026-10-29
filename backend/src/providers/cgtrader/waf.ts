import { cookiesViaFlaresolverr } from "../../services/flaresolverr";
import manifest from "./manifest.generated";

// AWS's bot check (its WAF) in front of CGTrader. It challenges the downloads, and the CG catalogue's pages, of anyone
// without a token: a 202 with `x-amzn-waf-action: challenge` and an empty page whose script works the challenge out
// in a browser and sets the token as the `aws-waf-token` cookie. The token isn't bound to the address or the browser
// that got it, so the backend sends one as a cookie like any other -- the browser's, which Grab hands over with the
// sign-in, or its own, got by letting FlareSolverr's browser run the challenge. A token lasts a good while, but one
// that has asked for a lot in a short time is challenged too, until it comes back with a fresh one: so a challenge is
// answered with a fresh token.

const WAF_COOKIE = manifest.sessionCookies.waf;
// Challenged, whoever asks: the download of a file that doesn't exist, which no one's sign-in opens and FlareSolverr's
// visit downloads nothing by.
const CHALLENGE_URL = `${manifest.site}/items/1/free-downloads/1`;
// Its script takes a few seconds; FlareSolverr doesn't know to wait for it.
const CHALLENGE_SECONDS = 6;
// After a fresh token didn't get past it either, the check is let be for a while rather than asked again per request.
const BLOCKED_PAUSE_MS = 2 * 60 * 1000;

let minted: { token: string; at: number } | null = null;
let minting: Promise<string | null> | null = null;
let blockedUntil = 0;

/** Whether an answer is the bot check's rather than the site's: a challenge, or the CAPTCHA it can ask for instead. */
export function isWafChallenge(headers: Headers): boolean {
  return headers.has("x-amzn-waf-action");
}

/** The freshest token Thingport has: the browser's, as Grab last sent it, or the one FlareSolverr got. */
export function wafTokenFor(browser: { waf: string | null; wafAt: number | null } | null): string | null {
  const own = browser?.waf ? { token: browser.waf, at: browser.wafAt ?? 0 } : null;
  if (!own) return minted?.token ?? null;
  return minted && minted.at > own.at ? minted.token : own.token;
}

/** A fresh token from FlareSolverr, once a challenge says the last one won't do; null when it isn't set up, it didn't
 *  get one, or a fresh one was just turned away too. One at a time: a batch's requests share it. */
export async function freshWafToken(): Promise<string | null> {
  if (Date.now() < blockedUntil) return null;
  minting ??= cookiesViaFlaresolverr(CHALLENGE_URL, CHALLENGE_SECONDS)
    .then((cookies) => {
      const token = cookies?.[WAF_COOKIE] || null;
      if (token) minted = { token, at: Date.now() };
      return token;
    })
    .finally(() => {
      minting = null;
    });
  return minting;
}

/** A fresh token was challenged too: the check is let be for a while. */
export function markWafBlocked(): void {
  blockedUntil = Date.now() + BLOCKED_PAUSE_MS;
}

/** Forgets the token FlareSolverr got and any pause. For the tests. */
export function forgetCgtraderWafToken(): void {
  minted = null;
  minting = null;
  blockedUntil = 0;
}
