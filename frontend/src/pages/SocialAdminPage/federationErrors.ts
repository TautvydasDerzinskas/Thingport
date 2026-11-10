import type { TFunction } from "i18next";
import { FederationError } from "../../api/federation";

/** A federation failure in the viewer's language where its code has a message, else the server's own words. */
export function federationErrorText(err: unknown, t: TFunction<["app", "common"]>): string {
  const fallback = err instanceof Error ? err.message : String(err);
  if (err instanceof FederationError && err.code) {
    return t(`adminSettings.social.federation.errors.${err.code}`, { defaultValue: fallback });
  }
  return fallback;
}
