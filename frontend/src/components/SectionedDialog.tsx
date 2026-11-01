import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import { neutralTint, statusTint } from "../theme";

type CountTone = "neutral" | "alert" | "active";

/** `disabled` shows a section that can't be opened right now, rather than leaving it out. */
export type DialogSection<T extends string> = {
  id: T;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  /** A pill at the row's end. Left out by sections that count nothing. */
  count?: number;
  countTone?: CountTone;
};

const selectedBg = (theme: Theme) =>
  theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
const hoverBg = (theme: Theme) => (theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)");

function countColors(theme: Theme, tone: CountTone) {
  if (tone === "neutral") return { backgroundColor: neutralTint(theme) };
  const { background, text } = statusTint(theme, tone === "alert" ? "error" : "warning");
  return { backgroundColor: background, color: text };
}

/** An icon button in a dialog with `phoneNav="grid"`: big enough to tap on a phone. */
export const dialogIconButtonSx = {
  width: { xs: 44, md: 26 },
  height: { xs: 44, md: 26 },
  p: 0,
  "& .MuiSvgIcon-root": { fontSize: 18 },
};

type NavButtonProps = {
  label: string;
  icon: React.ReactNode;
  chosen: boolean;
  onClick: () => void;
  disabled?: boolean;
  count?: number;
  countTone?: CountTone;
  /** The whole text, for a label long enough to be cut off. */
  title?: string;
  /** "side" for the rail. On phones, "tabs" share one row with no icons; "grid" wraps to two columns, and keeps them. */
  layout?: "side" | "tabs" | "grid";
};

/** A row of the rail, also for rows that sit there below the sections. */
export function SectionNavButton({
  label,
  icon,
  chosen,
  onClick,
  disabled,
  count,
  countTone = "neutral",
  title,
  layout = "side",
}: NavButtonProps) {
  const tabs = layout === "tabs";
  const side = layout === "side";
  return (
    <ButtonBase
      aria-pressed={chosen}
      disabled={disabled}
      onClick={onClick}
      title={title}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: tabs ? "center" : "flex-start",
        gap: 1.25,
        flex: tabs ? 1 : layout === "grid" ? "1 1 40%" : undefined,
        width: side ? "100%" : undefined,
        minHeight: layout === "grid" ? 44 : undefined,
        px: 1.5,
        py: tabs ? 1.25 : 1,
        borderRadius: "8px",
        fontSize: "0.8rem",
        fontWeight: 500,
        // Phone tabs share the width, so only the side menu keeps labels on one line.
        whiteSpace: tabs ? "normal" : "nowrap",
        color: chosen ? (muiTheme) => muiTheme.thingport.headingText : "text.secondary",
        bgcolor: chosen ? selectedBg : "transparent",
        transition: "background-color 150ms",
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        "&.Mui-disabled": { opacity: 0.45 },
        "&:hover": { bgcolor: chosen ? selectedBg : hoverBg },
        "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
      }}
    >
      {!tabs && icon}
      {count === undefined ? (
        label
      ) : (
        <>
          {/* With the pill beside it there's less room. A name can be cut off, as its whole text is on hover; a
              section's label, translated long, takes a second line. */}
          <Box
            component="span"
            sx={
              !side
                ? undefined
                : title
                  ? { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }
                  : { minWidth: 0, whiteSpace: "normal", textAlign: "left" }
            }
          >
            {label}
          </Box>
          <Box
            component="span"
            sx={[
              {
                ml: "auto",
                minWidth: 18,
                height: 18,
                px: "5px",
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "9px",
                fontSize: "0.625rem",
                fontWeight: 700,
              },
              (theme) => countColors(theme, countTone),
            ]}
          >
            {count}
          </Box>
        </>
      )}
    </ButtonBase>
  );
}

// "large" fits wider section names on one line and longer content, e.g. tree editors and lists.
const SIZES = {
  default: { width: 620, height: 520, navWidth: 170 },
  large: { width: 920, height: 680, navWidth: 210 },
};

