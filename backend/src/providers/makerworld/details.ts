import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../../config";
import { makerworldMetaFromDesign, resolveMakerworldCookie } from "./pageData";
import { HttpError } from "../../utils/fileUtils";
import manifest from "./manifest.generated";
import type { ProviderDetails } from "../types";
import { MAKERWORLD_AUTH_CODE, MakerworldAuthError, MakerworldCaptchaError } from "./api";
import { fetchMakerworldDesignForImport } from "./pages";
import { getUserMakerworldCookie } from "./session";

/** Read with the user's cookie where they gave one, its page otherwise; each read paces itself against the CAPTCHA. */
export const makerworldDetails: ProviderDetails = {
  async read(userId, designId) {
    const cookie = resolveMakerworldCookie({ makerworld_cookie: await getUserMakerworldCookie(userId) });
    const design = await fetchMakerworldDesignForImport(designId, cookie, IMPORT_MAKERWORLD_CALL_DELAY_MS);
    if (!design) throw new HttpError(400, `Couldn't read this model from ${manifest.name}`);
    return makerworldMetaFromDesign(design);
  },
  missingMessage: `This ${manifest.name} model could not be found, or isn't public.`,
  async mapError(_userId, err) {
    if (err instanceof MakerworldCaptchaError) return new HttpError(429, err.message);
    // 400, not 401: the frontend treats any 401 as an expired Thingport session and logs out.
    if (err instanceof MakerworldAuthError) return new HttpError(400, err.message, MAKERWORLD_AUTH_CODE);
    return err;
  },
};
