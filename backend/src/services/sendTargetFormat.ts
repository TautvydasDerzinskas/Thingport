// What a Send to destination is made of, and how its addresses are filled in. Kept apart from the service so the
// rules can be tested without a database, and so saving, export and import check the same things.

import { z } from "zod";

/** Ready-made destinations: three kinds of printer, and three webhook services. */
export const SEND_PRESET_IDS = ["octoprint", "moonraker", "prusalink", "homeassistant", "n8n", "nodered"] as const;
export type SendPresetId = (typeof SEND_PRESET_IDS)[number];
const PRINTER_PRESETS = new Set<SendPresetId>(["octoprint", "moonraker", "prusalink"]);

/** What an address may have filled in, as `{name}`. */
export const PLACEHOLDERS = [
  "file_url",
  "filename",
  "model_id",
  "model_name",
  "model_url",
  "plate_id",
  "source_url",
] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export type PlaceholderValues = Record<Placeholder, string>;

const PLACEHOLDER = /\{([a-z_]+)\}/g;
// A header name (RFC 9110's token), and a form field's.
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/;
const FIELD_NAME = /^[A-Za-z0-9_.[\]-]{1,100}$/;
const FILE_TYPE = /^[a-z0-9]+(\.[a-z0-9]+)*$/;
// Schemes a link may never use: they run script, show content of their own, or read the machine it's opened on.
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "filesystem:"]);
// Headers Thingport sets itself, or that would carry someone's session to another site.
const RESERVED_HEADERS = new Set([
  "host",
  "cookie",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
]);

/** The scheme, sign-in and host an address comes to: where a filled-in value could send the file somewhere else. */
const authorityOf = (url: URL) => [url.protocol, url.username, url.password, url.host].join("\n");

/** What's wrong with an address template, or null. `web`: only http and https; otherwise an app's own scheme too. */
export function templateProblem(template: string, web: boolean): string | null {
  for (const [, name] of template.matchAll(PLACEHOLDER))
    if (!(PLACEHOLDERS as readonly string[]).includes(name)) return `{${name}} isn't a placeholder Thingport fills in`;
  let url: URL;
  let other: URL;
  try {
    url = new URL(template.replace(PLACEHOLDER, "x"));
    other = new URL(template.replace(PLACEHOLDER, "y"));
  } catch {
    return "Not an address";
  }
  // Judged as the URL parser reads it, not as written: "http:{model_name}/" has its host in the placeholder too.
  if (authorityOf(url) !== authorityOf(other))
    return "Placeholders go in the path or the query, never in the scheme or the host";
  if (web && url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https addresses";
  // A request can't carry them (fetch refuses one), and an export would: a key goes in a secret header instead.
  if (web && (url.username || url.password)) return "No user name or password in the address: use a secret header";
  if (UNSAFE_SCHEMES.has(url.protocol)) return `A link can't use ${url.protocol}`;
  return null;
}

const template = (web: boolean) =>
  z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .superRefine((value, ctx) => {
      const problem = templateProblem(value, web);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    });

/** A printer's or a service's own address, without placeholders: "http://octopi.local". A webhook's is kept as it's
 *  written, as a service may tell "/hook/" from "/hook". */
const address = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .superRefine((value, ctx) => {
    const problem = value.includes("{") ? "No placeholders in an address" : templateProblem(value, true);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** A printer's address, for its own paths to follow. */
const printerBase = (written: string) => written.replace(/\/+$/, "");

/** Fills a template in, each value encoded for its place in an address. */
export function fillIn(templateText: string, values: PlaceholderValues, encode = true): string {
  return templateText.replace(PLACEHOLDER, (whole, name: string) =>
    name in values ? (encode ? encodeURIComponent(values[name as Placeholder]) : values[name as Placeholder]) : whole,
  );
}

/** Whether a template asks for the file's link, which is only made when one does. */
export function wantsFileUrl(...templates: (string | undefined)[]): boolean {
  return templates.some((text) => text?.includes("{file_url}"));
}

const presetSchema = z.object({
  type: z.literal("preset"),
  preset: z.enum(SEND_PRESET_IDS),
  /** The printer's address, or the webhook's. */
  address,
  /** A printer: start printing once the file is there. */
  start: z.boolean().default(false),
});

const linkSchema = z.object({
  type: z.literal("link"),
  url: template(false),
  /** "new": a new tab; "named": the tab called `tab`, reused; "same": this one. */
  open: z.enum(["new", "named", "same"]).default("new"),
  /** Not one of the browser's own, such as "_self", which would open it in Thingport's tab. */
  tab: z
    .string()
    .trim()
    .max(60)
    .refine((name) => !name.startsWith("_"), "A tab name can't start with _")
    .optional(),
});

const headerSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(HEADER_NAME, "Not a header name")
    .refine((name) => !RESERVED_HEADERS.has(name.toLowerCase()), "Thingport sets that header itself"),
  /** A secret's value is kept apart and never sent back; left out on a save, the kept one stays. */
  secret: z.boolean().default(false),
  value: z.string().max(4096).optional(),
});

const requestSchema = z.object({
  type: z.literal("request"),
  method: z.enum(["POST", "PUT"]).default("POST"),
  url: template(true),
  /** "multipart": the file as a form's `fileField`; "raw": the file as the whole body; "json": a link to it. */
  body: z.enum(["multipart", "raw", "json"]).default("multipart"),
  fileField: z.string().trim().regex(FIELD_NAME, "Not a form field name").default("file"),
  fields: z
    .array(
      z.object({ name: z.string().trim().regex(FIELD_NAME, "Not a form field name"), value: z.string().max(2048) }),
    )
    .max(20)
    .default([]),
  headers: z.array(headerSchema).max(20).default([]),
  /** An address to open once it's sent, such as the printer's own page. */
  thenOpen: template(true).optional(),
});

export const howSchema = z.discriminatedUnion("type", [presetSchema, linkSchema, requestSchema]);
export type SendHow = z.infer<typeof howSchema>;

const fileTypes = z
  .array(z.string().trim().toLowerCase().regex(FILE_TYPE, 'A file type without the dot, e.g. "gcode"'))
  .max(20)
  .default([]);

/** A destination as it's saved, exported and imported. */
export const sendTargetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  placement: z.enum(["button", "menu"]).default("menu"),
  fileTypes,
  how: howSchema,
});