type Props<T extends string> = {
  open: boolean;
  onClose: () => void;
  title: string;
  sections: DialogSection<T>[];
  section: T;
  onSectionChange: (section: T) => void;
  size?: keyof typeof SIZES;
  /** Beside the title: what's going on right now. */
  titleExtra?: React.ReactNode;
  /** Between the title and the close button. */
  headerActions?: React.ReactNode;
  /** What the sections are, for screen readers. */
  navLabel?: string;
  /** Above and below the sections; on phones, in the strip above the content. */
  railHeader?: React.ReactNode;
  railFooter?: React.ReactNode;
  /** In place of `railFooter` on phones, where a long list would take over the screen. */
  phoneRailFooter?: React.ReactNode;
  /** Phones: "tabs" keeps one row; "grid" wraps to two columns with icons and counts. */
  phoneNav?: "tabs" | "grid";
  /** On top of the dialog's own styles, as for how it opens. */
  paperSx?: SxProps<Theme>;
  children: React.ReactNode;
};

/** Settings by section, like the app's Configuration: the sections on the left (tabs along the top
 *  on phones), the chosen one on the right. */
export default function SectionedDialog<T extends string>({
  open,
  onClose,
  title,
  sections,
  section,
  onSectionChange,
  size = "default",
  titleExtra,
  headerActions,
  navLabel,
  railHeader,
  railFooter,
  phoneRailFooter,
  phoneNav = "tabs",
  paperSx,
  children,
}: Props<T>) {
  const { t } = useTranslation("common");
  const { width, height, navWidth } = SIZES[size];
  const titleId = React.useId();
  const grid = phoneNav === "grid";
  const stripFooter = phoneRailFooter ?? railFooter;

  const sectionButton = ({ id, ...rest }: DialogSection<T>, layout: NavButtonProps["layout"]) => (
    <SectionNavButton key={id} {...rest} layout={layout} chosen={id === section} onClick={() => onSectionChange(id)} />
  );

  const heading = (
    <Typography
      id={titleId}
      variant="body2"
      fontWeight={600}
      component="h2"
      noWrap={Boolean(titleExtra)}
      sx={{ color: (muiTheme) => muiTheme.thingport.headingText }}
    >
      {title}
    </Typography>
  );
  const close = (
    <Tooltip title={t("close")}>
      <IconButton
        size="small"
        onClick={onClose}
        aria-label={t("close") ?? undefined}
        sx={grid ? dialogIconButtonSx : undefined}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      aria-labelledby={titleId}
      slotProps={{
        paper: {
          sx: [
            {
              width,
              maxWidth: "calc(100% - 32px)",
              height: { xs: "75vh", md: height },
              maxHeight: "calc(100% - 32px)",
              m: 2,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            },
            ...(Array.isArray(paperSx) ? paperSx : [paperSx]),
          ],
        },
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: titleExtra || headerActions ? 1.25 : undefined,
          px: 2,
          py: grid ? { xs: 0.5, md: 1.25 } : 1.25,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        {titleExtra ? (
          // Short of room, the extra goes under the title.
          <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1.25, minWidth: 0 }}>
            {heading}
            {titleExtra}
          </Box>
        ) : (
          heading
        )}
        {headerActions ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
            {headerActions}
            {close}
          </Box>
        ) : (
          close
        )}
      </Box>

      {/* Phones: the sections as tabs along the top. */}
      <Box
        component={navLabel ? "nav" : "div"}
        aria-label={navLabel}
        sx={{
          display: { xs: "flex", md: "none" },
          flexShrink: 0,
          gap: 0.5,
          px: 1.5,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          ...((grid || railHeader || stripFooter) && { flexWrap: "wrap" }),
          // In a phone turned sideways there must still be room for the content.
          ...(grid && { maxHeight: "50%", overflowY: "auto" }),
        }}
      >
        {railHeader && <Box sx={{ width: "100%" }}>{railHeader}</Box>}
        {sections.map((s) => sectionButton(s, grid ? "grid" : "tabs"))}
        {stripFooter && <Box sx={{ width: "100%" }}>{stripFooter}</Box>}
      </Box>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        <Box
          component="nav"
          aria-label={navLabel}
          sx={{
            display: { xs: "none", md: "flex" },
            flexDirection: "column",
            gap: 0.25,
            width: navWidth,
            flexShrink: 0,
            p: 1.25,
            borderRight: 1,
            borderColor: "divider",
            overflowY: "auto",
          }}
        >
          {railHeader}
          {sections.map((s) => sectionButton(s, "side"))}
          {railFooter}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto", px: { xs: 2, md: 2.5 }, pt: 1.75, pb: 2.5 }}>
          {children}
        </Box>
      </Box>
    </Dialog>
  );
}
