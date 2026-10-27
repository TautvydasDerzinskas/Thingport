// The format of a custom dashboard widget: its metadata, script and HTML. Kept apart from the service so
// scripts/validateCommunityWidgets.ts can check the community repository without a database.

import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { HttpError } from "../utils/fileUtils";

export const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
// A host name, optionally starting with "*." for any of its subdomains, and optionally a port.
export const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;
const SCRIPT_MAX = 500_000;
const HTML_MAX = 200_000;
// A file beside widget.json, in it or a folder under it: no "..", no absolute path, no hidden files.
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_. -]*(\/[A-Za-z0-9_][A-Za-z0-9_. -]*)*$/;

/** The pictures a shared widget or tool shows before it's installed. */
export const SCREENSHOT_EXTS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);
export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
/** One language's labels, as a file and as the lot of them: enough for a wordy widget, not enough to hide a payload. */
export const LOCALE_MAX_BYTES = 128 * 1024;
export const LOCALES_MAX_BYTES = 1024 * 1024;

/** A language code as Thingport writes them: "en", "lt", "pt-BR". */
export const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/**
 * One language's labels: a flat map of key to sentence. Flat because a widget looks a label up by its whole key
 * ("wind.gusts"), and because nesting invites a file that is really a program.
 */
export const localeSchema = z.record(
  z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][\w.-]*$/, "Not a label key"),
  z.string().max(2000),
);
export type Locale = z.infer<typeof localeSchema>;

/** Every language something has, by code. */
export const localesSchema = z.record(z.string().trim().regex(LANGUAGE, "Not a language code"), localeSchema);
export type Locales = z.infer<typeof localesSchema>;

export function validateLocale(code: string, raw: unknown): Locale {
  if (!LANGUAGE.test(code)) throw new HttpError(400, `"${code}" isn't a language code`);
  const parsed = localeSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `The ${code} labels aren't right: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

/** Where a language's labels live in the folder: the same place for a widget and for a tool. */
export const localeFile = (code: string): string => `locales/${code}.json`;

/** A picture of it at work, beside its metadata. */
export const screenshotSchema = z.object({
  file: z
    .string()
    .trim()
    .max(200)
    .regex(FILE, "Not a file beside the metadata")
    .refine((file) => !file.split("/").includes(".."), "Not a file beside the metadata")
    .refine((file) => SCREENSHOT_EXTS.has(path.extname(file).toLowerCase()), "Not a PNG, JPEG or WebP image"),
  caption: z.string().trim().max(200).optional(),
});
export type Screenshot = z.infer<typeof screenshotSchema>;

const label = z.string().trim().min(1).max(60);
export const webAddress = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((url) => /^https?:\/\//i.test(url), "Not an http or https address");
// One of Thingport's own icons, or one the user uploaded (services/iconService.ts).
const ICON_REF = /^(builtin:[a-z]+\/[a-z0-9-]+|\/api\/icons\/[a-f0-9]{32}\.(png|svg))$/;
export const iconAddress = z.union([z.string().trim().regex(ICON_REF), webAddress]);
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
  /**
   * The languages it has labels for, as `locales/<code>.json` beside widget.json. Thingport reads the one matching
   * the user's language and hands the widget `t()`; "en" is the fallback, so a widget with labels wants one.
   */
  locales: z.array(z.string().trim().regex(LANGUAGE, "Not a language code")).max(40).default([]),
  /** Pictures of it at work, for someone to look at before installing it: a community widget's own files. */
  screenshots: z.array(screenshotSchema).max(8).default([]),
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
  if (!parsed.success) throw new HttpError(400, `The metadata isn't right: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

/** Each issue as "path: message", for an error that says what to fix. */
export function describeIssues(error: z.ZodError, root = "metadata"): string {
  return error.issues.map((issue) => `${issue.path.join(".") || root}: ${issue.message}`).join("; ");
}

export function validateCode(script: string, html: string | null): void {
  if (!script.trim()) throw new HttpError(400, "The script is empty");
  if (script.length > SCRIPT_MAX) throw new HttpError(400, `The script is longer than ${SCRIPT_MAX} characters`);
  if (html && html.length > HTML_MAX) throw new HttpError(400, `The HTML is longer than ${HTML_MAX} characters`);
  // An ES module that mounts the widget: its default export is what Thingport calls.
  if (!/export\s+default\b/.test(script)) throw new HttpError(400, "The script needs an `export default` function");
}