/** As it's saved from Configuration: with a preset's API key, which an export never carries. */
export const sendTargetInputSchema = sendTargetSchema.extend({
  /** A preset's API key. Left out, the kept one stays; null removes it. */
  apiKey: z.string().max(4096).nullable().optional(),
});
export type SendTargetInput = z.infer<typeof sendTargetInputSchema>;

/** A saved one's settings: its placement, left out, stays as it is, since the row's own toggle sets that. */
export const sendTargetUpdateSchema = sendTargetInputSchema.extend({
  placement: z.enum(["button", "menu"]).optional(),
});
export type SendTargetUpdate = z.infer<typeof sendTargetUpdateSchema>;

export const sendPlacementSchema = z.object({ placement: z.enum(["button", "menu"]) });

export const SEND_EXPORT_KIND = "thingport-send-to";
export const sendExportSchema = z.object({
  kind: z.literal(SEND_EXPORT_KIND),
  version: z.literal(1),
  targets: z.array(sendTargetSchema).min(1).max(50),
});

/** The secret values a destination keeps apart: a preset's API key, and secret headers' values by name. */
export type SendSecrets = { apiKey?: string; headers?: Record<string, string> };

/** What's kept of a destination: its `how` without secret values, and those values apart. A secret left out keeps
 *  the one `previous` held. */
export function splitSecrets(
  input: SendTargetUpdate,
  previous: SendSecrets | null,
): { how: SendHow; secrets: SendSecrets } {
  const secrets: SendSecrets = {};
  if (input.how.type === "preset") {
    const apiKey = input.apiKey === undefined ? previous?.apiKey : (input.apiKey ?? undefined);
    if (apiKey) secrets.apiKey = apiKey;
    return { how: input.how, secrets };
  }
  if (input.how.type === "link") return { how: input.how, secrets };
  const headers: Record<string, string> = {};
  const kept = input.how.headers.map((header) => {
    if (!header.secret) return header;
    const value = header.value ?? previous?.headers?.[header.name];
    if (value) headers[header.name] = value;
    return { name: header.name, secret: true };
  });
  if (Object.keys(headers).length) secrets.headers = headers;
  return { how: { ...input.how, headers: kept }, secrets };
}

