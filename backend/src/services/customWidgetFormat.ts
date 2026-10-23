// The format of a custom dashboard widget: its metadata, script and HTML. Kept apart from the service so
// scripts/validateCommunityWidgets.ts can check the community repository without a database.

import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { HttpError } from "../utils/fileUtils";

export const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
// A host name, optionally starting with "*." for any of its subdomains, and optionally a port.
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;
const SCRIPT_MAX = 500_000;
const HTML_MAX = 200_000;

const label = z.string().trim().min(1).max(60);
const webAddress = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((url) => /^https?:\/\//i.test(url), "Not an http or https address");
// One of Thingport's own icons, or one the user uploaded (services/iconService.ts).
const ICON_REF = /^(builtin:[a-z]+\/[a-z0-9-]+|\/api\/icons\/[a-f0-9]{32}\.(png|svg))$/;
const iconAddress = z.union([z.string().trim().regex(ICON_REF), webAddress]);
const settingSchema = z.discriminatedUnion("type", [
  z.object({
    key: z.string().regex(KEY),
    type: z.literal("text"),
    label,
    default: z.string().max(2048).optional(),
    placeholder: z.string().max(200).optional(),
    /** Shown as a password field, e.g. an API token. */
    secret: z.boolean().optional(),
  }),
  z.object({ key: z.string().regex(KEY), type: z.literal("number"), label, default: z.number().optional() }),
  z.object({ key: z.string().regex(KEY), type: z.literal("toggle"), label, default: z.boolean().optional() }),
  z.object({
    key: z.string().regex(KEY),
    type: z.literal("choice"),
    label,
    options: z
      .array(z.object({ value: z.string().min(1).max(40), label }))
      .min(2)
      .max(8),
    default: z.string().max(40).optional(),
  }),
]);

const sizeSchema = z
  .object({
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(40),
    minW: z.number().int().min(1).max(12).optional(),
    minH: z.number().int().min(1).max(40).optional(),
  })
  .refine(
    (size) => (size.minW ?? 1) <= size.w && (size.minH ?? 1) <= size.h,
    "The minimum size is larger than the size",
  );

export const manifestSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(300).default(""),
  /** The widget's icon: an image address, where an SVG stays sharp at every size, or, as the icon browser picks,
   *  one of Thingport's own icons, `builtin:<group>/<name>`, or one the user uploaded, `/api/icons/<file>`. */
  iconUrl: iconAddress.optional(),
  version: z.string().trim().max(20).default("1.0.0"),
  /** The author's full name; saving fills in the user's own when it's missing. */
  author: z.string().trim().max(60).optional(),
  /** The author's page, e.g. their GitHub profile. */
  authorUrl: webAddress.optional(),
  size: sizeSchema.default({ w: 4, h: 4 }),
  settings: z
    .array(settingSchema)
    .max(20)
    .default([])
    .refine((settings) => new Set(settings.map((s) => s.key)).size === settings.length, "Two settings share a key"),
  /** The hosts its `thingport.fetch` may reach through the server. */
  hosts: z.array(z.string().trim().toLowerCase().regex(HOST, "Not a host name")).max(20).default([]),
});
export type WidgetManifest = z.infer<typeof manifestSchema>;

/** Metadata as JSON or YAML. */
export function parseManifest(text: string): WidgetManifest {
  let raw: unknown;
  try {
    raw = text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    throw new HttpError(400, `The metadata isn't valid JSON or YAML: ${err instanceof Error ? err.message : err}`);
  }
  return validateManifest(raw);
}

export function validateManifest(raw: unknown): WidgetManifest {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success)
    throw new HttpError(
      400,
      `The metadata isn't right: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "metadata"}: ${issue.message}`).join("; ")}`,
    );
  return parsed.data;
}

export function validateCode(script: string, html: string | null): void {
  if (!script.trim()) throw new HttpError(400, "The script is empty");
  if (script.length > SCRIPT_MAX) throw new HttpError(400, `The script is longer than ${SCRIPT_MAX} characters`);
  if (html && html.length > HTML_MAX) throw new HttpError(400, `The HTML is longer than ${HTML_MAX} characters`);
  // An ES module that mounts the widget: its default export is what Thingport calls.
  if (!/export\s+default\b/.test(script)) throw new HttpError(400, "The script needs an `export default` function");
}
