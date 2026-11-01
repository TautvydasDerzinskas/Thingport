import type { TFunction } from "i18next";
import type { PlateProfile } from "../../api/prints";
import { extOf, stemOf } from "../../utils/fileExtensions";

/** 0.40 -> "0.4": no trailing zeros. */
const num = (n: number) => String(Number(n.toFixed(3)));

function profileChips(t: TFunction, p: PlateProfile): string[] {
  const chips: (string | null)[] = [
    p.printer || null,
    p.nozzle_mm != null ? t("models:detail.profileNozzle", { value: num(p.nozzle_mm) }) : null,
    p.layer_height_mm != null ? t("models:detail.profileLayer", { value: num(p.layer_height_mm) }) : null,
    p.materials?.length ? p.materials.join("/") : null,
    p.plates != null ? t("models:detail.profilePlates", { count: p.plates }) : null,
  ];
  return chips.filter((c): c is string => !!c);
}

/**
 * e.g. "Body" / "File 2 · STL". A 3MF with a slicer profile shows its profile title and
 * "printer · nozzle · layer · material · plates" instead; whatever is missing falls back to today's text.
 */
export function fileRowText(
  t: TFunction,
  filename: string,
  index: number,
  profile?: PlateProfile | null,
): { primary: string; secondary: string } {
  const type = extOf(filename).toUpperCase();
  const chips = profile ? profileChips(t, profile) : [];
  return {
    primary: profile?.title || stemOf(filename),
    secondary: chips.length
      ? chips.join(" · ")
      : type
        ? t("models:detail.fileMeta", { n: index + 1, type })
        : t("models:detail.fileLabel", { n: index + 1 }),
  };
}
