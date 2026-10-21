import CheckIcon from "@mui/icons-material/Check";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import type { Theme } from "@mui/material/styles";

const SIZE = 22;
const trackBg = (theme: Theme) => (theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)");

type Props<T extends string> = {
  value: T;
  /** `label` is the tooltip and the accessible name; `contrast` colours the tick on the chosen swatch. */
  options: { value: T; label: string; color: string; contrast: string }[];
  onChange: (value: T) => void;
  label: string;
  /** Without Segmented's track, for a toolbar that's already a surface of its own. */
  bare?: boolean;
};

/** Round colour swatches on Segmented's track, or bare; the chosen one is ringed and ticked. */
export default function ColorSwatches<T extends string>({ value, options, onChange, label, bare }: Props<T>) {
  return (
    <Box
      component="fieldset"
      aria-label={label}
      sx={{
        m: 0,
        minWidth: 0,
        display: "inline-flex",
        flexWrap: "wrap",
        maxWidth: "100%",
        gap: 0.75,
        p: bare ? "4px" : "6px",
        border: 0,
        ...(!bare && { borderRadius: "10px", bgcolor: trackBg, border: 1, borderColor: "divider" }),
      }}
    >
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <Tooltip key={option.value} title={option.label}>
            <Box
              component="button"
              type="button"
              aria-pressed={chosen}
              aria-label={option.label}
              onClick={() => onChange(option.value)}
              sx={{
                width: SIZE,
                height: SIZE,
                p: 0,
                border: 0,
                borderRadius: "50% !important",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: option.color,
                color: option.contrast,
                // A gap in the page's colour, then a ring in the swatch's own.
                boxShadow: (theme) =>
                  chosen ? `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${option.color}` : "none",
                transform: chosen ? "scale(1)" : "scale(0.9)",
                transition: "transform 150ms, box-shadow 150ms",
                "&:hover": { transform: "scale(1.05)" },
                "&:focus-visible": { outline: "2px solid", outlineColor: "text.primary", outlineOffset: 4 },
                "& > svg": {
                  fontSize: 14,
                  opacity: chosen ? 1 : 0,
                  transform: chosen ? "scale(1)" : "scale(0.4)",
                  transition: "opacity 150ms, transform 200ms",
                },
                "@media (prefers-reduced-motion: reduce)": { transition: "none", "& > svg": { transition: "none" } },
              }}
            >
              <CheckIcon />
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
