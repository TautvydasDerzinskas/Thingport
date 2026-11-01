import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import type { TFunction } from "i18next";
import type { PlateProfile } from "../../api/prints";
import ProfileBadges, { hasProfileBadges } from "../../components/ProfileBadges";
import { extOf, stemOf } from "../../utils/fileExtensions";

/**
 * e.g. "Body" / "File 2 · STL". A 3MF with a slicer profile shows its profile title and the profile's
 * icon badges instead; whatever is missing falls back to today's text.
 */
export function fileRowText(
  t: TFunction,
  filename: string,
  index: number,
  profile?: PlateProfile | null,
): { primary: string; secondary: ReactNode } {
  const type = extOf(filename).toUpperCase();
  const stem = stemOf(filename);
  const title = profile?.title || null;
  const badges = profile && hasProfileBadges(profile) ? <ProfileBadges profile={profile} /> : null;
  const plain = type
    ? t("models:detail.fileMeta", { n: index + 1, type })
    : t("models:detail.fileLabel", { n: index + 1 });
  // A title replaces the name as the headline, so the name moves to the second line instead of vanishing.
  const secondary = badges ? (
    title ? (
      <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
        <Box component="span" sx={{ flexShrink: 4, minWidth: "3ch", overflow: "hidden", textOverflow: "ellipsis" }}>
          {stem}
        </Box>
        <span aria-hidden>·</span>
        {badges}
      </Box>
    ) : (
      badges
    )
  ) : title ? (
    `${stem} · ${plain}`
  ) : (
    plain
  );
  return { primary: title || stem, secondary };
}
