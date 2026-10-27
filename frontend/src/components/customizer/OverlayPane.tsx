import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { alpha } from "@mui/material/styles";

type Props = {
  title: string;
  /** Buttons that belong to the pane, shown at the right of its title. */
  action?: ReactNode;
  /** Set to make the pane foldable; left out, it has no fold control and is always open. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Lets the pane's body scroll on its own rather than growing the column. Not foldable. */
  scrollBody?: boolean;
  /** Stays put below the body while it scrolls: the pane's own primary action. */
  footer?: ReactNode;
  /** Shown beside the title once folded, so what the pane is about doesn't go with its contents. */
  whenCollapsed?: ReactNode;
  children: ReactNode;
};

/**
 * One pane of the customizer's left column: a titled card floating over the model.
 *
 * Translucent rather than solid, so the model stays visible behind it on a narrow window where the panes cover
 * much of the view. Blurred where the browser has one, nearly opaque where it doesn't, so the text is readable
 * either way.
 */
export default function OverlayPane({
  title,
  action,
  collapsed,
  onCollapsedChange,
  scrollBody,
  footer,
  whenCollapsed,
  children,
}: Props) {
  const { t } = useTranslation("models");
  const foldable = collapsed !== undefined && Boolean(onCollapsedChange);
  const open = !foldable || !collapsed;
  const body = (
    <Box sx={{ p: 1.5, ...(scrollBody ? { flex: 1, minHeight: 0, overflowY: "auto" } : {}) }}>{children}</Box>
  );

  return (
    <Paper
      elevation={6}
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        // Gives way before its own title does, so a folded pane is still a readable bar.
        minHeight: 0,
        // A scrolling pane takes what the panes above it leave, which is the height its body scrolls within.
        ...(scrollBody ? { flex: 1 } : { flexShrink: 0 }),
        bgcolor: (theme) => alpha(theme.palette.background.paper, 0.92),
        backdropFilter: "blur(10px)",
        "@supports not (backdrop-filter: blur(10px))": {
          bgcolor: (theme) => alpha(theme.palette.background.paper, 0.985),
        },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        sx={{ flexShrink: 0, pl: 1.5, pr: 0.75, py: 0.75, borderBottom: open ? 1 : 0, borderColor: "divider" }}
      >
        <Typography
          variant="overline"
          sx={{ color: "text.secondary", fontWeight: 700, letterSpacing: 0.8, lineHeight: 1.6 }}
        >
          {title}
        </Typography>
        {!open && whenCollapsed && <Box sx={{ minWidth: 0, flex: 1 }}>{whenCollapsed}</Box>}
        <Box sx={{ flex: open || !whenCollapsed ? 1 : "0 0 auto" }} />
        {action}
        {foldable && (
          <Tooltip title={open ? t("customizer.pane.minimize") : t("customizer.pane.expand")}>
            <IconButton
              size="small"
              onClick={() => onCollapsedChange!(open)}
              aria-label={open ? t("customizer.pane.minimize") : t("customizer.pane.expand")}
              aria-expanded={open}
            >
              {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {/* A scrolling pane is never folded, so it needn't go through Collapse's own height juggling. */}
      {scrollBody ? (
        body
      ) : (
        <Collapse in={open} timeout={200}>
          {body}
        </Collapse>
      )}
      {open && footer && (
        <Box sx={{ flexShrink: 0, p: 1.5, pt: 1, borderTop: 1, borderColor: "divider" }}>{footer}</Box>
      )}
    </Paper>
  );
}
