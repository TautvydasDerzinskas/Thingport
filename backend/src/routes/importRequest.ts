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

// What a link signed by its host carries, which expires while it waits.
const SIGNED_QUERY_KEY = /^(x-amz-|x-goog-|signature$|expires$)/i;

function isSignedLink(raw: string): boolean {
  try {
    const link = raw.trim();
    const { searchParams } = new URL(link.includes("://") ? link : `https://${link}`);
    return [...searchParams.keys()].some((key) => SIGNED_QUERY_KEY.test(key));
  } catch {
    // The route's own check turns away what isn't a link.
    return false;
  }
}

/** Whether a request can't wait in the line, even one that asked to: it brought what isn't kept or won't last (a
 *  session, what the page resolved, a signed link), or its client is driving its own run. Ask it of the request as it
 *  came: with the stored sign-in merged in, nearly every MakerWorld import would look like this. */
export function mustRunNow(
  body: Omit<Partial<z.infer<typeof importRequestSchema>>, "url"> & { url?: string; urls?: string[] },
): boolean {
  return (
    Boolean(body.makerworld_cookie?.trim()) ||
    Boolean(body.resolved_download_url || body.resolved_instance_id || body.resolved_files?.length) ||
    Boolean(body.makerworld_design) ||
    body.notify === false ||
    [body.url ?? "", ...(body.urls ?? [])].some(isSignedLink)
  );
}

/** What any import job keeps of its request, whatever else it needs of its own. */
export type StoredRequest = Pick<
  z.infer<typeof importRequestSchema>,
  "title" | "notes" | "category_id" | "filename"
> & {
  tags?: string[];
};

/** The part of a request a job stores, to run from later, by whitelist: never the cookie, a captcha answer or anything
 *  resolved in the browser. The sign-in is read again when the job runs. */
export function storedImportBody(body: StoredRequest) {
  return {
    title: body.title ?? null,
    filename: body.filename ?? null,
    notes: body.notes ?? null,
    tags: body.tags ?? [],
    category_id: body.category_id ?? null,
  };
}

/** The link, normalized, unless it's from a provider an admin has turned off. */
export async function enabledImportUrl(raw: string): Promise<string> {
  const url = await normalizeImportUrl(raw);
  await assertUrlProviderEnabled(url);
  return url;
}
