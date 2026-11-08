import type { TFunction } from "i18next";
import type { Plate, PrintProfile } from "../../../api/prints";
import type { ProfileFormat } from "./format";
import { stemOf } from "../../../utils/fileExtensions";

/** One of a model's print profiles: its file (the plate) and what's known of it. */
export type ProfileEntry = {
  /** The plate's id, which is also its ModelFile's key. */
  key: string;
  plate: Plate;
  profile: PrintProfile | null;
  /** The profile's name, else its file's. */
  title: string;
  /** Its facts are still being read (an older import, opened for the first time). */
  loading: boolean;
};

const ORIGIN_RANK = { designer: 0, community: 1 } as const;

/** Whether anything worth showing is known of it yet. */
function hasFacts(profile: PrintProfile | null): boolean {
  return Boolean(profile && (profile.title || profile.seconds || profile.grams || profile.printer));
}

/**
 * The model's print profiles, the designer's first, then the community's, then any whose maker isn't known, each in
 * the order of their files. A plate is a profile when the backend says so: an older backend never does, and the model
 * shows its files as it always did.
 */
export function profileEntries(
  plates: Plate[],
  profiles: Record<string, PrintProfile>,
  filling: boolean,
): ProfileEntry[] {
  return plates
    .filter((plate) => plate.profile_id)
    .toSorted((a, b) => a.position - b.position)
    .map((plate): ProfileEntry => {
      const profile = profiles[plate.id] ?? plate.profile ?? null;
      return {
        key: plate.id,
        plate,
        profile,
        title: profile?.title?.trim() || stemOf(plate.filename),
        loading: filling && !hasFacts(profile),
      };
    })
    .map((entry, order) => ({ entry, order }))
    .toSorted((a, b) => {
      const rank = (e: ProfileEntry) => (e.profile?.origin ? ORIGIN_RANK[e.profile.origin] : 2);
      return rank(a.entry) - rank(b.entry) || a.order - b.order;
    })
    .map(({ entry }) => entry);
}

/** "Bambu Lab A1 mini · 0.4 mm nozzle". */
export function printerLine(t: TFunction, format: ProfileFormat, profile: PrintProfile | null): string | null {
  if (!profile) return null;
  const nozzle =
    profile.nozzle_mm != null ? t("models:detail.profiles.nozzle", { mm: format.number(profile.nozzle_mm, 2) }) : null;
  return [profile.printer, nozzle].filter(Boolean).join(" · ") || null;
}

/** "0.20 mm layers · 15% infill · 2 walls · supports". */
export function settingsLine(t: TFunction, format: ProfileFormat, profile: PrintProfile | null): string | null {
  if (!profile) return null;
  return (
    [
      profile.layer_mm != null
        ? t("models:detail.profiles.layers", { mm: format.number(profile.layer_mm, 2, true) })
        : null,
      profile.infill ? t("models:detail.profiles.infill", { value: profile.infill }) : null,
      profile.walls != null ? t("models:detail.profiles.walls", { count: profile.walls }) : null,
      profile.supports ? t("models:detail.profiles.supports") : null,
    ]
      .filter(Boolean)
      .join(" · ") || null
  );
}

/** "Plate 2 — Base & Train". */
export function plateName(t: TFunction, index: number, name: string | null | undefined): string {
  const label = t("models:detail.plateLabel", { n: index });
  return name ? `${label} — ${name}` : label;
}

const MAKERS =
  /^(bambu lab|creality|anycubic|elegoo|snapmaker|prusa research|prusa|flashforge|qidi|sovol|artillery)\s+/i;

/** A printer without its maker, for a row with little room: "A1 mini". */
export function shortPrinter(printer: string | null | undefined): string | null {
  if (!printer) return null;
  return printer.replace(MAKERS, "").trim() || printer;
}
