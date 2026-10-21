import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import type { McpAccess } from "../../api/settings";
import { prefersReducedMotion } from "../storageAnimations/parts";

// An assistant on the left, the library on the right, and the MCP link between them: cut when off, data
// flowing to the assistant when it may read, and back to the library too when it may change it.
const CYCLE_S = 1.8;
const SLATE = "#334155";
const TRACK = "#cbd5e1";
const WRITE = "#f59e0b";

const toAssistant = keyframes`
  0% { transform: translateX(var(--span)); opacity: 0; }
  15%, 85% { opacity: 1; }
  100% { transform: translateX(0); opacity: 0; }
`;
const toLibrary = keyframes`
  0% { transform: translateX(0); opacity: 0; }
  15%, 85% { opacity: 1; }
  100% { transform: translateX(var(--span)); opacity: 0; }
`;
const blink = keyframes`
  0%, 92%, 100% { transform: scaleY(1); }
  95% { transform: scaleY(0.15); }
`;

export default function McpLinkAnimation({ size, access }: { size: number; access: McpAccess }) {
  const theme = useTheme();
  const still = prefersReducedMotion();
  const accent = theme.palette.primary.main;
  const off = access === "off";
  const u = size / 76;
  const trackLeft = 27 * u;
  const trackWidth = 21 * u;
  const dot = 6 * u;
  const midY = 38 * u;
  const fade = { transition: "opacity 220ms ease-out, filter 220ms ease-out" };

  const packet = (color: string, frames: ReturnType<typeof keyframes>, delay: number, startAtEnd: boolean) => (
    <Box
      sx={{
        position: "absolute",
        left: trackLeft,
        top: midY - dot / 2,
        width: dot,
        height: dot,
        borderRadius: "50%",
        bgcolor: color,
        "--span": `${trackWidth - dot}px`,
        transform: still ? `translateX(${startAtEnd ? trackWidth - dot : 0}px)` : undefined,
        animation: still ? "none" : `${frames} ${CYCLE_S}s ease-in-out ${delay}s infinite both`,
      }}
    />
  );

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      {/* The assistant: a robot head with an antenna. */}
      <Box sx={{ ...fade, opacity: off ? 0.45 : 1, filter: off ? "grayscale(1)" : "none" }}>
        <Box
          sx={{
            position: "absolute",
            left: 14 * u,
            top: 20 * u,
            width: 2 * u,
            height: 7 * u,
            bgcolor: SLATE,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: 12 * u,
            top: 16 * u,
            width: 6 * u,
            height: 6 * u,
            borderRadius: "50%",
            bgcolor: accent,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: 3 * u,
            top: 27 * u,
            width: 24 * u,
            height: 22 * u,
            borderRadius: `${6 * u}px`,
            bgcolor: SLATE,
          }}
        >
          {[6, 14].map((left) => (
            <Box
              key={left}
              sx={{
                position: "absolute",
                left: left * u,
                top: 8 * u,
                width: 4 * u,
                height: off ? 1.5 * u : 5 * u,
                borderRadius: `${2 * u}px`,
                bgcolor: "#ffffff",
                transformOrigin: "center",
                transition: "height 220ms ease-out",
                animation: still || off ? "none" : `${blink} 4s ease-in-out infinite`,
              }}
            />
          ))}
        </Box>
      </Box>

      {/* The link: solid with data on it, or dashed and cut. */}
      <Box
        sx={{
          position: "absolute",
          left: trackLeft,
          top: midY - u,
          width: trackWidth,
          height: 0,
          borderTop: `${2 * u}px ${off ? "dashed" : "solid"} ${TRACK}`,
        }}
      />
      {off ? (
        <Box
          sx={{
            position: "absolute",
            left: trackLeft + trackWidth / 2 - 5 * u,
            top: midY - 5 * u,
            width: 10 * u,
            height: 10 * u,
            borderRadius: "50%",
            border: `${1.5 * u}px solid #94a3b8`,
            bgcolor: "#ffffff",
            "&::after": {
              content: '""',
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "120%",
              height: 1.5 * u,
              bgcolor: "#94a3b8",
              transform: "translate(-50%, -50%) rotate(-45deg)",
            },
          }}
        />
      ) : (
        <>
          {packet(accent, toAssistant, 0, true)}
          {packet(accent, toAssistant, CYCLE_S / 2, true)}
          {access === "write" && packet(WRITE, toLibrary, CYCLE_S / 4, false)}
        </>
      )}

      {/* The library: three models stacked. */}
      <Box sx={{ ...fade, opacity: off ? 0.6 : 1 }}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            sx={{
              position: "absolute",
              left: (49 + i * 3) * u,
              top: (26 + i * 4) * u,
              width: 18 * u,
              height: 16 * u,
              borderRadius: `${4 * u}px`,
              bgcolor: accent,
              opacity: 0.45 + i * 0.275,
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
            }}
          />
        ))}
      </Box>
    </Box>
  );
}
