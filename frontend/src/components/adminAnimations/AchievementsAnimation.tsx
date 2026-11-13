import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { achievementDef } from "../../constants/achievements";
import AchievementBadge from "../achievements/AchievementBadge";
import { prefersReducedMotion } from "../storageAnimations/parts";

// A badge on a ribbon, swinging a little and catching the light. Off, it hangs still and grey behind a padlock.
//
// SVG rather than boxes: dark mode squares every CSS corner, and the badge and padlock should keep their shapes.

const swing = keyframes`
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
`;
const RIBBON = "#00b800";
const RIBBON_SHADE = "#009400";
const OFF = "#9aa2ad";
const OFF_SHADE = "#b6bcc6";
const LOCK = "#64748b";

export default function AchievementsAnimation({ size = 76, on }: { size?: number; on: boolean }) {
  const def = achievementDef("downloads");
  const badge = Math.round(size * 0.6);
  const moving = on && !prefersReducedMotion();
  return (
    <Box sx={{ position: "relative", width: size, height: size, display: "grid", placeItems: "center" }}>
      <Box sx={{ transformOrigin: "50% 0", animation: moving ? `${swing} 3.2s ease-in-out infinite` : "none" }}>
        <svg
          width={badge}
          height={badge * 0.48}
          viewBox="0 0 46 22"
          aria-hidden
          style={{ display: "block", margin: "0 auto -4px" }}
        >
          <path d="M8 0H20L28 22H16Z" fill={on ? RIBBON : OFF_SHADE} />
          <path d="M38 0H26L18 22H30Z" fill={on ? RIBBON_SHADE : OFF} />
        </svg>
        {def && <AchievementBadge def={def} tier={2} size={badge} expired={!on} />}
      </Box>
      {!on && (
        <Box sx={{ position: "absolute", right: size * 0.1, bottom: size * 0.1 }}>
          <svg width={size * 0.26} height={size * 0.29} viewBox="0 0 20 22" aria-hidden style={{ display: "block" }}>
            <path d="M5 10V7a5 5 0 0 1 10 0v3" fill="none" stroke={LOCK} strokeWidth="2.4" />
            <rect x="2" y="10" width="16" height="11" rx="2.5" fill={LOCK} />
          </svg>
        </Box>
      )}
    </Box>
  );
}
