import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import CodeIcon from "@mui/icons-material/Code";
import PublicIcon from "@mui/icons-material/Public";

const LOOP = "3.6s";

// A line of code typed out, then cleared for the next pass.
const type = keyframes`
  0% { transform: scaleX(0); }
  30%, 85% { transform: scaleX(1); }
  100% { transform: scaleX(0); }
`;
const blink = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
`;
// A widget drops from the repository into the dashboard's free slot, settles, then makes room for the next.
const drop = keyframes`
  0% { transform: translateY(-34px) scale(0.6); opacity: 0; }
  35% { transform: translateY(2px) scale(1.04); opacity: 1; }
  45%, 85% { transform: translateY(0) scale(1); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 0; }
`;
const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
`;

const CELL = { borderRadius: "5px", bgcolor: "action.hover", border: 1, borderColor: "divider" } as const;

/** A small dashboard: five filled slots and the one each scene fills. */
function MiniGrid({ slot }: { slot: React.ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 34px)", gridAutoRows: "24px", gap: "5px" }}>
      <Box sx={CELL} />
      <Box sx={CELL} />
      <Box sx={{ ...CELL, gridRow: "span 2" }} />
      <Box sx={CELL} />
      <Box sx={{ position: "relative" }}>{slot}</Box>
    </Box>
  );
}

function OwnScene() {
  return (
    <MiniGrid
      slot={
        <Box
          sx={{
            ...CELL,
            position: "absolute",
            inset: 0,
            borderColor: "primary.main",
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12),
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "3px",
            px: "4px",
          }}
        >
          {[70, 45, 85].map((width, index) => (
            <Box
              key={width}
              sx={{
                height: 3,
                width: `${width}%`,
                borderRadius: 1,
                bgcolor: "primary.main",
                transformOrigin: "left",
                animation: `${type} ${LOOP} ease-out infinite`,
                animationDelay: `${index * 0.25}s`,
              }}
            />
          ))}
          <Box
            sx={{
              position: "absolute",
              right: 3,
              bottom: 3,
              width: 2,
              height: 7,
              bgcolor: "primary.main",
              animation: `${blink} 0.9s steps(1) infinite`,
            }}
          />
        </Box>
      }
    />
  );
}

function CommunityScene() {
  return (
    <MiniGrid
      slot={
        <>
          <Box sx={{ ...CELL, position: "absolute", inset: 0, bgcolor: "transparent", borderStyle: "dashed" }} />
          <Box
            sx={{
              ...CELL,
              position: "absolute",
              inset: 0,
              borderColor: "primary.main",
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.2),
              animation: `${drop} ${LOOP} cubic-bezier(0.3, 0.7, 0.4, 1) infinite`,
            }}
          />
        </>
      }
    />
  );
}

type Props = {
  kind: "own" | "community";
  label: string;
  description: string;
  /** Null while loading. */
  checked: boolean | null;
  disabled?: boolean;
  onChange: (next: boolean) => void;
};

/** One kind of custom widget, switched on or off: the whole tile is the switch's label, so a click anywhere flips it. */
export default function WidgetSourceTile({ kind, label, description, checked, disabled, onChange }: Props) {
  const on = checked === true;
  const labelId = `widget-source-${kind}`;
  return (
    <Box
      component="label"
      sx={{
        display: "flex",
        flexDirection: "column",
        borderRadius: 2,
        border: 1,
        borderColor: on ? "primary.main" : "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
        cursor: disabled || checked === null ? "default" : "pointer",
        boxShadow: (theme) => (on ? `0 0 0 3px ${alpha(theme.palette.primary.main, 0.14)}` : "none"),
        transition: "border-color 200ms, box-shadow 200ms, transform 200ms",
        "&:hover": { transform: checked === null ? "none" : "translateY(-2px)" },
        "&:focus-within": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
        "@media (prefers-reduced-motion: reduce)": { "&, & *": { animation: "none !important", transition: "none" } },
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: "relative",
          height: 104,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: (theme) =>
            `radial-gradient(circle at 30% 20%, ${alpha(theme.palette.primary.main, on ? 0.16 : 0.04)}, transparent 70%)`,
          filter: on ? "none" : "grayscale(1)",
          opacity: on ? 1 : 0.5,
          transition: "filter 250ms, opacity 250ms",
          // Off, the scene holds still.
          "& *": { animationPlayState: on ? "running" : "paused" },
        }}
      >
        <Box
          sx={{
            position: "absolute",
            top: 10,
            left: 12,
            display: "flex",
            color: "primary.main",
            animation: `${pulse} ${LOOP} ease-in-out infinite`,
          }}
        >
          {kind === "own" ? <CodeIcon fontSize="small" /> : <PublicIcon fontSize="small" />}
        </Box>
        {kind === "own" ? <OwnScene /> : <CommunityScene />}
      </Box>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        sx={{ p: 2, pt: 1.5, borderTop: 1, borderColor: "divider" }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} id={labelId}>
            {label}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {checked === null ? <Skeleton width="70%" /> : description}
          </Typography>
        </Box>
        <Switch
          checked={on}
          disabled={disabled || checked === null}
          onChange={(event) => onChange(event.target.checked)}
          slotProps={{ input: { "aria-labelledby": labelId } }}
        />
      </Stack>
    </Box>
  );
}