/** A request, with its secrets put back: what a preset or a custom request comes to. */
export type BuiltRequest = {
  method: "POST" | "PUT";
  url: string;
  body: "multipart" | "raw" | "json";
  fileField: string;
  fields: { name: string; value: string }[];
  headers: { name: string; value: string }[];
  thenOpen?: string;
};

/** The request a preset or a custom request makes, its address a template still. */
export function requestOf(how: Exclude<SendHow, { type: "link" }>, secrets: SendSecrets | null): BuiltRequest {
  if (how.type === "request") {
    return {
      method: how.method,
      url: how.url,
      body: how.body,
      fileField: how.fileField,
      fields: how.fields,
      headers: how.headers.flatMap((header) => {
        const value = header.secret ? secrets?.headers?.[header.name] : header.value;
        return value === undefined ? [] : [{ name: header.name, value }];
      }),
      thenOpen: how.thenOpen,
    };
  }
  const key = secrets?.apiKey ? [{ name: "X-Api-Key", value: secrets.apiKey }] : [];
  const at = PRINTER_PRESETS.has(how.preset) ? printerBase(how.address) : how.address;
  switch (how.preset) {
    case "octoprint":
      return {
        method: "POST",
        url: `${at}/api/files/local`,
        body: "multipart",
        fileField: "file",
        fields: how.start
          ? [
              { name: "select", value: "true" },
              { name: "print", value: "true" },
            ]
          : [],
        headers: key,
        thenOpen: at,
      };
    case "moonraker":
      return {
        method: "POST",
        url: `${at}/server/files/upload`,
        body: "multipart",
        fileField: "file",
        fields: [{ name: "root", value: "gcodes" }, ...(how.start ? [{ name: "print", value: "true" }] : [])],
        headers: key,
      };
    case "prusalink":
      return {
        method: "PUT",
        url: `${at}/api/v1/files/usb/{filename}`,
        body: "raw",
        fileField: "file",
        fields: [],
        headers: [
          ...key,
          { name: "Overwrite", value: "?1" },
          ...(how.start ? [{ name: "Print-After-Upload", value: "?1" }] : []),
        ],
        thenOpen: at,
      };
    default:
      return { method: "POST", url: at, body: "json", fileField: "file", fields: [], headers: key };
  }
}

/** Where a "Test" goes: a printer's own "who are you", or for the rest a POST saying it's a test. */
export function testRequestOf(
  how: Exclude<SendHow, { type: "link" }>,
  secrets: SendSecrets | null,
): { method: "GET" | "POST"; url: string; headers: { name: string; value: string }[]; json?: unknown } {
  const built = requestOf(how, secrets);
  if (how.type === "preset" && PRINTER_PRESETS.has(how.preset)) {
    const path = { octoprint: "/api/version", moonraker: "/server/info", prusalink: "/api/version" }[
      how.preset as "octoprint" | "moonraker" | "prusalink"
    ];
    return { method: "GET", url: `${printerBase(how.address)}${path}`, headers: built.headers };
  }
  if (how.type === "preset") return { method: "POST", url: built.url, headers: built.headers, json: TEST_EVENT };
  // A custom request's address may name the file; its host is what a test can reach without sending one.
  return { method: "GET", url: `${new URL(how.url.replace(PLACEHOLDER, "x")).origin}/`, headers: built.headers };
}

export const TEST_EVENT = { event: "thingport.test", test: true };

/** Whether a destination is offered for a file: one of its types, matched on the end of the name. */
export function takesFile(fileTypesWanted: string[], filename: string): boolean {
  if (!fileTypesWanted.length) return true;
  const name = filename.toLowerCase();
  return fileTypesWanted.some((type) => name.endsWith(`.${type}`));
}
