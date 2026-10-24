import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../../config";
import { makerworldMetaFromDesign, resolveMakerworldCookie } from "./pageData";
import { HttpError } from "../../utils/fileUtils";
import manifest from "../_generated/makerworld/manifest";
import type { ProviderDetails } from "../types";
import {
  extractMakerworldBearerToken,
  fetchMakerworldDesignAuthor,
  makerworldCaptchaCooloffActive,
  MakerworldAuthError,
  MakerworldCaptchaError,
} from "./api";
import { fetchMakerworldDesignForImport, fetchMakerworldPageAuthor } from "./pages";
import { getUserMakerworldCookie } from "./session";

/** Read with the user's cookie where they gave one, its page otherwise; each read paces itself against the CAPTCHA. */
export const makerworldDetails: ProviderDetails = {
  async read(userId, designId) {
    const cookie = resolveMakerworldCookie({ makerworld_cookie: await getUserMakerworldCookie(userId) });
    const design = await fetchMakerworldDesignForImport(designId, cookie, IMPORT_MAKERWORLD_CALL_DELAY_MS);
    if (!design) throw new HttpError(400, `Couldn't read this model from ${manifest.name}`);
    return makerworldMetaFromDesign(design);
  },
  async author(userId, designId) {
    const cookie = await getUserMakerworldCookie(userId);
    const bearer = extractMakerworldBearerToken(cookie);
    return bearer
      ? fetchMakerworldDesignAuthor(designId, bearer, IMPORT_MAKERWORLD_CALL_DELAY_MS)
      : fetchMakerworldPageAuthor(designId, cookie, IMPORT_MAKERWORLD_CALL_DELAY_MS);
  },
  missingMessage: `This ${manifest.name} model could not be found, or isn't public.`,
  unavailable: { check: async () => (makerworldCaptchaCooloffActive() ? "makerworld_captcha" : null) },
  problemOf(err) {
    if (err instanceof MakerworldCaptchaError) return { problem: "makerworld_captcha" };
    if (err instanceof MakerworldAuthError) return { problem: "makerworld_login_rejected" };
    return null;
  },
  pacesItself: true,
};
