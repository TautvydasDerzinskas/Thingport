// An older import's licence, read again. Apart from license.ts, which the Thing's metadata reads its licence with.

import { IMPORT_HTML_MAX_BYTES, IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ProviderLicense } from "../../services/licenseCatalog";
import { isCloudflareChallenge } from "../../services/flaresolverr";
import { browserFetch } from "../../utils/browserFetch";
import { readCapped } from "../../utils/readCapped";
import { fetchThingiverseThing, ThingiverseAuthError, ThingiverseRateLimitError } from "./api";
import { thingiverseLicenseFrom, thingiverseLicenseFromPage } from "./license";
import { getThingiverseAccessToken } from "./token";
import { thingiverseThingUrl } from "./urls.generated";

/** From the API with the instance's App Token, one request; without one, or with one it turns down, from the Thing's
 *  public page, which needs no token (Chrome's handshake gets it past Cloudflare). Null for a Thing that's gone or names no licence; undefined
 *  for a page without the Thing's data, which can't tell; a refusal is thrown. */
export async function readThingiverseLicense(
  _userId: string,
  thingId: string,
  _stored: { notes: string | null },
): Promise<ProviderLicense | null | undefined> {
  const token = await getThingiverseAccessToken();
  if (token) {
    try {
      const thing = await fetchThingiverseThing(thingId, token);
      // A Thing answered without the field can't tell: read again later.
      return thing ? thingiverseLicenseFrom(thing) : null;
    } catch (err) {
      // A token Thingiverse turned down: the public page needs none.
      if (!(err instanceof ThingiverseAuthError)) throw err;
    }
  }
  const res = await browserFetch(thingiverseThingUrl(thingId), {
    headers: { Accept: "text/html" },
    timeoutMs: IMPORT_TIMEOUT_SECONDS * 1000,
  });
  if (res.status === 429 || isCloudflareChallenge(res.headers)) {
    await res.body?.cancel().catch(() => undefined);
    throw new ThingiverseRateLimitError();
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Thingiverse answered HTTP ${res.status}`);
  }
  const { buffer, truncated } = await readCapped(res, IMPORT_HTML_MAX_BYTES);
  const license = thingiverseLicenseFromPage(buffer.toString("utf-8"));
  // Cut off, a page may hold the licence past where it was read: anything short of one is a read that failed.
  if (!license && truncated) throw new Error("Thingiverse's page was cut off before its licence");
  // A page without the Thing's data, answered 200, is a Thing it doesn't have, or a page that changed: read again later.
  return license;
}
