// Shared import request contract for routes and queued workers.

import { z } from "zod";
import { assertUrlProviderEnabled } from "./providerSettingsService";
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

export const listImportSchema = importRequestSchema.extend({
  model_ids: z.array(z.string()).min(1),
  collection_title: z.string().max(300).nullable().optional(),
});
export const profilesImportSchema = importRequestSchema.extend({ scope: z.enum(["designer", "all"]) });
export const zipExtractRequestSchema = importRequestSchema.extend({ entries: z.array(z.string()) });

/** Browser sessions and signed file URLs cannot safely wait in a durable queue. */
export function needsImmediateImport(body: {
  url?: string;
  makerworld_cookie?: string | null;
  resolved_download_url?: string | null;
  resolved_files?: unknown[] | null;
}): boolean {
  if (body.makerworld_cookie?.trim() || body.resolved_download_url || body.resolved_files?.length) return true;
  if (body.url) {
    try {
      const params = new URL(body.url).searchParams;
      // A bare archive URL can itself be signed, rather than carried as resolved_download_url.
      if ([...params.keys()].some((key) => /^(x-amz-|x-goog-|signature$|expires$)/i.test(key))) return true;
    } catch {
      /* URL validation happens before a job is accepted or executed. */
    }
  }
  return false;
}
