import { useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import type { Achievement, OwnAchievement } from "../../api/achievements";
import { achievementName, tierLabel, type ShownAchievement } from "../../constants/achievements";
import HelpTip from "../HelpTip";
import AchievementBadge from "./AchievementBadge";
import AchievementDialog from "./AchievementDialog";
import AllAchievementsDialog from "./AllAchievementsDialog";

// A person's badges at the foot of their profile's left column (ProfileLayout): their best three on a shelf, with
// names, and the rest small in a strip under it. A badge opens it big; "All" has every one, grouped.

const SHELF = 3;
const STRIP = 7;

const appear = keyframes`
  from { opacity: 0; transform: translateY(6px) scale(0.92); }
  to { opacity: 1; transform: none; }
`;

/** Which dialog is open: one badge, by id, or all of them. */
export type ShowcaseOpen = { badge: string } | "all" | null;

type Props = {
  items: ShownAchievement<Achievement | OwnAchievement>[];
  /** The viewer's own: an empty list says how to earn one, and a badge shows how far its next tier is. */
  own?: boolean;
  /** Open from outside, as a notification's link does. */
  open?: ShowcaseOpen;
  onOpenChange?: (open: ShowcaseOpen) => void;
};

export default function AchievementsShowcase({ items, own, open: openFromOutside, onOpenChange }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const [openHere, setOpenHere] = useState<ShowcaseOpen>(null);
  const open = openFromOutside !== undefined ? openFromOutside : openHere;
  const setOpen = (next: ShowcaseOpen) => {
    setOpenHere(next);
    onOpenChange?.(next);
  };
  if (!own && !items.length) return null;

  const shelf = items.slice(0, SHELF);
  const strip = items.slice(SHELF, SHELF + STRIP);
  const more = items.length - shelf.length - strip.length;
  const detail = open && open !== "all" ? (items.find((item) => item.id === open.badge) ?? null) : null;
  const label = (item: ShownAchievement) =>
    `${achievementName(item.def, t)}, ${item.expired ? t("achievements.lapsed") : tierLabel(item.def, item.tier, t)}`;
  const entrance = (index: number) => ({
    animation: `${appear} 260ms ease-out ${index * 50}ms both`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  });
  const focusSx = { "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } };

  return (
    <Box component="section" aria-labelledby="achievements-heading">
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 3, mb: 1.25 }}>
        <Typography id="achievements-heading" variant="subtitle1" fontWeight={700} component="h2">
          {t("achievements.title")}
        </Typography>
        {items.length > 0 && (
          <Chip size="small" label={items.length} sx={{ height: 20, fontSize: 11.5, fontWeight: 700 }} />
        )}
        <HelpTip text={t(own ? "achievements.helpOwn" : "achievements.help")} />
        {items.length > 0 && (
          <Button
            size="small"
            endIcon={<ChevronRightIcon />}
            onClick={() => setOpen("all")}
            sx={{ ml: "auto !important", minWidth: 0, px: 1 }}
          >
            {t("achievements.all", { value: items.length })}
          </Button>
        )}
      </Stack>

      {!items.length ? (
        <Typography variant="body2" color="text.secondary">
          {t("achievements.empty")}
        </Typography>
      ) : (
        <>
          <Box
            sx={(theme) => ({
              display: "grid",
              gridTemplateColumns: `repeat(${SHELF}, 1fr)`,
              px: 1,
              pt: 2,
              pb: 1.25,
              borderRadius: "12px",
              background: `linear-gradient(180deg, transparent, ${alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.07 : 0.05)})`,
              borderBottom: "3px solid",
              borderColor: "divider",
            })}
          >
            {shelf.map((item, index) => (
              <ButtonBase
                key={item.id}
                onClick={() => setOpen({ badge: item.id })}
                aria-label={label(item)}
                sx={{
                  flexDirection: "column",
                  gap: 0.75,
                  borderRadius: "10px",
                  py: 0.5,
                  ...focusSx,
                  ...entrance(index),
                }}
              >
                <AchievementBadge def={item.def} tier={item.tier} size={64} expired={item.expired} />
                <Typography
                  variant="caption"
                  fontWeight={600}
                  aria-hidden
                  sx={{
                    lineHeight: 1.2,
                    textAlign: "center",
                    fontSize: 11.5,
                    px: 0.25,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {achievementName(item.def, t)}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
          {(strip.length > 0 || more > 0) && (
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 1.25, flexWrap: "wrap", alignItems: "center" }}>
              {strip.map((item, index) => (
                <Tooltip key={item.id} title={label(item)}>
                  <ButtonBase
                    onClick={() => setOpen({ badge: item.id })}
                    aria-label={label(item)}
                    sx={{ borderRadius: "8px", p: 0.25, ...focusSx, ...entrance(SHELF + index) }}
                  >
                    <AchievementBadge def={item.def} tier={item.tier} size={30} expired={item.expired} />
                  </ButtonBase>
                </Tooltip>
              ))}
              {more > 0 && (
                <ButtonBase
                  onClick={() => setOpen("all")}
                  aria-label={t("achievements.more", { count: more })}
                  sx={{ borderRadius: "8px", px: 0.75, py: 0.5, color: "text.secondary", ...focusSx }}
                >
                  <Typography variant="caption" fontWeight={700}>
                    +{more}
                  </Typography>
                </ButtonBase>
              )}
            </Stack>
          )}
        </>
      )}

      <AllAchievementsDialog
        open={open === "all"}
        items={items}
        onPick={(badge) => setOpen({ badge })}
        onClose={() => setOpen(null)}
      />
      <AchievementDialog achievement={detail} onClose={() => setOpen(null)} />
    </Box>
  );
}
