import type React from "react";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

// One of Studio's side panels: its name, or tabs for what it can show one at a time, and a button that folds it away to
// its side, where a tab opens it again.

const fromLeft = keyframes`from { opacity: 0; transform: translateX(-12px); }`;
const fromRight = keyframes`from { opacity: 0; transform: translateX(12px); }`;

/** One of what a panel shows in turn; `badge` marks one with news, such as a change an AI made. */
export type SidePanelTab = { id: string; label: string; badge?: boolean };

type Props = {
  title: string;
  /** Shown in place of the title: the panel shows one of them at a time. */
  tabs?: { items: SidePanelTab[]; value: string; onChange: (id: string) => void };
  side: "left" | "right";
  hideLabel: string;
  onHide: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export default function SidePanel({ title, tabs, side, hideLabel, onHide, actions, children }: Props) {
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
      <Stack
        direction="row"
        alignItems="center"
        sx={{ pl: tabs ? 0.5 : 1.5, pr: 0.75, pt: tabs ? 0 : 0.75, minHeight: 36 }}
      >
        {tabs ? (
          <Tabs
            value={tabs.value}
            onChange={(_, id: string) => tabs.onChange(id)}
            aria-label={title}
            sx={{ flex: 1, minHeight: 36, "& .MuiTabs-indicator": { height: 2 } }}
          >
            {tabs.items.map((item) => (
              <Tab
                key={item.id}
                value={item.id}
                label={
                  <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    {item.label}
                    {item.badge && <BadgeDot />}
                  </Box>
                }
                sx={{
                  minHeight: 36,
                  minWidth: 0,
                  px: 1,
                  py: 0,
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                }}
              />
            ))}
          </Tabs>
        ) : (
          <Typography
            variant="caption"
            component="h2"
            sx={{ flex: 1, fontWeight: 700, color: "text.secondary", textTransform: "uppercase" }}
          >
            {title}
          </Typography>
        )}
        {actions}
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

/** A small dot beside a label: something new to look at there. */
export function BadgeDot() {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "primary.main", flexShrink: 0 }}
    />
  );
}
