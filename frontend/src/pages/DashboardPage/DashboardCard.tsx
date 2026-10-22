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
