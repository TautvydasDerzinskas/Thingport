import { useEffect, useRef, useState, type ReactNode } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import { alpha } from "@mui/material/styles";
import { printsApi } from "../../api/prints";
import { useRenderColor } from "../../hooks/useAccentColor";
import { renderSwatch } from "../../theme";

// A render the server is still making is asked for again after these waits, then the card gives up on it. A heavy
// model waits behind its own 3D preview in the server's queue, so this runs to a few minutes.
const RETRY_DELAYS_MS = [2000, 4000, 8000, ...Array<number>(13).fill(15000)];

const fadeIn = keyframes`
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
`;

type Props = {
  /** The plate's `render_url`. */
  url: string;
  alt: string;
  /** Called once the server says it can't draw this model, or it still hasn't after the last retry. */
  onUnavailable: () => void;
  /** Shown until the render is in, e.g. the model's own picture; a skeleton without one. */
  placeholder?: ReactNode;
};

/**
 * The server's render of a model, in the user's render colour (the accent unless picked apart) on a soft glow of it. The render is grey shading on
 * transparent: the accent fills the model's silhouette and the shading is multiplied over it, so one picture serves
 * every theme and colour and a switch needs nothing new from the server.
 */
export default function ModelRender({ url, alt, onUnavailable, placeholder }: Props) {
  const tint = renderSwatch(useRenderColor()).color;
  // Failed loads so far; past the last retry the card falls back.
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // A new model starts over.
  const [forUrl, setForUrl] = useState(url);
  if (forUrl !== url) {
    setForUrl(url);
    setAttempt(0);
    setWaiting(false);
    setLoaded(false);
  }
  // The render currently shown, or null once gone, so a check still out for an earlier one is dropped.
  const liveUrl = useRef<string | null>(url);
  useEffect(() => {
    liveUrl.current = url;
    return () => {
      liveUrl.current = null;
    };
  }, [url]);

  useEffect(() => {
    if (attempt > RETRY_DELAYS_MS.length) onUnavailable();
    if (!waiting) return;
    const timer = window.setTimeout(() => setWaiting(false), RETRY_DELAYS_MS[attempt - 1]);
    return () => window.clearTimeout(timer);
  }, [waiting, attempt, onUnavailable]);

  // Each retry asks afresh, so a cached "not ready" answer isn't reused.
  const src = printsApi.fileUrl(attempt ? `${url}${url.includes("?") ? "&" : "?"}attempt=${attempt}` : url);
  const layerSx = { position: "absolute", inset: "6%", width: "88%", height: "88%" } as const;

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        // Its own stacking context, so the multiply only blends with the silhouette under it.
        isolation: "isolate",
        background: (theme) =>
          `radial-gradient(circle at 50% 48%, ${alpha(tint, theme.palette.mode === "dark" ? 0.2 : 0.14)} 0%, transparent 68%)`,
      }}
    >
      {!loaded &&
        (placeholder ?? (
          <Skeleton variant="rectangular" animation="wave" sx={{ position: "absolute", inset: 0, height: "100%" }} />
        ))}
      {loaded && (
        <Box
          aria-hidden
          sx={{
            ...layerSx,
            bgcolor: tint,
            mask: `url("${src}") center / contain no-repeat`,
            WebkitMask: `url("${src}") center / contain no-repeat`,
            animation: `${fadeIn} 250ms ease-out`,
            transition: "background-color 200ms",
            "@media (prefers-reduced-motion: reduce)": { animation: "none", transition: "none" },
          }}
        />
      )}
      {!waiting && (
        <Box
          component="img"
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            const checking = url;
            // Only a render still being made is worth waiting for; the server says which it is.
            void fetch(src)
              .then((res) => res.json() as Promise<{ code?: string }>)
              .catch(() => ({ code: undefined }))
              .then(({ code }) => {
                if (liveUrl.current !== checking) return;
                if (code && code !== "PREVIEW_GENERATING") return onUnavailable();
                setAttempt((count) => count + 1);
                setWaiting(true);
              });
          }}
          sx={{
            ...layerSx,
            objectFit: "contain",
            mixBlendMode: "multiply",
            opacity: loaded ? 1 : 0,
            animation: loaded ? `${fadeIn} 250ms ease-out` : "none",
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        />
      )}
    </Box>
  );
}
