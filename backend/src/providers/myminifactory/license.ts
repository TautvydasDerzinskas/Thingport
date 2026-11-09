// A MyMiniFactory object's licence. Its API gives the licence's name (`license`) and the permissions the designer
// picked (`licenses`, a flag each); the name is a Creative Commons one ("BY-NC-SA"), the store's for a paid object,
// or one MyMiniFactory builds from the flags ("MyMiniFactory Exclusive - Credit - Remix - Noncommercial").

import {
  ccLicenseId,
  licenseIdFromText,
  type LicenseAction,
  type ProviderLicense,
} from "../../services/licenseCatalog";

type Flags = Map<string, boolean>;

// A Creative Commons licence spelled out without saying so: "Attribution", its parts, then a version or the kind of
// port ("Attribution-ShareAlike 4.0 International"), or its parts and nothing more ("Attribution-ShareAlike").
// "Attribution required" is no licence name.
const SPELLED_CC =
  /^attribution(?:(?:[\s_-]+(?:non[\s-]?commercial|no[\s-]?deriv\w*|share[\s-]?alike))*[\s_-]+(?:v?\d\.\d|international|generic|unported)\b|(?:[\s_-]+(?:non[\s-]?commercial|no[\s-]?deriv\w*|share[\s-]?alike))+\s*$)/i;
const CC_HEAD = /^(?:CC[\s_-]*)?BY(?:[\s_-]+(?:NC|ND|SA))*(?![A-Za-z])/i;
const isCcName = (name: string) => CC_HEAD.test(name) || SPELLED_CC.test(name) || /creative commons/i.test(name);

function flagsOf(value: unknown): Flags {
  const flags: Flags = new Map();
  if (!Array.isArray(value)) return flags;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { type, value: on } = item as Record<string, unknown>;
    if (typeof type === "string" && type.trim()) flags.set(type.trim().toLowerCase(), on === true);
  }
  return flags;
}

/** A Creative Commons licence by its name, as the site shows it ("BY-NC-SA", maybe a description after it) or spelled
 *  out. */
function ccId(name: string): string | null {
  if (/myminifactory/i.test(name)) return null;
  const head = name.match(/^((?:CC[\s_-]*)?BY(?:[\s_-]+(?:NC|ND|SA))*)(?![A-Za-z])(?:[\s_-]*v?(\d\.\d))?/i);
  // At the version it names ("BY-SA 3.0"), 4.0 when it names none.
  const version = head?.[2] === "3.0" ? "3.0" : head?.[2] && head[2] !== "4.0" ? null : "4.0";
  // Spelled out, it may leave out "Creative Commons" ("Attribution-ShareAlike 4.0 International").
  const spelled = SPELLED_CC.test(name) ? `Creative Commons ${name}` : name;
  const id = (head && version ? ccLicenseId(head[1], version) : null) ?? licenseIdFromText(spelled);
  return id && (id.startsWith("CC") || id === "public-domain") ? id : null;
}

/** What its own licence allows, from the flags, or failing those from the words of its name. An exclusive object may
 *  not be put up anywhere else, so it's never passed on. */
function ownAllows(flags: Flags, name: string | null): LicenseAction[] {
  const words = (name ?? "").toLowerCase();
  const has = (flag: string, yes: RegExp, no: RegExp) =>
    flags.has(flag) ? flags.get(flag)! : yes.test(words) && !no.test(words);
  const exclusive = flags.get("exclusivity") ?? /\bexclusive\b/.test(words);
  const allows: LicenseAction[] = [];
  if (!exclusive && flags.get("share")) allows.push("share");
  if (has("remix", /\bremix\b/, /\bno[\s-]?remix\b/)) allows.push("remix");
  if (has("commercial-use", /\bcommercial\b/, /\bnon[\s-]?commercial\b/)) allows.push("commercial");
  return allows;
}

/** Null for an object that names no licence; undefined for one read without the fields. `paid`: on sale in its store,
 *  whose licence covers whatever it's sold under. */
export function myminifactoryLicenseFrom(
  object: Record<string, unknown>,
  paid = false,
): ProviderLicense | null | undefined {
  // On sale, it's under the store's licence whatever the fields say, or whether they're there.
  if (!paid && !("license" in object) && !("licenses" in object)) return undefined;
  const name = typeof object.license === "string" && object.license.trim() ? object.license.trim() : null;
  const flags = flagsOf(object.licenses);
  const on = [...flags].filter(([, value]) => value).map(([type]) => type);
  const raw = name ?? (flags.size ? on.join(", ") || "none" : null);
  if (!raw) return paid ? { id: "myminifactory-store", raw: "store" } : null;
  // The store's licence overrides every permission the designer could pick otherwise.
  if (paid || flags.get("store") || (name && /store license/i.test(name))) return { id: "myminifactory-store", raw };
  if (name && /official content|all rights reserved/i.test(name))
    return { id: "all-rights-reserved", raw, label: name };
  const cc = name ? ccId(name) : null;
  if (cc) return { id: cc, raw };
  // A Creative Commons licence the catalogue doesn't have, at an older version: kept by its name, allowing nothing.
  if (name && !/myminifactory/i.test(name) && isCcName(name)) return { id: null, raw, label: name };
  const credit = flags.has("mention") ? flags.get("mention")! : /\bcredit\b/i.test(name ?? "");
  return {
    id: "myminifactory",
    raw,
    label: name,
    allows: ownAllows(flags, name),
    ...(credit ? { requires: { credit: true } } : {}),
  };
}
