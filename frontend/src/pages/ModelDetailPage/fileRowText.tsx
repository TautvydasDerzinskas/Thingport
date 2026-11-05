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

/** Slicer words an auto-generated profile title is made of ("0.2mm layer, 2 walls, 10% infill (modifiers)"). */
const TITLE_FILLER = new Set([
  "mm",
  "layer",
  "layers",
  "wall",
  "walls",
  "infill",
  "support",
  "supports",
  "modifier",
  "modifiers",
]);
/** Titles longer than this are never a plain numbers recap; also bounds the work on hostile input. */
const MAX_REDUNDANT_TITLE = 200;

/**
 * Whether a profile title only repeats the numbers `profileSummary` already shows, in slicer filler words
 * ("0.275mm layer, 1 walls, 5% infill (modifiers)"). A title with any other number or word ("Draft",
 * "0.20mm Standard @BBL X1C") carries information and is not redundant. Compares numbers by value, so "0.20" matches 0.2.
 */
export function isRedundantTitle(title: string | null | undefined, profile: PlateProfile): boolean {
  if (!title || title.length > MAX_REDUNDANT_TITLE) return false;
  const shown = [profile.layer_height_mm, profile.walls, profile.infill_density_pct].filter(
    (n): n is number => n != null && Number.isFinite(n),
  );
  const lower = title.toLowerCase();
  const numbers = lower.match(/\d+(?:[.,]\d+)?/g);
  if (!numbers) return false;
  const known = numbers.every((n) => {
    const v = Number(n.replace(",", "."));
    return shown.some((s) => Math.abs(s - v) < 1e-6);
  });
  if (!known) return false;
  return lower
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .split(/[^a-z]+/)
    .every((w) => !w || TITLE_FILLER.has(w));
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
  const summary = profile ? profileSummary(t, profile, locale) : null;
  // A title that only repeats the settings line adds nothing, so the file name takes its place.
  const title = profile?.title && !isRedundantTitle(profile.title, profile) ? profile.title : null;
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
          // Up to two lines before the ellipsis, so a narrow row (or the "Default" chip beside it) doesn't cut
          // the settings line to a few words; the full text is in the row's tooltip.
          sx={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            whiteSpace: "normal",
          }}
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
