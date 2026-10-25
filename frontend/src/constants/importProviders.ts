import type { Theme } from "@mui/material/styles";
import { MANIFESTS, PROVIDER_IDS, type Chip } from "../providers/index.generated";

// `color`/`textColor` are sx palette tokens or hex brand colors; `textColor` may also be a theme
// callback. `outlined` adds a primary-colour ring.
export type ImportProviderInfo = {
  label: string;
  color: string;
  textColor?: string | ((theme: Theme) => string);
  outlined?: boolean;
};

/** A manifest's chip as sx values. */
function chipInfo(label: string, { bg, fg }: Chip): ImportProviderInfo {
  const textColor =
    fg === "black"
      ? "common.black"
      : fg === "inverse"
        ? (theme: Theme) => (theme.palette.mode === "dark" ? "#FFFFFF" : theme.palette.background.paper)
        : fg;
  return { label, color: bg === "text" ? "text.primary" : bg, ...(textColor && { textColor }) };
}

export const IMPORT_PROVIDER_INFO: Record<string, ImportProviderInfo> = {
  ...Object.fromEntries(PROVIDER_IDS.map((id) => [id, chipInfo(MANIFESTS[id].name, MANIFESTS[id].brand.chip)])),
  // Direct uploads (source_provider is null).
  thingport: { label: "Thingport", color: "common.white", textColor: "common.black", outlined: true },
};

/** Known external providers only; null for uploads. */
export function importProviderInfo(provider: string | null | undefined): ImportProviderInfo | null {
  if (!provider) return null;
  return IMPORT_PROVIDER_INFO[provider] ?? null;
}

/** Like importProviderInfo, but falls back to "Thingport" for uploads. */
export function printProviderInfo(provider: string | null | undefined): ImportProviderInfo {
  return importProviderInfo(provider) ?? IMPORT_PROVIDER_INFO.thingport;
}

/** The fill, text and ring of a provider chip. */
export function providerChipSx(info: ImportProviderInfo) {
  return {
    bgcolor: info.color,
    color: info.textColor ?? "#fff",
    // An inset ring, so the outlined chip stays the same size as the others.
    ...(info.outlined && { boxShadow: (theme: Theme) => `inset 0 0 0 1.5px ${theme.palette.primary.main}` }),
  };
}
