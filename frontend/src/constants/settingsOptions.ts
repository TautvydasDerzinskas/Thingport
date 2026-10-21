export type SlicerOption = { id: string; label: string };

// Slicers that register a URL protocol. IDs must match the backend's SLICER_IDS and (except
// "other") equal the scheme the slicer registers, e.g. "crealityprintlink". Some are launched via
// the Bridge instead (see utils/slicerLaunch.ts).
export const SLICER_OPTIONS: SlicerOption[] = [
  { id: "bambustudio", label: "Bambu Studio" },
  { id: "orcaslicer", label: "OrcaSlicer" },
  { id: "prusaslicer", label: "PrusaSlicer" },
  { id: "cura", label: "Cura" },
  { id: "crealityprintlink", label: "Creality Print" },
  { id: "anycubicslicernext", label: "Anycubic Slicer Next" },
  { id: "elegooslicer", label: "Elegoo Slicer" },
  { id: "snapmaker-orca", label: "Snapmaker Orca" },
  { id: "other", label: "Other / Manual" },
];

// Offered "Open normalized in <slicer>" for MakerWorld 3MFs. They mis-import Bambu projects (lost colors,
// settings or parts); Orca forks too, since each copied Bambu's 3MF handling at a different point.
export const NORMALIZE_3MF_SLICER_IDS: ReadonlySet<string> = new Set([
  "prusaslicer",
  "cura",
  "anycubicslicernext",
  "crealityprintlink",
  "elegooslicer",
  "snapmaker-orca",
]);

/** "system" follows prefers-color-scheme; resolve with useResolvedTheme before rendering. */
export type ThemeSelection = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
/** Kept in sync by hand with the backend's ACCENT_COLORS. Thingport green first, then providers' brands, then a
 *  near-black graphite. */
export const ACCENT_COLORS = ["green", "blue", "orange", "amber", "teal", "purple", "graphite"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];
export const DEFAULT_ACCENT: AccentColor = "green";
/** Kept in sync by hand with the backend's RENDER_COLORS: the accents, then a light grey that leaves the render's
 *  own shading all but untinted. */
export const RENDER_COLORS = [...ACCENT_COLORS, "light"] as const;
export type RenderColor = (typeof RENDER_COLORS)[number];

/** The `t()` key naming a render colour. */
export function renderColorLabelKey(color: RenderColor): string {
  return color === "light" ? "app:appearance.renderColor.light" : `app:appearance.accents.${color}`;
}
export type ThemeOption = { id: ThemeSelection; label: string; description: string };

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "light", label: "Light", description: "Bright backgrounds, dark text." },
  { id: "dark", label: "Dark", description: "Dimmed panels for low light." },
  { id: "system", label: "Adapt to system", description: "Follows your device's light/dark setting." },
];
