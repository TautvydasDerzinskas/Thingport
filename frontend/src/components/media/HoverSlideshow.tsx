import { useEffect, useState } from "react";
import Box from "@mui/material/Box";

// First change comes a little sooner than the rest, so hovering feels responsive without a
// quick pass of the pointer over a card flashing it.
const FIRST_SLIDE_DELAY_MS = 500;
const SLIDE_INTERVAL_MS = 1400;
const FADE_MS = 350;

type Props = {
  /** Image URLs to cycle through, in order. */
  images: string[];
  alt?: string;
};

/** Overlay that fades through `images` on top of whatever is rendered beneath it (a card's
 *  default thumbnail). Mount it only while it should run -- e.g. while a card is hovered: images
 *  load on mount, and unmounting stops the timer and reveals the default beneath instantly. The
 *  parent must be `position: relative`. */
export default function HoverSlideshow({ images, alt }: Props) {
  // null until the first tick, so every slide starts hidden and fades in (the default thumbnail
  // stays visible underneath until then).
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (images.length === 0) return;
    let timer = window.setTimeout(function tick() {
      setActive(current => (current === null ? 0 : (current + 1) % images.length));
      timer = window.setTimeout(tick, SLIDE_INTERVAL_MS);
    }, FIRST_SLIDE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [images.length]);

  return (
    <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {images.map((src, idx) => (
        <Box
          key={src}
          component="img"
          src={src}
          alt={idx === active ? alt ?? "" : ""}
          aria-hidden={idx !== active}
          // The incoming slide fades in on top while the outgoing one stays fully opaque beneath
          // it, only dropping out (instantly, via a delayed 0ms transition) once the fade is done
          // -- fading both at once would let the default thumbnail show through mid-crossfade.
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            zIndex: idx === active ? 1 : 0,
            opacity: idx === active ? 1 : 0,
            transition: idx === active ? `opacity ${FADE_MS}ms ease` : `opacity 0ms linear ${FADE_MS}ms`,
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          }}
        />
      ))}
    </Box>
  );
}
