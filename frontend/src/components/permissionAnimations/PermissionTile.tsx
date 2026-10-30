import type React from "react";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

// A small picture of what each API token permission (an MCP tool or a REST scope) gives, sized to a permission row. Still until its row is hovered
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
const sweep = keyframes`
  0%, 100% { opacity: 0.25; }
  40% { opacity: 1; }
`;
const sunrise = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
`;
const download = keyframes`
  0% { transform: translateY(-3px); opacity: 0; }
  30% { opacity: 1; }
  70% { transform: translateY(3px); opacity: 1; }
  100% { transform: translateY(5px); opacity: 0; }
`;
const upload = keyframes`
  0% { transform: translateY(5px); opacity: 0; }
  30% { opacity: 1; }
  70% { transform: translateY(-3px); opacity: 1; }
  100% { transform: translateY(-5px); opacity: 0; }
`;
const fileIn = keyframes`
  0% { transform: translateY(0); opacity: 1; }
  65% { transform: translateY(13px); opacity: 1; }
  66% { transform: translateY(13px); opacity: 0; }
  67% { transform: translateY(-4px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
`;

const fileOut = keyframes`
  0% { transform: translateY(13px); opacity: 0; }
  1% { transform: translateY(13px); opacity: 1; }
  65% { transform: translateY(0); opacity: 1; }
  100% { transform: translateY(-4px); opacity: 0; }
`;
const scribble = keyframes`
  0%, 100% { transform: translate(0, 0) rotate(45deg); }
  25% { transform: translate(-5px, 2px) rotate(45deg); }
  50% { transform: translate(-1px, 5px) rotate(45deg); }
  75% { transform: translate(-6px, 6px) rotate(45deg); }
`;
const swap = keyframes`
  0%, 100% { transform: translate(0, 0); }
  50% { transform: translate(-6px, -5px); }
`;

type Accent = "primary" | "warning";
type BadgeColor = "primary" | "warning" | "error";

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

/** A file: a sheet with its corner folded. `animation` makes it come and go. */
function Sheet({ x, y, animation, faded = false }: { x: number; y: number; animation?: string; faded?: boolean }) {
  return (
    <Box sx={{ ...at(x, y, 18, 24), animation, ...(faded && { opacity: 0.5, transform: "scale(0.8)" }) }}>
      <Box
        sx={{
          ...at(0, 0, 18, 24),
          bgcolor: "background.paper",
          border: 1.5,
          borderColor: "text.disabled",
          borderRadius: "2px",
          clipPath: "polygon(0 0, 65% 0, 100% 27%, 100% 100%, 0 100%)",
        }}
      />
      <Box sx={{ ...at(11, 0, 7, 7), bgcolor: "text.disabled", clipPath: "polygon(0 0, 100% 100%, 0 100%)" }} />
    </Box>
  );
}

/** An arrow, pointing down or up. */
function Arrow({ up = false }: { up?: boolean }) {
  return (
    <Box sx={{ ...at(0, 0, 12, 12), transform: up ? "rotate(180deg)" : undefined }}>
      <Box sx={{ ...at(4.5, 0, 3, 6), bgcolor: "primary.main" }} />
      <Box sx={{ ...at(1, 5, 10, 6), bgcolor: "primary.main", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
    </Box>
  );
}

/** A picture: a frame with a sun and two hills. */
function Picture({ sx, sun }: { sx: SxProps<Theme>; sun?: string }) {
  return (
    <Box sx={{ borderRadius: "3px", border: 1.5, borderColor: "text.disabled", overflow: "hidden", ...sx }}>
      <Box sx={{ ...at(14, 3, 5, 5), borderRadius: "50%", bgcolor: "warning.main", animation: sun }} />
      <Box sx={{ ...at(-2, 7, 18, 12), bgcolor: "primary.main", clipPath: "polygon(50% 0, 100% 100%, 0 100%)" }} />
      <Box
        sx={{
          ...at(9, 10, 14, 9),
          bgcolor: "primary.dark",
          opacity: 0.8,
          clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
        }}
      />
    </Box>
  );
}

/** A round badge with a plus, or a minus, that pulses: something added or taken away. */
function Badge({ x, y, color, minus = false }: { x: number; y: number; color: BadgeColor; minus?: boolean }) {
  return (
    <Box sx={{ ...at(x, y, 13, 13), borderRadius: "50%", bgcolor: `${color}.main`, animation: run(pulse, 1.6) }}>
      <Box sx={{ ...at(3, 5.5, 7, 2), bgcolor: "background.paper", borderRadius: 1 }} />
      {!minus && <Box sx={{ ...at(5.5, 3, 2, 7), bgcolor: "background.paper", borderRadius: 1 }} />}
    </Box>
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
  // A model's own files: listing them, fetching one, and adding a model made of them.
  list_model_files: () => (
    <>
      <Sheet x={7} y={6} faded animation={run(sweep, 2.4, "0.6s")} />
      <Sheet x={15} y={10} animation={run(sweep, 2.4)} />
    </>
  ),
  get_model_file: () => (
    <>
      <Sheet x={11} y={7} />
      <Box sx={{ ...at(14, 14, 12, 12), animation: run(download, 1.6) }}>
        <Arrow />
      </Box>
    </>
  ),
  upload_model: () => (
    <>
      <Sheet x={11} y={7} />
      <Box sx={{ ...at(14, 14, 12, 12), animation: run(upload, 1.6) }}>
        <Arrow up />
      </Box>
    </>
  ),
  add_model_files: () => (
    <>
      <Sheet x={9} y={7} />
      <Badge x={20} y={20} color="primary" />
    </>
  ),
  remove_model_file: () => (
    <>
      <Sheet x={9} y={7} />
      <Badge x={20} y={20} color="error" minus />
    </>
  ),
  rename_model_file: () => (
    <>
      <Sheet x={7} y={6} />
      <Box
        sx={{
          ...at(17, 25, 16, 7),
          borderRadius: "2px",
          bgcolor: "background.paper",
          border: 1.5,
          borderColor: "primary.main",
        }}
      >
        <Box sx={{ ...at(2, 1.5, 8, 2), bgcolor: "text.disabled", borderRadius: 1 }} />
        <Box sx={{ ...at(11, 0.5, 1.5, 4), bgcolor: "primary.main", animation: run(blink, 1) }} />
      </Box>
    </>
  ),
  delete_model: () => (
    <>
      <Card sx={{ ...at(10, 7, 20, 26), opacity: 0.6 }} />
      <Badge x={21} y={21} color="error" minus />
    </>
  ),
  // A model's details, written over with a pencil.
  edit_model: () => (
    <>
      <Card sx={at(9, 7, 20, 26)} />
      <Box sx={{ ...at(22, 13, 4, 14), transformOrigin: "50% 100%", animation: run(scribble, 2.4) }}>
        <Box sx={{ ...at(0, 0, 4, 11), bgcolor: "warning.main", borderRadius: "1px 1px 0 0" }} />
        <Box sx={{ ...at(0, 11, 4, 3), bgcolor: "text.primary", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
      </Box>
    </>
  ),
  // A model's pictures: its gallery, and changing it.
  list_model_images: () => <Picture sx={at(8, 10, 24, 20)} sun={run(sunrise, 2.2)} />,
  edit_model_images: () => (
    <>
      <Picture sx={{ ...at(12, 7, 20, 17), opacity: 0.5, animation: run(swap, 2.4) }} />
      <Picture sx={{ ...at(7, 14, 20, 17), bgcolor: "background.paper" }} />
      <Badge x={22} y={22} color="primary" />
    </>
  ),
  create_category: () => (
    <>
      <Box sx={{ ...at(8, 8, 10, 6), bgcolor: "primary.main", borderRadius: "2px" }} />
      <Box sx={{ ...at(11, 14, 2, 15), bgcolor: "text.disabled" }} />
      <Box sx={{ ...at(11, 20, 8, 2), bgcolor: "text.disabled" }} />
      <Box sx={{ ...at(19, 18, 13, 6), bgcolor: "primary.main", borderRadius: "2px" }} />
      <Box sx={{ ...at(11, 29, 8, 2), bgcolor: "text.disabled" }} />
      <Box
        sx={{
          ...at(19, 27, 13, 6),
          bgcolor: "warning.main",
          borderRadius: "2px",
          transformOrigin: "0 50%",
          animation: run(pulse, 1.6),
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
  remove_from_collection: () => (
    <Folder accent="warning">
      <Card sx={{ ...at(14, 3, 12, 13), animation: run(fileOut, 2) }} />
    </Folder>
  ),
  // A dashboard widget's panel, drawn by the tool: its guide, the list of them, and saving one.
  widget_guide: () => (
    <>
      <Box sx={{ ...at(9, 8, 22, 26), borderRadius: "3px", border: 2, borderColor: "text.disabled" }} />
      {[0, 1, 2].map((i) => (
        <Box key={i} sx={{ ...at(13, 13 + i * 6, 14 - i * 3, 2), borderRadius: 1, bgcolor: "text.disabled" }} />
      ))}
    </>
  ),
  list_widgets: () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <Box
          key={i}
          sx={{
            ...at(9 + (i % 2) * 12, 9 + Math.floor(i / 2) * 12, 10, 10),
            borderRadius: "3px",
            bgcolor: i === 0 ? "primary.main" : "text.disabled",
            opacity: i === 0 ? 0.6 : 1,
          }}
        />
      ))}
    </>
  ),
  save_widget: () => (
    <>
      <Box
        sx={{
          ...at(9, 9, 22, 22),
          borderRadius: "3px",
          border: 2,
          borderStyle: "dashed",
          borderColor: "text.disabled",
        }}
      />
      <Box sx={{ ...at(15, 15, 10, 10), borderRadius: "3px", bgcolor: "primary.main", animation: run(pulse, 1.6) }} />
    </>
  ),
  // A tool's own window: its guide, the tools on the Tools page, and saving one.
  tool_guide: () => (
    <>
      <Box sx={{ ...at(6, 8, 28, 24), borderRadius: "3px", border: 2, borderColor: "text.disabled" }} />
      <Box sx={{ ...at(6, 8, 28, 6), bgcolor: "text.disabled", opacity: 0.5 }} />
      {[0, 1, 2].map((i) => (
        <Box key={i} sx={{ ...at(10, 18 + i * 5, 20 - i * 5, 2), borderRadius: 1, bgcolor: "text.disabled" }} />
      ))}
    </>
  ),
  list_tools: () => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <Box
          key={i}
          sx={{
            ...at(8 + (i % 2) * 13, 8 + Math.floor(i / 2) * 13, 11, 11),
            borderRadius: "3px",
            border: 1.5,
            borderColor: i === 0 ? "primary.main" : "text.disabled",
            bgcolor: i === 0 ? "primary.main" : "transparent",
            opacity: i === 0 ? 0.55 : 1,
          }}
        >
          <Box sx={{ height: 3.5, bgcolor: "text.disabled", opacity: 0.5 }} />
        </Box>
      ))}
    </>
  ),
  save_tool: () => (
    <>
      <Box
        sx={{
          ...at(6, 8, 28, 24),
          borderRadius: "3px",
          border: 2,
          borderStyle: "dashed",
          borderColor: "text.disabled",
        }}
      />
      <Box sx={{ ...at(6, 8, 28, 6), bgcolor: "text.disabled", opacity: 0.35 }} />
      <Box sx={{ ...at(14, 18, 12, 10), borderRadius: "3px", bgcolor: "primary.main", animation: run(pulse, 1.6) }} />
    </>
  ),
  // Icons: a grid of them with the one found lighting up in turn, and one carried up into it.
  list_icons: () => (
    <>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Box
          key={i}
          sx={{
            ...at(7 + (i % 3) * 9.5, 11 + Math.floor(i / 3) * 10, 7, 7),
            borderRadius: i % 2 ? "50%" : "2px",
            bgcolor: "primary.main",
            opacity: 0.25,
            animation: run(sweep, 2.4, `${i * 0.4}s`),
          }}
        />
      ))}
    </>
  ),
  upload_icon: () => (
    <>
      <Box sx={{ ...at(10, 22, 20, 10), borderRadius: "3px", border: 2, borderColor: "text.disabled" }} />
      <Box sx={{ ...at(15, 8, 10, 10), animation: run(rise, 1.8) }}>
        <Box sx={{ ...at(0, 0, 10, 10), borderRadius: "50%", bgcolor: "primary.main" }} />
      </Box>
    </>
  ),
  activity: () => (
    <>
      {Array.from({ length: 12 }, (_, i) => (
        <Box
          key={i}
          sx={{
            ...at(9 + (i % 4) * 6, 11 + Math.floor(i / 4) * 6, 4, 4),
            borderRadius: "1px",
            bgcolor: "primary.main",
            opacity: [0.25, 0.6, 1, 0.4][(i * 7) % 4],
            animation: run(sweep, 2.4, `${(i % 4) * 0.2 + Math.floor(i / 4) * 0.1}s`),
          }}
        />
      ))}
    </>
  ),
  other: () => (
    <>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            ...at(10 + i * 8, 17, 5, 5),
            borderRadius: "50%",
            bgcolor: "primary.main",
            animation: run(bob, 1.2, `${i * 0.15}s`),
          }}
        />
      ))}
    </>
  ),
};

// REST scopes that read the same thing as an MCP tool share its picture.
const aliases: Record<string, string> = {
  search: "search_models",
  models: "list_models",
  collections: "list_collections",
  tags: "list_tags",
  categories: "list_categories",
  authors: "get_author",
  dashboard: "library_stats",
  imports: "get_import_status",
  files: "get_model_file",
  images: "list_model_images",
};

/** A plug, for a permission the frontend doesn't have a picture of yet. */
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
  /** An MCP tool's name or a REST scope's id. */
  name: string;
  /** Off: greyed out, as the token can't use it. */
  allowed: boolean;
};

export default function PermissionTile({ name, allowed }: Props) {
  const picture = pictures[aliases[name] ?? name];
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
