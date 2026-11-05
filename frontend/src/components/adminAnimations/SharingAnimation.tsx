import { useMemo } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { ModelShape, prefersReducedMotion } from "../storageAnimations/parts";

// Two people. On, the one on the left holds up a model and a copy of it arcs over to the one on the right, who nods
// as it lands; the original stays where it was. Off, a padlock stands between them and nothing crosses.
//
// The people and the padlock are SVG rather than boxes: dark mode squares every CSS corner, which would leave them as
// blocks, and a face should stay round.
const CYCLE_S = 3.6;

type Look = { skin: string; hair: string; shirt: string; style: "curly" | "bob" };
export const SHARER: Look = { skin: "#c68863", hair: "#3b2416", shirt: "#f59e0b", style: "curly" };
export const COLLECTOR: Look = { skin: "#f2c9a5", hair: "#e0a64a", shirt: "#3b82f6", style: "bob" };
const FEATURES = "#1f2937";

/** A head-and-shoulders portrait, `width` wide, drawn on a 100 by 92 grid: hair, face and shirt. */
export function Bust({
  left,
  bottom,
  width,
  look,
  animation,
}: {
  left: number;
  bottom: number;
  width: number;
  look: Look;
  animation?: string;
}) {
  return (
    <Box
      component="svg"
      viewBox="0 0 100 92"
      sx={{ position: "absolute", left, bottom, width, height: width * 0.92, overflow: "visible", animation }}
    >
      {look.style === "bob" && (
        <path d="M25 44 Q25 12 50 12 Q75 12 75 44 L75 60 Q75 64 71 64 L29 64 Q25 64 25 60 Z" fill={look.hair} />
      )}
      <path d="M6 92 Q6 64 50 62 Q94 64 94 92 Z" fill={look.shirt} />
      <path d="M41 54 L59 54 L59 64 Q50 70 41 64 Z" fill={look.skin} />
      <circle cx="50" cy="40" r="21" fill={look.skin} />
      {look.style === "curly" ? (
        <g fill={look.hair}>
          <circle cx="32" cy="30" r="8" />
          <circle cx="41" cy="21" r="9" />
          <circle cx="53" cy="19" r="9" />
          <circle cx="64" cy="24" r="8.5" />
          <circle cx="69" cy="33" r="6.5" />
        </g>
      ) : (
        <path d="M28 38 Q29 17 50 17 Q71 17 72 36 Q62 27 46 30 Q36 32 28 38 Z" fill={look.hair} />
      )}
      <circle cx="42.5" cy="42" r="2.6" fill={FEATURES} />
      <circle cx="57.5" cy="42" r="2.6" fill={FEATURES} />
      <path d="M43.5 50 Q50 55.5 56.5 50" fill="none" stroke="#9a3412" strokeWidth="2.4" strokeLinecap="round" />
    </Box>
  );
}

/** A closed padlock, `size` wide. */
export function Padlock({ left, top, size }: { left: number; top: number; size: number }) {
  return (
    <Box component="svg" viewBox="0 0 20 24" sx={{ position: "absolute", left, top, width: size, height: size * 1.2 }}>
      <path d="M5 11 V7.5 Q5 2 10 2 Q15 2 15 7.5 V11" fill="none" stroke="#94a3b8" strokeWidth="2.6" />
      <rect x="1.5" y="10" width="17" height="13" rx="3" fill="#64748b" />
      <circle cx="10" cy="16" r="1.8" fill="#e2e8f0" />
    </Box>
  );
}

/** `on`: social features are on, so a model is shared from one user to the other; otherwise a padlock keeps them apart. */
export default function SharingAnimation({ size, on }: { size: number; on: boolean }) {
  const still = prefersReducedMotion();
  const person = size * 0.42;
  const ground = size * 0.06;
  const sharerLeft = size * 0.04;
  const collectorLeft = size - sharerLeft - person;
  const model = size * 0.2;
  // The model floats over the sharer's head; its copy lands over the collector's, and the padlock sits between.
  const modelLeft = sharerLeft + (person - model) / 2;
  const modelTop = size * 0.14;
  const across = collectorLeft - sharerLeft;

  const frames = useMemo(
    () => ({
      // Out of the original, over in an arc, a bump on landing, then gone for the next round.
      copy: keyframes`
        0%, 10% { transform: translate(0, 0) scale(0.4); opacity: 0; }
        16% { transform: translate(0, 0) scale(1); opacity: 1; }
        36% { transform: translate(${across * 0.5}px, ${-size * 0.12}px) scale(1); }
        56% { transform: translate(${across}px, 0) scale(1.15); }
        62%, 88% { transform: translate(${across}px, 0) scale(1); opacity: 1; }
        100% { transform: translate(${across}px, 0) scale(1); opacity: 0; }
      `,
      // The collector nods as it lands.
      nod: keyframes`
        0%, 56%, 72%, 100% { transform: none; }
        62% { transform: translateY(-6%); }
      `,
      // Held up, waiting.
      hold: keyframes`
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-8%); }
      `,
    }),
    [across, size],
  );
  const run = (name: ReturnType<typeof keyframes>, easing = "ease-in-out") =>
    still ? "none" : `${name} ${CYCLE_S}s ${easing} infinite`;
  const lock = size * 0.18;

  return (
    <Box aria-hidden sx={{ position: "relative", width: size, height: size }}>
      <Bust left={sharerLeft} bottom={ground} width={person} look={SHARER} />
      <Bust
        left={collectorLeft}
        bottom={ground}
        width={person}
        look={COLLECTOR}
        animation={on ? run(frames.nod) : undefined}
      />
      {/* The original stays with its owner. */}
      <Box sx={{ position: "absolute", left: modelLeft, top: modelTop, animation: on ? undefined : run(frames.hold) }}>
        <ModelShape kind="cube" size={model} palette="green" />
      </Box>
      {on ? (
        <Box
          sx={{
            position: "absolute",
            left: modelLeft,
            top: modelTop,
            // Without motion, the copy is simply there already.
            transform: still ? `translateX(${across}px)` : undefined,
            animation: run(frames.copy, "ease-out"),
          }}
        >
          <ModelShape kind="cube" size={model} palette="green" />
        </Box>
      ) : (
        <Padlock left={(size - lock) / 2} top={modelTop - lock * 0.1} size={lock} />
      )}
    </Box>
  );
}
