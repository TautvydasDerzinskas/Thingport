import { HttpError } from "../utils/fileUtils";
import { normalizeStorageTemplate, STORAGE_TEMPLATE_TOKENS } from "./printService";

// The rules a storage template must follow to be saved. A template saved before them still works
// (validateStorageTemplate is all the file code needs), and new files never overwrite one another
// whatever it is; these keep a new one from producing clashing or odd paths in the first place.
// Each is checked on its own, so the page can list everything wrong at once.

type Token = (typeof STORAGE_TEMPLATE_TOKENS)[number];

export type StorageTemplateProblem =
  | { code: "empty" }
  | { code: "unknown_token"; token: string }
  | { code: "stray_brace" }
  | { code: "empty_folder" }
  | { code: "filename_count" }
  | { code: "filename_not_last" }
  | { code: "duplicate_token"; token: Token }
  | { code: "plate_in_folder" }
  | { code: "category_not_whole_folder" }
  | { code: "not_unique" }
  | { code: "unsafe_text"; segment: string }
  | { code: "too_deep"; max: number };

const MAX_FOLDERS = 8;
const TOKEN_RE = /\{([a-z_-]+)\}/g;
// What sanitizePathSegment would change, so the folder on disk wouldn't read as typed.
// oxlint-disable-next-line no-control-regex -- control chars are what's being caught.
const UNSAFE_TEXT_RE = /[<>:"|?*\\\x00-\x1f]|^[ .]|[ .]$/;

const PROBLEM_TEXT: Record<StorageTemplateProblem["code"], string> = {
  empty: "Storage template cannot be empty",
  unknown_token: "The template uses a token that doesn't exist",
  stray_brace: "The template has a { or } that isn't part of a token",
  empty_folder: "The template has an empty folder, or one named . or ..",
  filename_count: "The template must contain {filename} exactly once",
  filename_not_last: "{filename} must end the template, so each file keeps its extension",
  duplicate_token: "Each token can only be used once",
  plate_in_folder: "{plate} can only be part of the file name",
  category_not_whole_folder: "{category-or-folder} must be a folder of its own",
  not_unique:
    "The template must include {id}, or both {category-or-folder} and {model}, so two models never share a path",
  unsafe_text: "Folder names can't contain < > : \" | ? * or \\, or start or end with a space or dot",
  too_deep: `Use at most ${MAX_FOLDERS} folders`,
};

/** The normalized template and everything wrong with it; none means it can be saved. */
export function storageTemplateProblems(raw: string): { template: string; problems: StorageTemplateProblem[] } {
  const template = normalizeStorageTemplate(raw);
  if (!template) return { template, problems: [{ code: "empty" }] };
  const problems: StorageTemplateProblem[] = [];
  const segments = template.split("/");
  const folders = segments.slice(0, -1);
  const fileSegment = segments[segments.length - 1];
  const tokens = [...template.matchAll(TOKEN_RE)].map((m) => m[1]);

  const unknown = tokens.find((token) => !(STORAGE_TEMPLATE_TOKENS as readonly string[]).includes(token));
  if (unknown) problems.push({ code: "unknown_token", token: unknown });
  if (/[{}]/.test(template.replace(TOKEN_RE, ""))) problems.push({ code: "stray_brace" });
  if (segments.some((segment) => segment.trim() === "" || segment === "." || segment === "..")) {
    problems.push({ code: "empty_folder" });
  }
  const filenames = tokens.filter((token) => token === "filename").length;
  if (filenames !== 1) problems.push({ code: "filename_count" });
  // After it, text would land behind the extension: "Clip.3mf-1".
  else if (!fileSegment.endsWith("{filename}")) problems.push({ code: "filename_not_last" });
  const repeated = tokens.find((token, index) => token !== "filename" && tokens.indexOf(token) !== index);
  if (repeated) problems.push({ code: "duplicate_token", token: repeated as Token });
  // Each plate in a folder of its own splits one model's files apart.
  if (folders.some((folder) => folder.includes("{plate}"))) problems.push({ code: "plate_in_folder" });
  // It expands to several folders ("Props/Workshop"), which only reads right as whole ones.
  if (segments.some((segment) => segment.includes("{category-or-folder}") && segment !== "{category-or-folder}")) {
    problems.push({ code: "category_not_whole_folder" });
  }
  // Model names are only unique within a category, and file names within a model.
  const has = (token: Token) => tokens.includes(token);
  if (!has("id") && !(has("category-or-folder") && has("model"))) problems.push({ code: "not_unique" });
  const badText = segments.find((segment) => segment.trim() && UNSAFE_TEXT_RE.test(segment.replace(TOKEN_RE, "x")));
  if (badText) problems.push({ code: "unsafe_text", segment: badText });
  if (folders.length > MAX_FOLDERS) problems.push({ code: "too_deep", max: MAX_FOLDERS });
  return { template, problems };
}

/** For saving: the normalized template, or a 400 naming its first problem. */
export function assertSavableStorageTemplate(raw: string): string {
  const { template, problems } = storageTemplateProblems(raw);
  if (problems.length) throw new HttpError(400, PROBLEM_TEXT[problems[0].code], "invalid_storage_template");
  return template;
}
