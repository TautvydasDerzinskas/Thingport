// The format of a tool: its metadata, script and HTML, its labels, and for one from the repository the models it
// brings. Kept apart from the service so scripts/validateTools.ts can check the repository's tools folder without a
// database.

import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { HttpError } from "../utils/fileUtils";
import { describeIssues, HOST, iconAddress, SLUG, validateCode, webAddress } from "./customWidgetFormat";

export { SLUG, validateCode };

// A model's key: how the tool finds it among its collection's models (`thingport.tool.models`).
const KEY = /^[a-z0-9][a-z0-9-]{0,59}$/;
// A file beside tool.json, in it or a folder under it: no "..", no absolute path, no hidden files.
const FILE = /^[A-Za-z0-9_][A-Za-z0-9_. -]*(\/[A-Za-z0-9_][A-Za-z0-9_. -]*)*$/;
export const TOOL_MODEL_EXTS = new Set([".stl", ".3mf", ".step", ".stp", ".obj"]);
export const TOOL_SCREENSHOT_EXTS = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);
export const TOOL_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
/** One language's labels, as a file and as the lot of them: enough for a wordy tool, not enough to hide a payload. */
export const TOOL_LOCALE_MAX_BYTES = 128 * 1024;
export const TOOL_LOCALES_MAX_BYTES = 1024 * 1024;
export const TOOL_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const TOOL_FILES_MAX_BYTES = 250 * 1024 * 1024;

// An SVG written into the metadata, as a tool's build puts its icon.svg there: it's installed with the tool, so it
// shows with no request to anywhere.
const SVG_DATA = /^data:image\/svg\+xml(;charset=utf-8)?(;base64)?,/i;
const toolIcon = z.union([
  iconAddress,
  z.string().trim().max(20_000, "An inline SVG icon is at most 20,000 characters").regex(SVG_DATA, "Not an icon"),
]);

const modelFile = z
  .string()
  .trim()
  .max(200)
  .regex(FILE, "Not a file beside tool.json")
  .refine((file) => !file.split("/").includes(".."), "Not a file beside tool.json")
  .refine(
    (file) => TOOL_MODEL_EXTS.has(path.extname(file).toLowerCase()),
    "Not a 3D model file (.stl, .3mf, .step, .obj)",
  );

/** A language code as Thingport writes them: "en", "lt", "pt-BR". */
export const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/**
 * One language's labels: a flat map of key to sentence. Flat because a tool looks a label up by its whole key
 * ("rings.ring"), and because nesting invites a file that is really a program.
 */
export const toolLocaleSchema = z.record(
  z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][\w.-]*$/, "Not a label key"),
  z.string().max(2000),
);
export type ToolLocale = z.infer<typeof toolLocaleSchema>;

/** Every language a tool has, by code. */
export const toolLocalesSchema = z.record(z.string().trim().regex(LANGUAGE, "Not a language code"), toolLocaleSchema);
export type ToolLocales = z.infer<typeof toolLocalesSchema>;

export function validateToolLocale(code: string, raw: unknown): ToolLocale {
  if (!LANGUAGE.test(code)) throw new HttpError(400, `"${code}" isn't a language code`);
  const parsed = toolLocaleSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `The ${code} labels aren't right: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

const screenshotSchema = z.object({
  /** An image beside tool.json, e.g. "screenshots/plan.png". */
  file: z
    .string()
    .trim()
    .max(200)
    .regex(FILE, "Not a file beside tool.json")
    .refine((file) => TOOL_SCREENSHOT_EXTS.has(path.extname(file).toLowerCase()), "Not a PNG, JPEG or WebP image"),
  caption: z.string().trim().max(200).optional(),
});

const toolModelSchema = z
  .object({
    key: z.string().trim().regex(KEY, "1-60 lowercase letters, digits and dashes"),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    /** Its plates, in order, from the tool's folder: for files the tool's licence lets the repository carry. */
    files: z.array(modelFile).min(1).max(20).optional(),
    /** Or a model page Thingport imports from (any link + Add > Import takes), fetched when an admin installs the
     *  tool, as that admin: for a design whose licence lets people download it but not pass copies on. */
    source: webAddress.optional(),
  })
  .refine((model) => Boolean(model.files) !== Boolean(model.source), "A model has either files or a source");
export type ToolModelSpec = z.infer<typeof toolModelSchema>;

const collectionSchema = z
  .object({
    /** The collection's name in every user's library. */
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).optional(),
    models: z.array(toolModelSchema).min(1).max(300),
  })
  .refine((collection) => new Set(collection.models.map((m) => m.key)).size === collection.models.length, {
    message: "Two models share a key",
  });

export const toolManifestSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(300).default(""),
  /** As a widget's: an image address, `builtin:<group>/<name>` or `/api/icons/<file>`; or an SVG as a data URL. */
  iconUrl: toolIcon.optional(),
  version: z.string().trim().max(20).default("1.0.0"),
  author: z.string().trim().max(60).optional(),
  authorUrl: webAddress.optional(),
  /** The window it opens in, in pixels; a smaller screen gets what fits. */
  window: z
    .object({ width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1200) })
    .default({ width: 960, height: 640 }),
  /** The hosts its `thingport.fetch` may reach through the server. */
  hosts: z.array(z.string().trim().toLowerCase().regex(HOST, "Not a host name")).max(20).default([]),
  /** Pictures of it at work, for an admin to look at before installing it. */
  screenshots: z.array(screenshotSchema).max(8).default([]),
  /**
   * The languages it has labels for, as `locales/<code>.json` beside tool.json. Thingport reads the one matching
   * the user's language and hands the tool `t()`; "en" is the fallback, so a tool with labels wants one.
   */
  locales: z.array(z.string().trim().regex(LANGUAGE, "Not a language code")).max(40).default([]),
  /** The models it needs, kept in a collection of their own in every user's library that can use tools: only a
   *  repository tool brings them, as its files are what the review reads. */
  collection: collectionSchema.optional(),
});
export type ToolManifest = z.infer<typeof toolManifestSchema>;

/** Metadata as JSON or YAML. */
export function parseToolManifest(text: string): ToolManifest {
  let raw: unknown;
  try {
    raw = text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    throw new HttpError(400, `The metadata isn't valid JSON or YAML: ${err instanceof Error ? err.message : err}`);
  }
  return validateToolManifest(raw);
}

export function validateToolManifest(raw: unknown): ToolManifest {
  const parsed = toolManifestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `The metadata isn't right: ${describeIssues(parsed.error)}`);
  return parsed.data;
}

/** Where a language's labels live in the tool's folder. */
export const toolLocaleFile = (code: string): string => `locales/${code}.json`;

/** Every file its models name, once. */
export function toolModelFiles(manifest: ToolManifest): string[] {
  return [...new Set(manifest.collection?.models.flatMap((model) => model.files ?? []) ?? [])];
}
