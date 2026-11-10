// What the model page shows of a print profile, as a provider says it, and the helpers its public data is read with.
// The profile's own 3MF says the rest (services/printProfileFile.ts); services/printProfileService.ts merges the two.
// Download, print and like counts and ratings are left out on purpose: they're the site's, and stale the day after.

import { textOfHtml } from "../utils/htmlEntities";

export type ProfileOrigin = "designer" | "community";

export type ProfileFilament = {
  /** As the slicer or site names it: "PLA", "PETG-CF". */
  type: string | null;
  /** "#RRGGBB". */
  color: string | null;
  grams: number | null;
};

/** One build plate of a profile's project, numbered from 1 as slicers number them. */
export type ProfilePlateFacts = {
  index: number;
  name?: string | null;
  seconds?: number | null;
  grams?: number | null;
  filaments?: ProfileFilament[];
};

/** One of a model's print profiles as its provider describes it. Sites say different things, so all of it is optional;
 *  what one leaves out may still come from the profile's 3MF. Zero means unknown to most sites (a slice that failed),
 *  so it's left out rather than kept. */
export type ProviderProfileFacts = {
  title?: string | null;
  /** Plain text. */
  description?: string | null;
  /** Whether the model's designer made it, or someone else. */
  origin?: ProfileOrigin | null;
  /** Who made it, by the name the site shows. */
  creator?: string | null;
  seconds?: number | null;
  grams?: number | null;
  filaments?: ProfileFilament[];
  plates?: ProfilePlateFacts[];
  /** With its maker, as slicers name it: "Bambu Lab A1 mini". */
  printer?: string | null;
  nozzleMm?: number | null;
  layerMm?: number | null;
  /** "15%". */
  infill?: string | null;
  walls?: number | null;
  supports?: boolean | null;
  /** Part of it couldn't be read this time (one of several calls failed): what's here is kept, and it's asked for
   *  again later. */
  partial?: boolean;
};

/** By the id the model's plates are tagged with (Plate.sourceInstanceId). */
export type ProviderProfileFactsById = Record<string, ProviderProfileFacts>;

/** A number above zero, from a number or a numeric string; anything else is unknown. */
export function positive(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `positive`, rounded to `digits` places. */
export function rounded(value: unknown, digits = 0): number | null {
  const n = positive(value);
  if (n === null) return null;
  const scale = 10 ** digits;
  return Math.round(n * scale) / scale || null;
}

/** "#RRGGBB" from "#RRGGBB", "#RRGGBBAA" (alpha dropped: it says nothing about the colour), "RRGGBB", "#RGB" or
 *  "R,G,B". */
export function hexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const rgb = raw.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number);
    if (parts.some((part) => part > 255)) return null;
    return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) return `#${[...hex].map((c) => c + c).join("")}`.toUpperCase();
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return `#${hex.slice(0, 6)}`.toUpperCase();
  return null;
}

const DURATION_UNITS: [RegExp, number][] = [
  [/^d(ays?)?$/, 86400],
  [/^h((ou)?rs?)?$/, 3600],
  [/^m(in(ute)?s?)?$/, 60],
  [/^s(ec(ond)?s?)?$/, 1],
];

/** Seconds from a number of seconds, or from text such as "6h41m", "11h 52m 23s", "7.4h" or "1d 2h". */
export function durationSeconds(value: unknown): number | null {
  if (typeof value === "number") return rounded(value);
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(raw)) return rounded(raw);
  let total = 0;
  let found = false;
  for (const [, amount, unit] of raw.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]+)/g)) {
    const scale = DURATION_UNITS.find(([re]) => re.test(unit))?.[1];
    if (!scale) return null;
    total += Number(amount) * scale;
    found = true;
  }
  return found ? rounded(total) : null;
}

/** "15%" from "15%", "15 %", 15 or "15". */
export function percentText(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*%?$/);
  return match ? `${Number(match[1])}%` : null;
}

/** Plain text from a site's HTML description, at most `max` characters; null when there's none. */
export function plainText(value: unknown, max = 1000): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const plain = textOfHtml(value)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!plain) return null;
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** A trimmed string, or null for an empty one or anything else. */
export function text(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

/** The filaments that say something: a type, a colour or a weight. */
export function filamentsOf(list: ProfileFilament[]): ProfileFilament[] {
  return list.filter((filament) => filament.type || filament.color || filament.grams);
}

/** The first number above zero in a value or a list of them: a nozzle per toolhead, say. */
export function firstPositive(value: unknown): number | null {
  for (const item of Array.isArray(value) ? value : [value]) {
    const n = positive(item);
    if (n !== null) return n;
  }
  return null;
}

/** A plate's own name; null for a slicer's default ("Plate 2", "plate_2"), which says no more than its number. */
export function plateName(value: unknown): string | null {
  const name = text(value);
  return name && !/^plate[\s_-]*\d+$/i.test(name) ? name : null;
}

/** A printer as slicers name it, with its maker in front where the site leaves it out: "Creality K1C". */
export function withMaker(maker: string, printer: unknown): string | null {
  const name = text(printer);
  if (!name) return null;
  return name.toLowerCase().startsWith(maker.toLowerCase()) ? name : `${maker} ${name}`;
}

const isEmpty = (value: unknown) => value === null || value === undefined || (Array.isArray(value) && !value.length);

function withoutEmpty<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => !isEmpty(field))) as T;
}

/** The facts without the fields a site left empty, its plates' too, so what's there is what it said. */
export function compactFacts(facts: ProviderProfileFacts): ProviderProfileFacts {
  const out = withoutEmpty(facts);
  if (out.plates) {
    out.plates = out.plates.map((plate) => withoutEmpty(plate));
  }
  return out;
}
