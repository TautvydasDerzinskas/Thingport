import { useMemo } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";

// Models dropping into a bin, one after another, its lid tipping up to take each one: the models whose files are
// gone being deleted. Pure CSS, sized from `size`, so the same picture works on the progress bar and larger --
// FileMoveAnimation is its sibling, for the move that puts files somewhere rather than away.
const CARDS = 3;
const CYCLE_S = 2.1;
// Each card's top stripe, as in FileMoveAnimation: a model's files, going with it.
const STRIPES = ["#f87171", "#fb923c", "#f472b6"];
const BIN_BODY = "#94a3b8";
const BIN_SHADE = "#64748b";
const BIN_LID = "#cbd5e1";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export default function ModelDeleteAnimation({ size, paused }: { size: number; paused?: boolean }) {
  const still = paused || prefersReducedMotion();
  const binW = size * 0.42;
  const binH = size * 0.32;
  const binLeft = (size - binW) / 2;
  const binTop = size * 0.6;
  // Capping the bin, hinged at its left end and tilting up behind it: short enough to stay inside the tile.
  const lidW = binW * 0.96;
  const lidH = Math.max(2, size * 0.07);
  const lidLeft = (size - lidW) / 2;
  const lidTop = binTop - lidH - size * 0.02;
  const cardW = size * 0.2;
  const cardH = size * 0.24;
  const cardLeft = (size - cardW) / 2;
  // Out of sight above the tile, down to the bin's mouth, where the bin itself hides what's left of it.
  const fromY = -cardH * 1.2;
  const intoY = binTop - cardH * 0.45;

  const { drop, tip, squash } = useMemo(
    () => ({
      // Falls, tilting as it goes, then shrinks into the bin's mouth and is gone.
      drop: keyframes`
        0% { transform: translate(0, ${fromY}px) rotate(-12deg) scale(1); opacity: 0; }
        12% { opacity: 1; }
        44% { transform: translate(0, ${intoY - cardH * 0.5}px) rotate(5deg) scale(1); opacity: 1; }
        56% { transform: translate(0, ${intoY}px) rotate(2deg) scale(0.9); opacity: 1; }
        62%, 100% { transform: translate(0, ${intoY + cardH * 0.45}px) rotate(0deg) scale(0.75); opacity: 0; }
      `,
      // Open for as long as a card is on its way in -- the cards are a third of a cycle apart, so the lid's own
      // cycle is a third as long and its open window covers each landing -- then shut between them.
      tip: keyframes`
        0%, 12% { transform: rotate(0deg); }
        30%, 82% { transform: rotate(-24deg); }
        96%, 100% { transform: rotate(0deg); }
      `,
      // The bin takes the weight.
      squash: keyframes`
        0%, 44%, 100% { transform: scaleY(1); }
        56% { transform: scaleY(0.94); }
      `,
    }),
    [fromY, intoY, cardH],
  );

  const radius = Math.max(2, size / 22);

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size, overflow: "hidden" }}>
      {Array.from({ length: CARDS }, (_card, index) => (
        <Box
          key={index}
          sx={{
            position: "absolute",
            left: cardLeft,
            top: 0,
            width: cardW,
            height: cardH,
            borderRadius: `${radius / 1.5}px`,
            bgcolor: "#ffffff",
            boxShadow: "0 0 0 1px rgba(15, 23, 42, 0.18)",
            // A coloured stripe across the top, and a folded corner.
            backgroundImage: `linear-gradient(${STRIPES[index]}, ${STRIPES[index]}), linear-gradient(225deg, #cbd5e1 50%, transparent 50%)`,
            backgroundSize: `100% ${cardH * 0.22}px, ${cardW * 0.32}px ${cardW * 0.32}px`,
            backgroundPosition: "top left, top right",
            backgroundRepeat: "no-repeat",
            zIndex: 2,
            transform: still ? `translate(0, ${intoY - cardH * 0.9}px) rotate(-6deg)` : undefined,
            opacity: still && index > 0 ? 0 : undefined,
            animation: still ? "none" : `${drop} ${CYCLE_S}s ease-in ${(index * CYCLE_S) / CARDS}s infinite both`,
          }}
        />
      ))}
      {/* The bin: a tapered body with a darker inside showing at its mouth, and a hinged lid. */}
      <Box
        sx={{
          position: "absolute",
          left: binLeft,
          top: binTop,
          width: binW,
          height: binH,
          borderRadius: `${radius / 2}px ${radius / 2}px ${radius}px ${radius}px`,
          bgcolor: BIN_BODY,
          clipPath: "polygon(0 0, 100% 0, 88% 100%, 12% 100%)",
          transformOrigin: "bottom",
          zIndex: 3,
          animation: still ? "none" : `${squash} ${CYCLE_S / CARDS}s ease-out infinite`,
          // Its mouth, and the ribs down the front.
          "&::before": {
            content: '""',
            position: "absolute",
            inset: `0 0 ${binH * 0.84}px 0`,
            bgcolor: BIN_SHADE,
            borderRadius: `${radius / 2}px`,
          },
          "&::after": {
            content: '""',
            position: "absolute",
            left: "28%",
            right: "28%",
            top: binH * 0.3,
            bottom: binH * 0.15,
            borderLeft: `${Math.max(1, size / 40)}px solid ${BIN_SHADE}`,
            borderRight: `${Math.max(1, size / 40)}px solid ${BIN_SHADE}`,
            opacity: 0.5,
          },
        }}
      />
      <Box
        sx={{
          position: "absolute",
          left: lidLeft,
          top: lidTop,
          width: lidW,
          height: lidH,
          borderRadius: `${radius}px`,
          bgcolor: BIN_LID,
          boxShadow: `inset 0 -${Math.max(1, size / 50)}px 0 rgba(15, 23, 42, 0.12)`,
          transformOrigin: "left center",
          zIndex: 1,
          transform: still ? "rotate(-18deg)" : undefined,
          animation: still ? "none" : `${tip} ${CYCLE_S / CARDS}s ease-in-out infinite`,
        }}
      />
    </Box>
  );
}
