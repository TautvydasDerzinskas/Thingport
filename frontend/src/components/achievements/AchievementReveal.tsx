import type React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import Typography from "@mui/material/Typography";
import { achievementName, achievementRule, tierLabel, type ShownAchievement } from "../../constants/achievements";
import AchievementBadge from "./AchievementBadge";

// The moment a Diamond or Holographic badge is earned: rays turning behind it, a burst of sparks, the badge popping
// in. Plays once; with reduced motion it simply shows.

const turn = keyframes`to { transform: rotate(360deg); }`;
const pop = keyframes`
  0% { transform: scale(0.2) rotate(-25deg); opacity: 0; }
  55% { transform: scale(1.15) rotate(4deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
`;
const burst = keyframes`
  0% { transform: translate(0, 0) scale(0.4); opacity: 0; }
  10% { opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) scale(1.2); opacity: 0; }
`;
const rise = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
`;

// The night the badge appears against, the same in both themes, as the weather scene's sky is.
const NIGHT = "radial-gradient(circle at 50% 40%, #2b2f6b 0%, #12153a 60%, #0b0d24 100%)";
const RAY = "rgba(158, 234, 255, 0.35)";
const SPARKS = ["#ffd84d", "#9feaff"];

type Props = { achievement: ShownAchievement | null; onClose: () => void };

export default function AchievementReveal({ achievement, onClose }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const def = achievement?.def;
  return (
    <Dialog
      open={!!achievement}
      onClose={onClose}
      aria-labelledby="achievement-reveal-title"
      slotProps={{
        paper: { sx: { width: 380, maxWidth: "calc(100% - 32px)", overflow: "hidden", background: NIGHT } },
      }}
    >
      {achievement && def && (
        <Box
          sx={{
            position: "relative",
            px: 3,
            pt: 5,
            pb: 3,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            color: "common.white",
            textAlign: "center",
            "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important" } },
          }}
        >
          <Box
            aria-hidden
            sx={{ position: "absolute", left: "50%", top: 120, animation: `${turn} 18s linear infinite` }}
          >
            {Array.from({ length: 16 }, (_, i) => (
              <Box
                key={i}
                sx={{
                  position: "absolute",
                  left: -6,
                  top: -260,
                  width: 12,
                  height: 260,
                  transformOrigin: "6px 260px",
                  transform: `rotate(${i * 22.5}deg)`,
                  background: `linear-gradient(to top, transparent, ${RAY})`,
                  clipPath: "polygon(50% 100%, 0 0, 100% 0)",
                }}
              />
            ))}
          </Box>
          <Box aria-hidden sx={{ position: "absolute", left: "50%", top: 120 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <Box
                key={i}
                style={
                  {
                    "--dx": `${Math.round(Math.cos((i / 10) * Math.PI * 2) * 130)}px`,
                    "--dy": `${Math.round(Math.sin((i / 10) * Math.PI * 2) * 110)}px`,
                  } as React.CSSProperties
                }
                sx={{
                  position: "absolute",
                  width: 9,
                  height: 9,
                  ml: "-4.5px",
                  mt: "-4.5px",
                  opacity: 0,
                  bgcolor: SPARKS[i % 2],
                  clipPath: "polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%)",
                  animation: `${burst} 1.1s ease-out 0.35s both`,
                }}
              />
            ))}
          </Box>
          <Box sx={{ position: "relative", animation: `${pop} 600ms cubic-bezier(.3,1.5,.5,1) both` }}>
            <AchievementBadge def={def} tier={achievement.tier} size={150} />
          </Box>
          <Box sx={{ position: "relative", animation: `${rise} 300ms ease-out 450ms both` }}>
            <Typography variant="overline" sx={{ opacity: 0.8, display: "block", mt: 2, lineHeight: 1.6 }}>
              {t("achievements.unlocked")}
            </Typography>
            <Typography id="achievement-reveal-title" sx={{ fontWeight: 800, fontSize: 20 }}>
              {achievementName(def, t)}
            </Typography>
            <Typography sx={{ opacity: 0.8, fontSize: 13.5, mt: 0.25 }}>
              {tierLabel(def, achievement.tier, t)} · {achievementRule(def, achievement.tier, t)}
            </Typography>
            <Button variant="contained" onClick={onClose} sx={{ mt: 3 }}>
              {t("achievements.great")}
            </Button>
          </Box>
        </Box>
      )}
    </Dialog>
  );
}
