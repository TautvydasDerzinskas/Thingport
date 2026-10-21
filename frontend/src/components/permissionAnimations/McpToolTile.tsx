import type React from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

// A small picture of what each MCP tool does, sized to a permission row. Still until its row is hovered
// or focused (a `.permission-row` ancestor), so a list of them doesn't all move at once; every
// animation's 0% is its resting pose.

const SIZE = 40;

const wander = keyframes`
  0%, 100% { transform: translate(0, 0); }
  25% { transform: translate(6px, 1px); }
  50% { transform: translate(3px, 7px); }
  75% { transform: translate(-3px, 3px); }
`;
const scroll = keyframes`
  from { transform: translateY(0); }
  to { transform: translateY(-7px); }
`;
const tilt = keyframes`
  0%, 100% { transform: perspective(60px) rotateY(0deg); }
  50% { transform: perspective(60px) rotateY(-28deg); }
`;
const fanLeft = keyframes`
  0%, 100% { transform: rotate(-4deg); }
  50% { transform: rotate(-16deg) translateX(-3px); }
`;
const fanRight = keyframes`
  0%, 100% { transform: rotate(4deg); }
  50% { transform: rotate(16deg) translateX(3px); }
`;
const rise = keyframes`
  0%, 100% { transform: translateY(3px); }
  50% { transform: translateY(-4px); }
`;
const swing = keyframes`
  0%, 100% { transform: rotate(0deg); }
  30% { transform: rotate(-12deg); }
  70% { transform: rotate(10deg); }
`;
const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
`;
const bob = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
`;
const grow = keyframes`
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.4); }
`;
const spin = keyframes`
  to { transform: rotate(360deg); }
`;
const drop = keyframes`
  0% { transform: translateY(0); opacity: 1; }
  60% { transform: translateY(8px); opacity: 1; }
  61% { transform: translateY(-4px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
`;
const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.3); }
`;
const fileIn = keyframes`
  0% { transform: translateY(0); opacity: 1; }
  65% { transform: translateY(13px); opacity: 1; }
  66% { transform: translateY(13px); opacity: 0; }
  67% { transform: translateY(-4px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
`;

type Accent = "primary" | "warning";

function at(x: number, y: number, w: number, h: number): SxProps<Theme> {
  return { position: "absolute", left: x, top: y, width: w, height: h };
}

function run(frames: ReturnType<typeof keyframes>, seconds: number, extra = "") {
  return `${frames} ${seconds}s ease-in-out infinite ${extra}`.trim();
}

/** A folder: its back and tab, then `children` (what's inside), then the front flap over them. */
function Folder({ accent, children }: { accent: Accent; children?: React.ReactNode }) {
  return (
    <>
      <Box sx={{ ...at(8, 12, 10, 5), bgcolor: `${accent}.main`, borderRadius: "2px 2px 0 0" }} />
      <Box sx={{ ...at(8, 15, 24, 16), bgcolor: `${accent}.main`, borderRadius: "2px" }} />
      {children}
      <Box sx={{ ...at(8, 21, 24, 10), bgcolor: `${accent}.dark`, borderRadius: "0 0 2px 2px" }} />
    </>
  );
}

/** A model card: a picture area and a line of text. */
function Card({ sx }: { sx: SxProps<Theme> }) {
  return (
    <Box
      sx={{
        bgcolor: "background.paper",
        border: 1.5,
        borderColor: "text.disabled",
        borderRadius: "3px",
        overflow: "hidden",
        ...sx,
      }}
    >
      <Box sx={{ height: "55%", bgcolor: "primary.main", opacity: 0.35 }} />
      <Box sx={{ mx: "15%", mt: "12%", height: 2, borderRadius: 1, bgcolor: "text.disabled" }} />
    </Box>
  );
}

const pictures: Record<string, () => React.ReactNode> = {
  search_models: () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <Box
          key={i}
          sx={{
            ...at(9 + (i % 2) * 12, 9 + Math.floor(i / 2) * 12, 9, 9),
            borderRadius: "2px",
            bgcolor: "text.disabled",
            opacity: 0.35,
          }}
        />
      ))}
      <Box sx={{ ...at(9, 9, 20, 20), animation: run(wander, 2.6) }}>
        <Box sx={{ ...at(0, 0, 14, 14), border: 2.5, borderColor: "primary.main", borderRadius: "50%" }} />
        <Box
          sx={{
            ...at(11, 13, 8, 3),
            bgcolor: "primary.main",
            borderRadius: 1,
            transform: "rotate(45deg)",
          }}
        />
      </Box>
    </>
  ),
  list_models: () => (
    <Box sx={{ ...at(9, 8, 22, 25), overflow: "hidden" }}>
      <Box sx={{ animation: `${scroll} 1.4s linear infinite` }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Box key={i} sx={{ display: "flex", gap: "3px", mb: "3px", height: 4 }}>
            <Box sx={{ width: 4, bgcolor: "primary.main", borderRadius: "1px" }} />
            <Box sx={{ flex: 1, bgcolor: "text.disabled", opacity: 0.5, borderRadius: 1 }} />
          </Box>
        ))}
      </Box>
    </Box>
  ),
  get_model: () => <Card sx={{ ...at(10, 7, 20, 26), animation: run(tilt, 2.4) }} />,
  list_collections: () => (
    <>
      <Card sx={{ ...at(12, 9, 16, 22), transformOrigin: "50% 100%", animation: run(fanLeft, 2.2) }} />
      <Card sx={{ ...at(12, 9, 16, 22), transformOrigin: "50% 100%", animation: run(fanRight, 2.2) }} />
      <Card sx={{ ...at(12, 9, 16, 22), borderColor: "primary.main" }} />
    </>
  ),
  get_collection: () => (
    <Folder accent="primary">
      <Card sx={{ ...at(13, 5, 14, 15), animation: run(rise, 2) }} />
    </Folder>
  ),
  list_tags: () => (
    <>
      {[
        { x: 13, y: 9, opacity: 0.45, delay: "0.3s" },
        { x: 9, y: 17, opacity: 1, delay: "0s" },
      ].map((tag) => (
        <Box
          key={tag.y}
          sx={{
            ...at(tag.x, tag.y, 20, 12),
            bgcolor: "primary.main",
            opacity: tag.opacity,
            clipPath: "polygon(30% 0, 100% 0, 100% 100%, 30% 100%, 0 50%)",
            transformOrigin: "0 50%",
            animation: run(swing, 2.4, tag.delay),
          }}
        >
          <Box sx={{ ...at(4, 4.5, 3, 3), borderRadius: "50%", bgcolor: "background.paper" }} />
        </Box>
      ))}
    </>
  ),
  list_categories: () => (
    <>
      <Box sx={{ ...at(8, 8, 10, 6), bgcolor: "primary.main", borderRadius: "2px" }} />
      <Box sx={{ ...at(11, 14, 2, 15), bgcolor: "text.disabled" }} />
      {[18, 27].map((y, i) => (
        <Box key={y}>
          <Box sx={{ ...at(11, y + 2, 8, 2), bgcolor: "text.disabled" }} />
          <Box
            sx={{
              ...at(19, y, 13, 6),
              bgcolor: "primary.main",
              borderRadius: "2px",
              animation: run(blink, 1.6, `${i * 0.4}s`),
            }}
          />
        </Box>
      ))}
    </>
  ),
  get_author: () => (
    <Box sx={{ ...at(0, 0, SIZE, SIZE), animation: run(bob, 1.6) }}>
      <Box sx={{ ...at(15, 8, 10, 10), borderRadius: "50%", bgcolor: "primary.main" }} />
      <Box sx={{ ...at(10, 20, 20, 12), borderRadius: "10px 10px 2px 2px", bgcolor: "primary.main" }} />
    </Box>
  ),
  library_stats: () => (
    <>
      {[10, 18, 13, 22].map((height, i) => (
        <Box
          key={height}
          sx={{
            ...at(9 + i * 6, 31 - height, 4, height),
            bgcolor: "primary.main",
            borderRadius: "1px 1px 0 0",
            transformOrigin: "bottom",
            animation: run(grow, 1.8, `${i * 0.15}s`),
          }}
        />
      ))}
      <Box sx={{ ...at(7, 31, 26, 2), bgcolor: "text.disabled", borderRadius: 1 }} />
    </>
  ),
  get_import_status: () => (
    <>
      <Box
        sx={{
          ...at(10, 10, 20, 20),
          borderRadius: "50%",
          border: 3,
          borderColor: "divider",
          borderTopColor: "primary.main",
          borderRightColor: "primary.main",
          animation: `${spin} 1.2s linear infinite`,
        }}
      />
      <Box sx={{ ...at(18, 18, 4, 4), borderRadius: "50%", bgcolor: "primary.main" }} />
    </>
  ),
  import_model: () => (
    <>
      <Box sx={{ ...at(13, 6, 14, 18), animation: run(drop, 1.8) }}>
        <Box sx={{ ...at(5.5, 0, 3, 10), bgcolor: "warning.main" }} />
        <Box sx={{ ...at(1, 9, 12, 7), bgcolor: "warning.main", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
      </Box>
      <Box
        sx={{
          ...at(9, 24, 22, 9),
          border: 2.5,
          borderTop: 0,
          borderColor: "text.disabled",
          borderRadius: "0 0 4px 4px",
        }}
      />
    </>
  ),
  create_collection: () => (
    <Folder accent="warning">
      <Box sx={{ ...at(14, 18, 12, 12), zIndex: 1, animation: run(pulse, 1.6) }}>
        <Box sx={{ ...at(4.5, 0, 3, 12), bgcolor: "background.paper", borderRadius: 1 }} />
        <Box sx={{ ...at(0, 4.5, 12, 3), bgcolor: "background.paper", borderRadius: 1 }} />
      </Box>
    </Folder>
  ),
  add_to_collection: () => (
    <Folder accent="warning">
      <Card sx={{ ...at(14, 3, 12, 13), animation: run(fileIn, 2) }} />
    </Folder>
  ),
};

/** A plug, for a tool the frontend doesn't have a picture of yet. */
function Fallback() {
  return (
    <>
      <Box sx={{ ...at(13, 12, 14, 12), bgcolor: "primary.main", borderRadius: "3px 3px 6px 6px" }} />
      <Box sx={{ ...at(15, 7, 3, 6), bgcolor: "text.disabled" }} />
      <Box sx={{ ...at(22, 7, 3, 6), bgcolor: "text.disabled" }} />
      <Box sx={{ ...at(18.5, 24, 3, 9), bgcolor: "text.disabled" }} />
    </>
  );
}

type Props = {
  tool: string;
  /** Off: greyed out, as the tool can't be called. */
  allowed: boolean;
};

export default function McpToolTile({ tool, allowed }: Props) {
  const picture = pictures[tool];
  return (
    <Box
      aria-hidden
      sx={{
        display: { xs: "none", sm: "block" },
        position: "relative",
        flexShrink: 0,
        width: SIZE,
        height: SIZE,
        borderRadius: "10px",
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
        overflow: "hidden",
        opacity: allowed ? 1 : 0.45,
        filter: allowed ? "none" : "grayscale(1)",
        transition: "opacity 200ms, filter 200ms",
        "& *": { animationPlayState: "paused" },
        ".permission-row:hover & *, .permission-row:focus-within & *": { animationPlayState: "running" },
        "@media (prefers-reduced-motion: reduce)": { transition: "none", "& *": { animation: "none !important" } },
      }}
    >
      {picture ? picture() : <Fallback />}
    </Box>
  );
}
