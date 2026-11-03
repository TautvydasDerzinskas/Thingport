import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

// A side panel folded away: a slim strip on its side with its name on an upright tab, which opens it again. On a narrow
// screen, where panels stack under the page, it's a plain row instead.

const appear = keyframes`from { opacity: 0; } to { opacity: 1; }`;

type Props = {
  label: string;
  /** The side of the page the panel is on: the tab reads up its edge, as a folder's tab would. */
  side: "left" | "right";
  onOpen: () => void;
  /** "Open the Features panel": for screen readers, where the label alone wouldn't say what it does. */
  ariaLabel: string;
};

export default function PanelTab({ label, side, onOpen, ariaLabel }: Props) {
  return (
    <Box
      sx={(theme) => ({
        height: "100%",
        display: "flex",
        justifyContent: "center",
        animation: `${appear} 200ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
        [theme.breakpoints.up("md")]: { pt: 1 },
      })}
    >
      <ButtonBase
        onClick={onOpen}
        aria-label={ariaLabel}
        sx={(theme) => ({
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          width: "100%",
          px: 1.5,
          py: 0.75,
          justifyContent: "flex-start",
          color: "text.secondary",
          fontSize: "0.75rem",
          fontWeight: 700,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          transition: "background-color 150ms, color 150ms",
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
          "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
          [theme.breakpoints.up("md")]: {
            width: "auto",
            px: 0.5,
            py: 1.25,
            borderRadius: 1.5,
            border: 1,
            borderColor: "divider",
            bgcolor: "background.paper",
            // Upright: down the right edge, up the left one.
            writingMode: "vertical-rl",
            transform: side === "left" ? "rotate(180deg)" : "none",
            alignSelf: "flex-start",
          },
        })}
      >
        {/* Towards where it opens: into the page, the left tab turned round with its text; down, on a narrow screen. */}
        <ChevronLeftIcon
          sx={(theme) => ({ fontSize: 16, [theme.breakpoints.down("md")]: { transform: "rotate(-90deg)" } })}
        />
        {label}
      </ButtonBase>
    </Box>
  );
}
