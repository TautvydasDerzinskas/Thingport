import type { WidgetManifest, WidgetSettingSpec } from "../../../api/widgets";

// The editor's form of a widget's metadata. Kept loose while typing, so a half-filled field is fine; `toManifest`
// makes the metadata the server checks again on saving.

export type SettingType = WidgetSettingSpec["type"];

export type DraftOption = { uid: string; value: string; label: string };

export type DraftSetting = {
  uid: string;
  key: string;
  /** False until the user types a key, so it follows the label until then. */
  keyEdited: boolean;
  label: string;
  type: SettingType;
  /** The default as typed: text, a number, an option's value. Toggles use `on`. */
  value: string;
  on: boolean;
  placeholder: string;
  secret: boolean;
  options: DraftOption[];
};

export type Draft = {
  slug: string;
  slugEdited: boolean;
  name: string;
  description: string;
  icon: string;
  iconUrl: string;
  version: string;
  author: string;
  authorUrl: string;
  size: { w: number; h: number; minW: number; minH: number };
  settings: DraftSetting[];
  hosts: string[];
};

export const SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const WEB = /^https?:\/\/[^\s]+$/i;
export const MAX_SETTINGS = 20;
export const MAX_OPTIONS = 8;
export const GRID_COLS = 12;
export const MAX_ROWS = 40;

let counter = 0;
export const uid = () => `u${++counter}`;

/** A setting key from its label: "API key" becomes "apiKey". */
export function keyFromLabel(label: string): string {
  const words = label
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const key = words.map((word, index) => (index ? word[0].toUpperCase() + word.slice(1) : word.toLowerCase())).join("");
  return /^[a-zA-Z]/.test(key) ? key.slice(0, 40) : "";
}

/** A folder name from the widget's name: "World clock" becomes "world-clock". */
export function slugFromName(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function newSetting(type: SettingType, taken: string[]): DraftSetting {
  let n = 1;
  while (taken.includes(`setting${n}`)) n++;
  return {
    uid: uid(),
    key: `setting${n}`,
    keyEdited: false,
    label: "",
    type,
    value: "",
    on: false,
    placeholder: "",
    secret: false,
    options: [
      { uid: uid(), value: "a", label: "A" },
      { uid: uid(), value: "b", label: "B" },
    ],
  };
}

export function fromManifest(manifest: WidgetManifest, slug: string): Draft {
  return {
    slug,
    slugEdited: true,
    name: manifest.name,
    description: manifest.description ?? "",
    // An image address in `icon`, from before `iconUrl`, moves to where it's now edited.
    ...(manifest.icon && /^https?:/i.test(manifest.icon) && !manifest.iconUrl
      ? { icon: "", iconUrl: manifest.icon }
      : { icon: manifest.icon ?? "", iconUrl: manifest.iconUrl ?? "" }),
    version: manifest.version ?? "1.0.0",
    author: manifest.author ?? "",
    authorUrl: manifest.authorUrl ?? "",
    size: {
      w: manifest.size.w,
      h: manifest.size.h,
      minW: manifest.size.minW ?? 1,
      minH: manifest.size.minH ?? 1,
    },
    settings: manifest.settings.map((spec) => ({
      uid: uid(),
      key: spec.key,
      keyEdited: true,
      label: spec.label,
      type: spec.type,
      value: spec.type === "toggle" || spec.default === undefined ? "" : String(spec.default),
      on: spec.type === "toggle" && spec.default === true,
      placeholder: spec.type === "text" ? (spec.placeholder ?? "") : "",
      secret: spec.type === "text" && spec.secret === true,
      options:
        spec.type === "choice"
          ? spec.options.map((option) => ({ uid: uid(), ...option }))
          : [
              { uid: uid(), value: "a", label: "A" },
              { uid: uid(), value: "b", label: "B" },
            ],
    })),
    hosts: manifest.hosts,
  };
}

const optional = (value: string) => value.trim() || undefined;

function toSpec(setting: DraftSetting): WidgetSettingSpec {
  const base = { key: setting.key.trim(), label: setting.label.trim() };
  switch (setting.type) {
    case "toggle":
      return { ...base, type: "toggle", default: setting.on };
    case "number": {
      const value = Number(setting.value);
      return { ...base, type: "number", default: setting.value.trim() && Number.isFinite(value) ? value : undefined };
    }
    case "choice": {
      const options = setting.options.map(({ value, label }) => ({ value: value.trim(), label: label.trim() }));
      return {
        ...base,
        type: "choice",
        options,
        default: options.some((option) => option.value === setting.value) ? setting.value : undefined,
      };
    }
    default:
      return {
        ...base,
        type: "text",
        default: optional(setting.value),
        placeholder: optional(setting.placeholder),
        secret: setting.secret || undefined,
      };
  }
}

/** The metadata to save, without the editor's own fields and empty optional ones. */
export function toManifest(draft: Draft): WidgetManifest {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    icon: optional(draft.icon),
    iconUrl: optional(draft.iconUrl),
    version: draft.version.trim() || "1.0.0",
    author: optional(draft.author),
    authorUrl: optional(draft.authorUrl),
    size: { ...draft.size },
    settings: draft.settings.map(toSpec),
    hosts: draft.hosts,
  };
}

/** What's wrong with the draft, by field: "name", "settings.<uid>.key", "settings.<uid>.options" and so on. The value
 *  is a translation key under dashboard.custom.editor.errors. */
export function problems(draft: Draft): Record<string, string> {
  const found: Record<string, string> = {};
  if (!SLUG.test(draft.slug)) found.slug = "slug";
  if (!draft.name.trim()) found.name = "name";
  if (draft.iconUrl.trim() && !WEB.test(draft.iconUrl.trim())) found.iconUrl = "url";
  if (draft.authorUrl.trim() && !WEB.test(draft.authorUrl.trim())) found.authorUrl = "url";
  if (draft.size.minW > draft.size.w) found.minW = "minSize";
  if (draft.size.minH > draft.size.h) found.minH = "minSize";
  const keys = draft.settings.map((setting) => setting.key.trim());
  for (const [index, setting] of draft.settings.entries()) {
    const key = keys[index];
    if (!KEY.test(key)) found[`settings.${setting.uid}.key`] = "key";
    else if (keys.indexOf(key) !== index) found[`settings.${setting.uid}.key`] = "keyTaken";
    if (!setting.label.trim()) found[`settings.${setting.uid}.label`] = "label";
    if (setting.type === "number" && setting.value.trim() && !Number.isFinite(Number(setting.value)))
      found[`settings.${setting.uid}.value`] = "number";
    if (setting.type === "choice") {
      const values = setting.options.map((option) => option.value.trim());
      if (
        values.length < 2 ||
        values.some((value) => !value) ||
        setting.options.some((option) => !option.label.trim()) ||
        new Set(values).size !== values.length
      )
        found[`settings.${setting.uid}.options`] = "options";
    }
  }
  return found;
}
