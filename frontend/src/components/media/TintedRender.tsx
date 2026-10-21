import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

type Props = {
  /** Grey shading on transparent, like the server's renders and render mosaics. */
  src: string;
  tint: string;
  /** Placed absolutely over a `position: relative` parent; this styles that layer. */
  sx?: SxProps<Theme>;
  loading?: "lazy" | "eager";
};

/** Fills the picture's silhouette with `tint` and multiplies its shading over it, so one grey picture shows in any
 *  colour. Its own stacking context, so the multiply blends only with the fill under it. */
export default function TintedRender({ src, tint, sx, loading }: Props) {
  const layer = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;
  return (
    <Box aria-hidden sx={[{ ...layer, isolation: "isolate" }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <Box
        sx={{
          ...layer,
          bgcolor: tint,
          mask: `url("${src}") center / contain no-repeat`,
          WebkitMask: `url("${src}") center / contain no-repeat`,
          transition: "background-color 200ms",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      />
      <Box
        component="img"
        src={src}
        alt=""
        loading={loading}
        decoding="async"
        sx={{ ...layer, display: "block", objectFit: "contain", mixBlendMode: "multiply" }}
      />
    </Box>
  );
}
