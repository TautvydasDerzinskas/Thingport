import type { ReactNode } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import HelpTip from "../../components/HelpTip";

const rise = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
`;

type Props = {
  title: string;
  /** Behind the `?` beside the title. */
  help: string;
  icon: ReactNode;
  /** Its place on the page, so the sections rise one after another. */
  order: number;
  /** At the end of the heading's line. */
  action?: ReactNode;
  children: ReactNode;
};

/** One of Explore's rows: a heading, and what's in it rising into place. */
export default function ExploreSection({ title, help, icon, order, action, children }: Props) {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{
        animation: `${rise} 240ms ease-out both`,
        animationDelay: `${order * 60}ms`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5, color: "text.secondary" }}>
        {icon}
        <Typography
          variant="subtitle1"
          component="h2"
          fontWeight={700}
          sx={{ color: (theme) => theme.thingport.headingText }}
        >
          {title}
          <HelpTip text={help} />
        </Typography>
        {action && <Box sx={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>{action}</Box>}
      </Stack>
      {children}
    </Box>
  );
}
