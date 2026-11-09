// An older import's licence, read again. Apart from license.ts, which the design's metadata reads its licence with.

import type { ProviderLicense } from "../../services/licenseCatalog";
import { fetchMakerworldPublicDesign } from "./api";
import { makerworldLicenseFrom } from "./license";

/** From the public design data, as the print profiles are, so no one's session is spent on it. Null for a design
 *  MakerWorld no longer has; undefined for one answered without the field, read again later; a refusal or a CAPTCHA
 *  is thrown, for a later try. */
export async function readMakerworldLicense(
  _userId: string,
  designId: string,
  _stored: { notes: string | null },
): Promise<ProviderLicense | null | undefined> {
  const design = await fetchMakerworldPublicDesign(designId);
  return design ? makerworldLicenseFrom(design) : null;
}
