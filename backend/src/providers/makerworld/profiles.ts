import { IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../../config";
import { resolveMakerworldCookie } from "./pageData";
import type { ImportRequestBody } from "../../services/importService";
import { HttpError } from "../../utils/fileUtils";
import { decodeHtmlEntities } from "../../utils/htmlEntities";
import manifest from "./manifest.generated";
import { makerworldModelUrl } from "./urls.generated";
import { type MakerworldProfileScope, parseMakerworldModelUrl, selectMakerworldProfiles } from "./api";
import { fetchMakerworldDesignForImport } from "./pages";

/** A link per wanted print profile. A model with none has only its raw files, which the model's own link imports. */
export function makerworldProfileUrls(
  designId: string,
  design: Record<string, unknown>,
  scope: MakerworldProfileScope,
  requestedInstanceId: string | null,
): { urls: string[]; rawFiles: boolean } {
  const profileIds = selectMakerworldProfiles(design, scope, requestedInstanceId);
  if (!profileIds.length) return { urls: [makerworldModelUrl(designId)], rawFiles: true };
  return {
    urls: profileIds.map((profileId) => makerworldModelUrl(designId, profileId)),
    rawFiles: false,
  };
}

/** The print profiles a scope picks from the model a link is of, as links that each name one, read with the request's
 *  cookie. `rawFiles`: the model has none, so its own link imports its files. */
export async function listMakerworldProfileUrls(
  url: string,
  scope: Exclude<MakerworldProfileScope, "url">,
  body: ImportRequestBody,
): Promise<{ title: string | null; urls: string[]; rawFiles: boolean }> {
  const parsed = parseMakerworldModelUrl(url);
  if (!parsed) throw new HttpError(400, `Not a ${manifest.name} model link`);
  const design = await fetchMakerworldDesignForImport(
    parsed.designId,
    resolveMakerworldCookie(body),
    IMPORT_MAKERWORLD_CALL_DELAY_MS,
  );
  if (!design) throw new HttpError(400, `Couldn't read this model's print profiles from ${manifest.name}`);
  const title =
    typeof design.title === "string" && design.title.trim() ? decodeHtmlEntities(design.title.trim()) : null;
  return { title, ...makerworldProfileUrls(parsed.designId, design, scope, parsed.requestedInstanceId) };
}
