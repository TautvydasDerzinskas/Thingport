import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { prefersReducedMotion } from "../storageAnimations/parts";

// A browser window: the address types itself into the bar, and Thingport's page comes up under it, a model
// card and all. It clears, and the address is typed again.
const CYCLE_S = 5;

const typing = keyframes`
  0%, 6% { transform: scaleX(0); }
  40%, 88% { transform: scaleX(1); }
  96%, 100% { transform: scaleX(0); }
`;
const caret = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
`;
const caretMove = keyframes`
  0%, 6% { left: 0%; }
  40%, 88% { left: 100%; }
  96%, 100% { left: 0%; }
`;
/** Hidden until `at` (% of the cycle), then fades up; gone as the address clears. */
function appear(at: number) {
  return keyframes`
    0%, ${at}% { opacity: 0; transform: translateY(20%); }
    ${at + 8}%, 88% { opacity: 1; transform: none; }
    96%, 100% { opacity: 0; transform: none; }
  `;
}
const header = appear(44);
const card = appear(52);
const lines = appear(60);

export default function AddressBarAnimation({ size }: { size: number }) {
  const still = prefersReducedMotion();
  const run = (frames: ReturnType<typeof keyframes>, timing = `${CYCLE_S}s ease-out infinite`) =>
    still ? "none" : `${frames} ${timing}`;
  const window = { left: size * 0.08, top: size * 0.14, width: size * 0.84, height: size * 0.72 };
  const radius = Math.max(3, size / 16);
  const line = Math.max(2, size / 30);
  const dot = Math.max(3, size / 22);
  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <Box
        sx={{
          position: "absolute",
          ...window,
          borderRadius: `${radius}px`,
          bgcolor: "#ffffff",
          boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.14), 0 2px 4px rgba(15, 23, 42, 0.08)",
          overflow: "hidden",
        }}
      >
        {/* Title bar: the three dots, then the address bar. */}
        <Box sx={{ height: window.height * 0.24, bgcolor: "#f1f5f9", position: "relative" }}>
          {["#f87171", "#fbbf24", "#4ade80"].map((color, index) => (
            <Box
              key={color}
              sx={{
                position: "absolute",
                left: window.width * 0.06 + index * dot * 1.5,
                top: window.height * 0.12 - dot / 2,
                width: dot,
                height: dot,
                borderRadius: "50%",
                bgcolor: color,
              }}
            />
          ))}
          <Box
            sx={{
              position: "absolute",
              left: window.width * 0.36,
              right: window.width * 0.06,
              top: window.height * 0.05,
              bottom: window.height * 0.05,
              borderRadius: 99,
              bgcolor: "#ffffff",
              boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.1)",
            }}
          >
            {/* The padlock of a secure address. */}
            <Box
              sx={{
                position: "absolute",
                left: "10%",
                top: "50%",
                width: dot,
                height: dot,
                borderRadius: "50%",
                bgcolor: "#22c55e",
                transform: "translateY(-50%)",
              }}
            />
            <Box sx={{ position: "absolute", left: "26%", right: "12%", top: "50%", height: line }}>
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  marginTop: `${-line / 2}px`,
                  borderRadius: 1,
                  bgcolor: "#64748b",
                  transformOrigin: "left",
                  animation: run(typing, `${CYCLE_S}s steps(14, end) infinite`),
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  top: -line * 1.5,
                  width: Math.max(1, line / 1.5),
                  height: line * 3,
                  bgcolor: "#16a34a",
                  animation: still
                    ? "none"
                    : `${caret} 0.8s step-end infinite, ${caretMove} ${CYCLE_S}s steps(14, end) infinite`,
                }}
              />
            </Box>
          </Box>
        </Box>
        {/* The page that comes up. */}
        <Box sx={{ position: "relative", height: window.height * 0.76 }}>
          <Box
            sx={{
              position: "absolute",
              left: "8%",
              top: "12%",
              width: "40%",
              height: line * 1.6,
              borderRadius: 1,
              bgcolor: "#16a34a",
              animation: run(header),
            }}
          />
          <Box
            sx={{
              position: "absolute",
              left: "8%",
              top: "34%",
              width: "34%",
              height: "50%",
              borderRadius: `${radius / 1.5}px`,
              background: "linear-gradient(135deg, #bbf7d0, #86efac)",
              animation: run(card),
            }}
          />
          {[0, 1, 2].map((row) => (
            <Box
              key={row}
              sx={{
                position: "absolute",
                left: "50%",
                top: `${38 + row * 16}%`,
                width: row === 2 ? "26%" : "40%",
                height: line,
                borderRadius: 1,
                bgcolor: "#cbd5e1",
                animation: run(lines),
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
