import Box from "@mui/material/Box";
import { alpha, type SxProps, type Theme } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";

/** The round tick on a card in select mode: an empty ring over a scrim, filled and ticked once selected. */
export default function SelectionCheck({ selected, sx }: { selected: boolean; sx?: SxProps<Theme> }) {
  return (
    <Box
      aria-hidden
      sx={[
        (theme) => ({
          position: "absolute",
          top: 8,
          right: 8,
          width: 24,
          height: 24,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: 2,
          borderColor: selected ? "primary.main" : "background.paper",
          // A scrim, so the empty circle shows on light and dark previews alike.
          bgcolor: selected ? "primary.main" : alpha(theme.palette.common.black, 0.25),
          color: "primary.contrastText",
          boxShadow: 1,
          transition: "background-color .15s ease, border-color .15s ease",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <CheckIcon
        sx={{
          fontSize: 16,
          opacity: selected ? 1 : 0,
          transform: selected ? "scale(1)" : "scale(0.4)",
          transition: "opacity 150ms ease, transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      />
    </Box>
  );
}
