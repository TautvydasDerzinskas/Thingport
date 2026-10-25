// What every provider's collection tile (providers/<id>/CollectionTile.tsx) is drawn with, for the sync dialog.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import type { Theme } from "@mui/material/styles";
import type { BrowsableProvider, ProviderCollection } from "../api/providerCollections";
import { MANIFESTS } from "./index.generated";

/** Each provider's own accent, so a tile reads as theirs. */
export const accent = (provider: BrowsableProvider) => MANIFESTS[provider].brand.accent;

export type TileProps = { provider: BrowsableProvider; collection: ProviderCollection };

/** `lines`: the title and count's skeleton lines, drawn where the tile puts them. */
export type SkeletonProps = { lines: ReactNode; provider: BrowsableProvider };

export const sunken = (theme: Theme) => (theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.06)" : "#f4f4f4");

/** A model image, or an empty slot when the collection has fewer. */
export function Thumb({ src, sx }: { src: string | undefined; sx?: object }) {
  const base = { display: "block", width: "100%", bgcolor: sunken, ...sx };
  return src ? (
    <Box component="img" src={src} alt="" loading="lazy" sx={{ ...base, objectFit: "cover" }} />
  ) : (
    <Box sx={base} />
  );
}

export function ModelCount({ count, provider }: { count: number; provider: BrowsableProvider }) {
  const { t } = useTranslation("models");
  return <>{t(`collections.sync.browse.${MANIFESTS[provider].modelNoun}`, { count })}</>;
}
