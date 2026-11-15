import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import type { Achievement } from "../../api/achievements";
import { ACHIEVEMENT_GROUPS, achievementName, tierLabel, type ShownAchievement } from "../../constants/achievements";
import AchievementBadge from "./AchievementBadge";

type Props = {
  open: boolean;
  items: ShownAchievement<Achievement>[];
  onPick: (id: string) => void;
  onClose: () => void;
};

/** Every badge someone has earned, grouped by what it's for; picking one opens it. */
export default function AllAchievementsDialog({ open, items, onPick, onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="all-achievements-title">
      <DialogTitle id="all-achievements-title" sx={{ pr: 6 }}>
        {t("achievements.title")}
        <Box component="span" sx={{ color: "text.secondary", fontWeight: 500 }}>
          {" "}
          · {items.length}
        </Box>
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
        <Stack spacing={2}>
          {ACHIEVEMENT_GROUPS.map((group) => {
            const inGroup = items.filter((item) => item.def.group === group);
            if (!inGroup.length) return null;
            return (
              <Box key={group} component="section" aria-label={t(`achievements.groups.${group}`)}>
                <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 2 }}>
                  {t(`achievements.groups.${group}`)}
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 1 }}>
                  {inGroup.map((item) => (
                    <ButtonBase
                      key={item.id}
                      onClick={() => onPick(item.id)}
                      sx={{
                        flexDirection: "column",
                        gap: 0.5,
                        p: 1,
                        borderRadius: "10px",
                        "&:hover": { bgcolor: "action.hover" },
                        "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
                      }}
                    >
                      <AchievementBadge def={item.def} tier={item.tier} size={52} expired={item.expired} />
                      <Typography variant="caption" fontWeight={600} sx={{ lineHeight: 1.2, textAlign: "center" }}>
                        {achievementName(item.def, t)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.2 }}>
                        {item.expired ? t("achievements.lapsed") : tierLabel(item.def, item.tier, t)}
                      </Typography>
                    </ButtonBase>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
