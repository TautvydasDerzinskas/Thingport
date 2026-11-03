import type React from "react";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

// One of Studio's side panels: its name, and a button that folds it away to its side, where a tab opens it again.

const fromLeft = keyframes`from { opacity: 0; transform: translateX(-12px); }`;
const fromRight = keyframes`from { opacity: 0; transform: translateX(12px); }`;

type Props = {
  title: string;
  side: "left" | "right";
  /** "Hide the Features panel". */
  hideLabel: string;
  onHide: () => void;
  children: React.ReactNode;
};

export default function SidePanel({ title, side, hideLabel, onHide, children }: Props) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        animation: `${side === "left" ? fromLeft : fromRight} 200ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ pl: 1.5, pr: 0.75, pt: 0.75, minHeight: 36 }}>
        <Typography
          variant="caption"
          component="h2"
          sx={{ flex: 1, fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}
        >
          {title}
        </Typography>
        <Tooltip title={hideLabel}>
          <IconButton size="small" aria-label={hideLabel} onClick={onHide} sx={{ p: 0.25 }}>
            {/* Towards the side it folds away to. */}
            <ChevronLeftIcon fontSize="small" sx={{ transform: side === "right" ? "rotate(180deg)" : "none" }} />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ flex: 1, minHeight: 0 }}>{children}</Box>
    </Box>
  );
}
