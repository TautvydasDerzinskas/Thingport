import type { ReactNode } from "react";
import type { Theme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import KeyboardCommandKeyIcon from "@mui/icons-material/KeyboardCommandKey";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import KeyboardCapslockIcon from "@mui/icons-material/KeyboardCapslock";

export const isMac =
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** Neutral grey for keycaps and icon boxes; the theme's hover colour is tinted green. */
export const chipBg = (theme: Theme) =>
  theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)";

/** The search shortcut's modifier: ⌘ on a Mac, Ctrl everywhere else. */
export const MOD_KEY = isMac ? "⌘" : "Ctrl";
export const SHIFT_KEY = isMac ? "⇧" : "Shift";

// Drawn as icons: the UI font has no ⌘, ↵ or ⇧, and system fallbacks vary.
const GLYPHS: Record<string, ReactNode> = {
  "⌘": <KeyboardCommandKeyIcon sx={{ fontSize: 11 }} />,
  "↵": <KeyboardReturnIcon sx={{ fontSize: 11 }} />,
  "↑": <ArrowUpwardIcon sx={{ fontSize: 11 }} />,
  "↓": <ArrowDownwardIcon sx={{ fontSize: 11 }} />,
  // Shift's outlined arrow, the nearest Material has.
  "⇧": <KeyboardCapslockIcon sx={{ fontSize: 11 }} />,
};

/** A shortcut like "⌘ S" as a row of keycaps. */
export default function Keys({ keys }: { keys: string }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", gap: 0.25, flexShrink: 0 }}>
      {keys
        .split(" ")
        .filter(Boolean)
        .map((key) => (
          <Box
            key={key}
            component="kbd"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 18,
              height: 18,
              px: 0.5,
              borderRadius: "5px",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: chipBg,
              color: "text.secondary",
              fontFamily: "inherit",
              fontSize: 11,
              lineHeight: 1,
            }}
          >
            {GLYPHS[key] ?? key}
          </Box>
        ))}
    </Box>
  );
}
