import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import type { Achievement, OwnAchievement } from "../../api/achievements";
import {
  achievementName,
  achievementRule,
  achievementStat,
  materialOf,
  tierLabel,
  type Material,
  type ShownAchievement,
} from "../../constants/achievements";
import AchievementBadge from "./AchievementBadge";

// One badge, big: what it is, its tier and when it was reached, and for its owner where it stands and how far the
// next tier is. Others see the badge and what it's for, not the counts behind it.

// The glow behind it, in the badge's own colour (the illustration's, as the badge's are).
const GLOW: Record<Material, string> = {
  bronze: "rgba(224, 138, 76, 0.35)",
  silver: "rgba(160, 172, 190, 0.35)",
  gold: "rgba(255, 200, 60, 0.4)",
  platinum: "rgba(180, 160, 255, 0.4)",
  diamond: "rgba(79, 220, 247, 0.4)",
  holo: "rgba(255, 110, 199, 0.35)",
  secret: "rgba(0, 184, 0, 0.35)",
};

const isOwn = (item: Achievement): item is OwnAchievement => "count" in item;

type Props = {
  achievement: ShownAchievement<Achievement | OwnAchievement> | null;
  onClose: () => void;
};

export default function AchievementDialog({ achievement, onClose }: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  if (!achievement) return null;
  const { def, tier } = achievement;
  const name = achievementName(def, t);
  const own = isOwn(achievement) ? achievement : null;
  const stat = own ? achievementStat(def, own.count, t) : null;
  const earned = achievement.earned_at
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(new Date(achievement.earned_at))
    : null;
  // As the numbers beside it read: how much of the next tier's count there is.
  const progress = own?.next && own.count !== null ? (own.count / own.next) * 100 : 0;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="achievement-dialog-title">
      <DialogTitle id="achievement-dialog-title" sx={{ pr: 6 }}>
        {name}
        <Tooltip title={t("common:close")}>
          <IconButton
            aria-label={t("common:close")}
            onClick={onClose}
            sx={{ position: "absolute", right: 12, top: 12 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack alignItems="center" sx={{ textAlign: "center" }}>
          <Box
            sx={{
              width: 200,
              height: 170,
              display: "grid",
              placeItems: "center",
              background: `radial-gradient(closest-side, ${GLOW[materialOf(def, tier)]}, transparent)`,
            }}
          >
            <AchievementBadge def={def} tier={tier} size={128} expired={achievement.expired} />
          </Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              {tierLabel(def, tier, t)}
            </Typography>
            {achievement.expired && <Chip size="small" label={t("achievements.lapsed")} />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {achievementRule(def, tier, t)}
          </Typography>
          {earned && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              {t("achievements.earnedOn", { date: earned })}
            </Typography>
          )}
          {achievement.expired && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {t("achievements.lapsedHint")}
            </Typography>
          )}
          {own && (stat || own.next) && (
            <Box sx={{ width: "100%", mt: 2.5, textAlign: "left" }}>
              {stat && (
                <Typography variant="body2" fontWeight={600}>
                  {stat}
                </Typography>
              )}
              {own.next !== null && own.count !== null ? (
                <>
                  <Stack direction="row" justifyContent="space-between" sx={{ mt: 1, mb: 0.5 }}>
                    <Typography variant="caption" fontWeight={600}>
                      {t("achievements.next", { value: own.next })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {own.count} / {own.next}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.max(0, Math.min(100, progress))}
                    aria-label={t("achievements.next", { value: own.next })}
                    sx={{ height: 6, borderRadius: 3 }}
                  />
                </>
              ) : (
                !def.material && (
                  <Typography variant="caption" color="text.secondary">
                    {t("achievements.top")}
                  </Typography>
                )
              )}
            </Box>
          )}
          {tier > 0 && (
            <Stack direction="row" spacing={1} sx={{ mt: 2.5 }} aria-label={t("achievements.tiersEarned")}>
              {def.thresholds.slice(0, tier + 1).map((threshold, earnedTier) => (
                <AchievementBadge key={threshold} def={def} tier={earnedTier} size={30} />
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
