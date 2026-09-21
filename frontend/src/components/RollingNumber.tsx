import { useEffect, useRef, useState } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";

// Two sequential phases, both moving downward: the old value drops out below first, and only
// then does the new one drop in from above. No fading -- the container's overflow clip is what
// hides each value outside its slot.
const EXIT_MS = 200;
const ENTER_MS = 240;

const enterFromTop = keyframes`
  from { transform: translateY(-100%); }
  to { transform: translateY(0); }
`;
const exitToBottom = keyframes`
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
`;

type Props = {
  value: number;
};

/** Renders a number inline, animating each change like an odometer. The first render is static,
 *  so only a change seen while mounted (e.g. a print count bumped by a download) animates.
 *  Inherits typography from its parent, so wrap it in the Typography that styled the plain
 *  number before. */
export default function RollingNumber({ value }: Props) {
  const lastValueRef = useRef(value);
  // The value being rolled out (null when idle), and a counter that remounts both spans -- and so
  // restarts their animations -- on every change, including a second one mid-animation.
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const [rollKey, setRollKey] = useState(0);

  useEffect(() => {
    if (value === lastValueRef.current) return;
    setOutgoing(lastValueRef.current);
    setRollKey(k => k + 1);
    lastValueRef.current = value;
  }, [value]);

  return (
    <Box
      component="span"
      sx={{ position: "relative", display: "inline-flex", overflow: "hidden", verticalAlign: "bottom" }}
    >
      <Box
        component="span"
        key={`in-${rollKey}`}
        // Keyed off rollKey rather than `outgoing` so clearing the old value when its exit ends
        // doesn't strip this still-running animation. "backwards" holds it above the slot
        // (clipped, so invisible) through the delay while the old value is leaving.
        sx={
          rollKey > 0
            ? {
                animation: `${enterFromTop} ${ENTER_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1) ${EXIT_MS}ms backwards`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }
            : undefined
        }
      >
        {value}
      </Box>
      {outgoing !== null && (
        <Box
          component="span"
          key={`out-${rollKey}`}
          aria-hidden
          onAnimationEnd={() => setOutgoing(null)}
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            animation: `${exitToBottom} ${EXIT_MS}ms cubic-bezier(0.5, 0, 0.9, 0.4) forwards`,
            "@media (prefers-reduced-motion: reduce)": { display: "none" },
          }}
        >
          {outgoing}
        </Box>
      )}
    </Box>
  );
}
