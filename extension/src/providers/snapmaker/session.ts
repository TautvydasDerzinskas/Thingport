// The user's Snapmaker Space sign-in, which downloads its files and reads their likes and bookmarks. Snapmaker's
// access token lasts a day, and its refresh tokens work once: whoever renews with one signs out anyone else holding
// it. So Grab is the only one that renews, for the browser and Thingport both: it writes the new tokens back into the
// browser's cookies, where the site picks them up, and sends the access token on. Thingport never renews it itself.
// Its China site has accounts of its own, renewed by its own sign-in host, which go to the sign-in named after it.

import { providerCredentialRequest } from "../../shared/providerCredentialRequest";
import { OPTIONAL_SITES, regionEnabled, siteEnabled } from "../../shared/optionalSites";
import type { SessionSource } from "../../background/sessionSync";
import { MANIFESTS, type RegionId } from "../index.generated";

const { snapmaker } = MANIFESTS;
const ACCESS_COOKIE = snapmaker.sessionCookies.token;
const REFRESH_COOKIE = snapmaker.sessionCookies.refresh;
// The site's own public client, as its pages send it ("mall-app"), on both sites; it isn't a secret.
const CLIENT_AUTH = "Basic bWFsbC1hcHA6MTIzNDU2";
// As the site sets them: the access token's cookie for 8 hours, the refresh token's for 30 days.
const ACCESS_COOKIE_MS = 8 * 60 * 60 * 1000;
const REFRESH_COOKIE_MS = 30 * 24 * 60 * 60 * 1000;
// Renewed this long before the token Thingport holds runs out, so a check that misses a beat still keeps it valid.
const RENEW_BEFORE_MS = 8 * 60 * 60 * 1000;

export const SNAPMAKER_ALARM = "snapmaker-session";
const ALARM_PERIOD_MINUTES = 120;

const CHINA = snapmaker.regions[0];
/** Where a site's sign-in lives and is renewed: its pages, the domain its cookies are on, and its token endpoint. */
const SITES = {
  main: { site: snapmaker.site, domain: snapmaker.hosts[0], tokenUrl: snapmaker.endpoints.token },
  cn: { site: CHINA.site, domain: CHINA.hosts[0], tokenUrl: CHINA.endpoints.token },
};

function tokenPayload(token: string): { exp: number | null; userId: string | null } {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(part)) as { exp?: unknown; userId?: unknown };
    return {
      exp: typeof payload.exp === "number" ? payload.exp * 1000 : null,
      userId: typeof payload.userId === "number" || typeof payload.userId === "string" ? String(payload.userId) : null,
    };
  } catch {
    return { exp: null, userId: null };
  }
}

/** Whether Grab may read and renew a site's sign-in: its origins allowed. */
async function allowed(region: RegionId | null): Promise<boolean> {
  const site = OPTIONAL_SITES.find((s) => s.id === snapmaker.id);
  if (!site) return false;
  return (region ? regionEnabled(site, region) : siteEnabled(site)).catch(() => false);
}

/** One of its sites' sign-in: read from that site's cookies, renewed with its own token endpoint. */
function siteSession(region: RegionId | null): SessionSource {
  const { site, domain, tokenUrl } = SITES[region ?? "main"];

  async function readCookie(name: string): Promise<string | null> {
    try {
      const cookie = await chrome.cookies.get({ url: site, name });
      return cookie?.value ? decodeURIComponent(cookie.value) : null;
    } catch {
      return null;
    }
  }

  async function writeCookie(name: string, value: string, lifetimeMs: number): Promise<void> {
    await chrome.cookies.set({
      url: site,
      name,
      value: encodeURIComponent(value),
      domain: `.${domain}`,
      path: "/",
      secure: true,
      sameSite: "no_restriction",
      expirationDate: (Date.now() + lifetimeMs) / 1000,
    });
  }

  /** A new access token for the browser's refresh token, written back where the site reads it. Null when Snapmaker
   *  turns it down: the user signed out, or the site renewed it a moment before. */
  async function renew(): Promise<string | null> {
    // Read right before it's spent: a tab of the site may have just renewed it.
    const refresh = await readCookie(REFRESH_COOKIE);
    if (!refresh) return null;
    const res = await providerCredentialRequest("snapmaker-id", tokenUrl, {
      method: "POST",
      headers: {
        Authorization: CLIENT_AUTH,
        "Content-Type": "application/x-www-form-urlencoded",
        "x-custom-site": "Web-Space",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }).toString(),
    });
    const body = (await res.json().catch(() => null)) as {
      code?: number;
      data?: { access_token?: string; refresh_token?: string };
    } | null;
    const access = body?.code === 200 ? body.data?.access_token : undefined;
    if (!access) return null;
    await writeCookie(ACCESS_COOKIE, access, ACCESS_COOKIE_MS);
    if (body?.data?.refresh_token) await writeCookie(REFRESH_COOKIE, body.data.refresh_token, REFRESH_COOKIE_MS);
    return access;
  }

  /** The browser's token, renewed first when it, or the one Thingport has, is running out. Null when there's none. */
  async function freshToken(): Promise<string | null> {
    let token = await readCookie(ACCESS_COOKIE);
    // The site drops its cookie after 8 hours, well before the token itself runs out; Thingport only ever has a
    // token Grab sent, so renewing the browser's when it's near its end keeps Thingport's fresh too.
    const exp = token ? tokenPayload(token).exp : null;
    if (!token || !exp || exp < Date.now() + RENEW_BEFORE_MS) token = (await renew().catch(() => null)) ?? token;
    return token;
  }

  // Shared by concurrent callers, so two of them can't both spend the same single-use refresh token.
  let inFlight: Promise<string | null> | null = null;

  return {
    async read() {
      if (!(await allowed(region))) return undefined;
      inFlight ??= freshToken().finally(() => {
        inFlight = null;
      });
      const token = await inFlight;
      return token ? { value: token, body: { token }, userId: tokenPayload(token).userId } : undefined;
    },
    ...(region ? { slot: region } : {}),
  };
}

export const snapmakerSession = siteSession(null);
export const snapmakerChinaSession = siteSession(CHINA.id);

/** Keeps the sign-in fresh while the browser runs, Snapmaker visited or not; the China site's too, where its own
 *  read finds it allowed. */
export async function scheduleSnapmakerRenewal(): Promise<void> {
  const enabled = await allowed(null);
  const existing = await chrome.alarms.get(SNAPMAKER_ALARM);
  if (enabled && !existing) {
    await chrome.alarms.create(SNAPMAKER_ALARM, { delayInMinutes: 1, periodInMinutes: ALARM_PERIOD_MINUTES });
  } else if (!enabled && existing) {
    await chrome.alarms.clear(SNAPMAKER_ALARM);
  }
}
