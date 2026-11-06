import { useEffect, useState, type ReactNode } from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import { coverImageUrl, type ProfileCoverValue } from "../../constants/profileCovers";

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;

type Props = {
  cover: ProfileCoverValue | null | undefined;
  height: number;
  /** In place of the cover's own crop, as the edit dialog's preview does while it's dragged. */
  positionY?: number;
  /** Laid over the cover, e.g. a button to change it. */
  children?: ReactNode;
  sx?: SxProps<Theme>;
};

/** A profile's cover strip. A new picture fades in over the one before once it has loaded, rather than popping in. */
export default function ProfileCover({ cover, height, positionY, children, sx }: Props) {
  const url = coverImageUrl(cover);
  const [layers, setLayers] = useState<{ under: string | null; over: string | null }>({ under: null, over: null });

  useEffect(() => {
    if (!url) {
      setLayers({ under: null, over: null });
      return;
    }
    let cancelled = false;
    const image = new Image();
    // A picture that fails still takes the place of the last one: showing a cover they replaced would be wrong.
    const show = () => {
      if (!cancelled) setLayers((prev) => (prev.over === url ? prev : { under: prev.over, over: url }));
    };
    image.addEventListener("load", show);
    image.addEventListener("error", show);
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  const y = positionY ?? cover?.cover_position_y ?? 50;
  const layerSx = (layerUrl: string) => ({
    position: "absolute",
    inset: 0,
    // Quoted: an unquoted url() ends at the first ")", which a data: URI can contain.
    backgroundImage: `url("${layerUrl}")`,
    backgroundSize: "cover",
    backgroundPosition: `center ${y}%`,
  });

  return (
    <Box
      sx={[
        { position: "relative", height, bgcolor: "action.hover", overflow: "hidden" },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {layers.under && <Box aria-hidden sx={layerSx(layers.under)} />}
      {layers.over && (
        <Box
          key={layers.over}
          aria-hidden
          sx={{
            ...layerSx(layers.over),
            animation: `${fadeIn} 250ms ease-out`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        />
      )}
      {children}
    </Box>
  );
}
