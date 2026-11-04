import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import type { TFunction } from "i18next";
import type { PlateProfile } from "../../api/prints";
import ProfileBadges, { formatMm, hasProfileBadges } from "../../components/ProfileBadges";
import { infillText } from "../../components/ProfileDetails";
import { extOf, stemOf } from "../../utils/fileExtensions";

/**
 * The print settings a 3MF gives as one line: "0.08 mm · 6 walls · 40 % Gyroid · Tree supports". Fixed order;
 * whatever the file doesn't say is left out; null when it says none of it. Built from the structured fields,
 * never from the profile's free-text title. "No supports" is left out: it is the plain case.
 */
export function profileSummary(t: TFunction, profile: PlateProfile, locale: string): string | null {
  const parts = [
    profile.layer_height_mm != null ? `${formatMm(profile.layer_height_mm, locale)} mm` : null,
    profile.walls != null && profile.walls > 0 ? t("models:detail.summaryWalls", { count: profile.walls }) : null,
    infillText(profile, locale, (key) => t(`models:detail.details.infillPatterns.${key}`, { defaultValue: key })),
    profile.supports === "normal"
      ? t("models:detail.summarySupportsNormal")
      : profile.supports === "tree"
        ? t("models:detail.summarySupportsTree")
        : null,
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * e.g. "Body" / "File 2 · STL". A 3MF with a slicer profile shows its print settings line
 * (`profileSummary`) and the profile's icon badges instead, the profile title moving to the second line; a title
 * without such fields stays the headline. Whatever is missing falls back to today's text.
 */
export function fileRowText(
  t: TFunction,
  filename: string,
  index: number,
  profile?: PlateProfile | null,
  locale = "en",
): { primary: string; secondary: ReactNode } {
  const type = extOf(filename).toUpperCase();
  const stem = stemOf(filename);
  const title = profile?.title || null;
  const summary = profile ? profileSummary(t, profile, locale) : null;
  const badges = profile && hasProfileBadges(profile) ? <ProfileBadges profile={profile} /> : null;
  const plain = type
    ? t("models:detail.fileMeta", { n: index + 1, type })
    : t("models:detail.fileLabel", { n: index + 1 });
  // The headline replaces the name, so the name (or, under the settings line, the profile title with the name as
  // hover text) moves to the second line instead of vanishing.
  const second = summary ? title || stem : stem;
  const secondary = badges ? (
    title || summary ? (
      <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Box
          component="span"
          title={summary && title ? `${stem} · ${plain}` : undefined}
          sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {second}
        </Box>
        {badges}
      </Box>
    ) : (
      badges
    )
  ) : summary || title ? (
    `${summary ? title || stem : stem} · ${plain}`
  ) : (
    plain
  );
  return { primary: summary || title || stem, secondary };
}
