import { keyframes } from "@emotion/react";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import { alpha, useTheme } from "@mui/material/styles";
import type { PreviewMode } from "../../api/settings";

const TILE = 104;
const LOOP = "4.8s";

// Without its animation (not chosen, or motion reduced), each scene rests on the frame that explains it: the
// rendered thumbnail, the button waiting for a click, the placeholder.
const scrollIn = keyframes`
  0% { transform: translateY(34px); opacity: 0; }
  14%, 100% { transform: translateY(0); opacity: 1; }
`;
const renderAuto = keyframes`
  0%, 40% { opacity: 0; transform: scale(0.6); }
  50%, 92% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1); }
`;
const shimmerAuto = keyframes`
  0%, 14% { opacity: 0; }
  18%, 42% { opacity: 1; }
  50%, 100% { opacity: 0; }
`;
const pointer = keyframes`
  0%, 8% { transform: translate(26px, 30px); opacity: 0; }
  14% { opacity: 1; }
  34%, 44% { transform: translate(0, 0); opacity: 1; }
  52%, 100% { transform: translate(0, 0); opacity: 0; }
`;
const press = keyframes`
  0%, 36% { transform: scale(1); opacity: 1; }
  40% { transform: scale(0.82); opacity: 1; }
  46%, 100% { transform: scale(1); opacity: 0; }
`;
const shimmerOnDemand = keyframes`
  0%, 44% { opacity: 0; }
  48%, 64% { opacity: 1; }
  70%, 100% { opacity: 0; }
`;
const renderOnDemand = keyframes`
  0%, 64% { opacity: 0; transform: scale(0.6); }
  72%, 94% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1); }
`;
const sweep = keyframes`
  from { background-position: -80px 0; }
  to { background-position: 80px 0; }
`;

/** The Thingport cube, standing in for a rendered thumbnail. */
function Cube({ animation, waiting }: { animation: string; waiting?: boolean }) {
  const { light, main, dark } = useTheme().palette.primary;
  return (
    <Box
      component="svg"
      viewBox="0 0 40 40"
      sx={{ position: "absolute", inset: 0, m: "auto", width: 30, height: 30, opacity: waiting ? 0 : 1, animation }}
    >
      <path d="M20 5 L34 13 L20 21 L6 13 Z" fill={light} />
      <path d="M6 13 L20 21 L20 36 L6 28 Z" fill={main} />
      <path d="M34 13 L20 21 L20 36 L34 28 Z" fill={dark} />
    </Box>
  );
}

function Shimmer({ animation }: { animation: string }) {
  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        opacity: 0,
        background: "linear-gradient(90deg, transparent 20%, rgba(255, 255, 255, 0.85) 50%, transparent 80%)",
        backgroundSize: "80px 100%",
        backgroundRepeat: "no-repeat",
        animation: `${animation}, ${sweep} 0.9s linear infinite`,
      }}
    />
  );
}

/** A model card: the thumbnail on top, its name and author as lines below. */
function Card({ children, animation }: { children: React.ReactNode; animation?: string }) {
  return (
    <Box
      sx={{
        width: 66,
        height: 78,
        borderRadius: "8px",
        bgcolor: "#ffffff",
        border: "1px solid rgba(0, 0, 0, 0.12)",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
        overflow: "hidden",
        animation,
      }}
    >
      <Box sx={{ position: "relative", height: 48, bgcolor: "#eef1f4", overflow: "hidden" }}>{children}</Box>
      <Box sx={{ px: 0.75, pt: 0.75 }}>
        <Box sx={{ height: 5, width: "80%", borderRadius: 1, bgcolor: "rgba(0, 0, 0, 0.18)" }} />
        <Box sx={{ mt: 0.5, height: 4, width: "50%", borderRadius: 1, bgcolor: "rgba(0, 0, 0, 0.1)" }} />
      </Box>
    </Box>
  );
}

const loop = (frames: ReturnType<typeof keyframes>, timing = "ease-in-out") => `${frames} ${LOOP} ${timing} infinite`;

const SCENES: Record<PreviewMode, React.ReactNode> = {
  // Scrolls into view, renders itself, keeps it.
  automatic: (
    <Card animation={loop(scrollIn, "ease-out")}>
      <Shimmer animation={loop(shimmerAuto)} />
      <Cube animation={loop(renderAuto)} />
    </Card>
  ),
  // Waits for a click on its button, then renders.
  "on-demand": (
    <Card>
      <Box
        sx={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 30,
          height: 14,
          ml: "-15px",
          mt: "-7px",
          borderRadius: "7px",
          bgcolor: "primary.main",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: loop(press),
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: 10, color: "#ffffff" }} />
      </Box>
      <Shimmer animation={loop(shimmerOnDemand)} />
      <Cube animation={loop(renderOnDemand)} waiting />
      <Box
        component="svg"
        viewBox="0 0 12 16"
        sx={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 10,
          height: 14,
          ml: "2px",
          mt: "1px",
          opacity: 0,
          animation: loop(pointer),
        }}
      >
        <path d="M1 1 L1 13 L4 10 L6.5 15 L8.5 14 L6 9 L10.5 9 Z" fill="#1f1f1f" stroke="#ffffff" strokeWidth="1" />
      </Box>
    </Card>
  ),
  // Never renders: the placeholder stays.
  disabled: (
    <Card>
      <ImageOutlinedIcon
        sx={{ position: "absolute", inset: 0, m: "auto", fontSize: 24, color: "rgba(0, 0, 0, 0.28)" }}
      />
    </Card>
  ),
};

type Props = {
  value: PreviewMode;
  options: { value: PreviewMode; label: string }[];
  onChange: (value: PreviewMode) => void;
  disabled?: boolean;
};

/** One tile per mode, showing what a card does; the chosen one is lit and plays, the others wait, dimmed. */
export default function PreviewModeIllustration({ value, options, onChange, disabled }: Props) {
  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
      {options.map((option) => {
        const chosen = option.value === value;
        return (
          <Box
            key={option.value}
            component="button"
            type="button"
            aria-pressed={chosen}
            aria-label={option.label}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            sx={{
              position: "relative",
              width: TILE,
              height: TILE,
              p: 0,
              font: "inherit",
              borderRadius: "18px",
              bgcolor: "#ffffff",
              border: "2px solid",
              borderColor: chosen ? "primary.main" : "transparent",
              boxShadow: chosen
                ? (theme) => `0 0 0 4px ${alpha(theme.palette.primary.main, 0.18)}, 0 4px 12px rgba(0, 0, 0, 0.12)`
                : "inset 0 0 0 1px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: disabled ? "default" : "pointer",
              transform: chosen ? "translateY(-2px)" : "none",
              transition: "transform 150ms, box-shadow 150ms, border-color 150ms, opacity 150ms, filter 150ms",
              ...(!chosen && { opacity: 0.6, filter: "grayscale(0.7)" }),
              "&:hover": chosen || disabled ? {} : { opacity: 0.9, filter: "grayscale(0.2)" },
              "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 3 },
              // Only the chosen one plays; the others rest on their still.
              ...(!chosen && { "& *": { animation: "none !important" } }),
              "@media (prefers-reduced-motion: reduce)": { "& *": { animation: "none !important" } },
            }}
          >
            {SCENES[option.value]}
            {chosen && (
              <CheckCircleIcon
                sx={{
                  position: "absolute",
                  top: -9,
                  right: -9,
                  fontSize: 22,
                  color: "primary.main",
                  bgcolor: "#ffffff",
                  borderRadius: "50%",
                }}
              />
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
