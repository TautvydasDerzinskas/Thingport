// What every import route takes, the shared ones and providers' own (providers/routes.ts).

import { z } from "zod";
import { assertUrlProviderEnabled } from "../services/providerSettingsService";
import { normalizeImportUrl } from "../utils/urlUtils";

export const importRequestSchema = z.object({
  url: z.string(),
  title: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  category_id: z.string().nullable().optional(),
  filename: z.string().nullable().optional(),
  makerworld_cookie: z.string().nullable().optional(),
  // Resolved by the extension in the page itself. Skips the backend's own resolution, which is
  // what trips MakerWorld's CAPTCHA.
  resolved_download_url: z.string().nullable().optional(),
  resolved_instance_id: z.string().nullable().optional(),
  // MakerOnline's files, their links signed by Thingport Grab on the site's own page.
  resolved_files: z
    .array(z.object({ url: z.string().url(), name: z.string().max(500), profile_id: z.string().nullable().optional() }))
    .max(200)
    .nullable()
    .optional(),
  makerworld_design: z.record(z.unknown()).nullable().optional(),
  // False for each model of a run the client drives itself; the run sends one summary at the end.
  notify: z.boolean().optional(),
});

/** The link, normalized, unless it's from a provider an admin has turned off. */
export async function enabledImportUrl(raw: string): Promise<string> {
  const url = await normalizeImportUrl(raw);
  await assertUrlProviderEnabled(url);
  return url;
}
