import { createContext, useContext } from "react";
import type React from "react";
import Box from "@mui/material/Box";
import Paper, { type PaperProps } from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";

/** Inside a tabbed panel, which draws the card's frame and names it on its tab. */
export const TabbedCardContext = createContext(false);

export const cardBorder = (theme: Theme) => (theme.palette.mode === "dark" ? "transparent" : "divider");

type CardProps = PaperProps & {
  /** False for a card that shows one fixed thing, like a count: it's sized to fit its panel, and a scrollbar or a
   *  wheel that scrolls it by a few pixels would only be noise. */
  scroll?: boolean;
};

/** A dashboard card's frame. It fills its grid cell and scrolls what doesn't fit. */
export default function DashboardCard({ scroll = true, sx, children, ...props }: CardProps) {
  const tabbed = useContext(TabbedCardContext);
  return (
    <Paper
      variant="outlined"
      {...props}
      sx={[
        { height: "100%", boxSizing: "border-box", overflow: scroll ? "auto" : "hidden", borderColor: cardBorder },
        tabbed && { border: 0, borderRadius: 0, bgcolor: "transparent" },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Paper>
  );
}

/** The most of each list the dashboard summary holds; kept in sync by hand with the backend's DASHBOARD_LIST_MAX. */
const SUMMARY_LIST_MAX = 10;

/**
 * Whether a list has more than it shows, for its "See more". A summary list short of the most it can hold is complete;
 * one at that cap may go on. `complete` is for a list the summary always holds whole.
 */
export function hasMore(length: number, shown: number, complete = false): boolean {
  return length > shown || (!complete && length >= SUMMARY_LIST_MAX);
}

/** Marks the part of a card that scrolls, for measuring how tall the card would be with nothing scrolled. */
export const CARD_BODY_CLASS = "dashboard-card-body";

/**
 * The part of a card between its title and its footer (a "See more" link). When the panel is too short for it, only
 * this scrolls, so the title and the footer stay in sight.
 */
export function DashboardCardBody({ children }: { children: React.ReactNode }) {
  return (
    // Shrinks to scroll but never stretches, so the footer follows the last row and spare room goes below it.
    <Box className={CARD_BODY_CLASS} sx={{ flex: "0 1 auto", minHeight: 0, overflow: "auto" }}>
      {children}
    </Box>
  );
}

type TitleProps = {
  icon: React.ReactNode;
  title: string;
  /** Beside the title, at the far end, e.g. a total. Kept in a tabbed panel, where the title isn't. */
  children?: React.ReactNode;
  sx?: SxProps<Theme>;
};

export function DashboardCardTitle({ icon, title, children, sx }: TitleProps) {
  const tabbed = useContext(TabbedCardContext);
  if (tabbed && !children) return null;
  return (
    <Box
      sx={[
        { display: "flex", alignItems: "center", gap: 1, color: "primary.main", minWidth: 0 },
        tabbed && { justifyContent: "flex-end" },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {!tabbed && (
        <>
          {icon}
          <Typography
            variant="h6"
            fontWeight={700}
            noWrap
            sx={{ color: (theme) => theme.thingport.headingText, flex: children ? 1 : undefined }}
          >
            {title}
          </Typography>
        </>
      )}
      {children}
    </Box>
  );
}
