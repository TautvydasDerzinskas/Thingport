// An older import's licence, read again. Apart from license.ts, which the Thing's metadata reads its licence with.

import { IMPORT_HTML_MAX_BYTES, IMPORT_TIMEOUT_SECONDS } from "../../config";
import type { ProviderLicense } from "../../services/licenseCatalog";
import { isCloudflareChallenge } from "../../services/flaresolverr";
import { browserFetch } from "../../utils/browserFetch";
import { readCapped } from "../../utils/readCapped";
import { fetchThingiverseThing, ThingiverseRateLimitError } from "./api";
import { thingiverseLicenseFrom, thingiverseLicenseFromPage } from "./license";
import { getThingiverseAccessToken } from "./token";
import { thingiverseThingUrl } from "./urls.generated";

/** From the API with the instance's App Token, one request; without one, from the Thing's public page, which needs no
 *  token (Chrome's handshake gets it past Cloudflare). Null for a Thing that's gone; a refusal is thrown. */
export async function readThingiverseLicense(
  _userId: string,
  thingId: string,
  _stored: { notes: string | null },
): Promise<ProviderLicense | null> {
  const token = await getThingiverseAccessToken();
  if (token) {
    const thing = await fetchThingiverseThing(thingId, token);
    return thing ? (thingiverseLicenseFrom(thing) ?? null) : null;
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
  const { buffer } = await readCapped(res, IMPORT_HTML_MAX_BYTES);
  // A Thing it doesn't have is a page without the data, answered 200.
  return thingiverseLicenseFromPage(buffer.toString("utf-8")) ?? null;
}
