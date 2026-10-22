import Box from "@mui/material/Box";
import { alpha, type Theme } from "@mui/material/styles";
import { cellColor } from "../ProfilePage/activity/Heatmap";
import { MONO_FONT } from "./ClockCard";

/** Which drawing a widget gets in the Panels picker: the shape of its real card, without its data. */
export type PanelSketchKind =
  | "count"
  | "models"
  | "authors"
  | "providers"
  | "clock"
  | "weather"
  | "featured"
  | "heatmap"
  | "rss"
  | "cpu"
  | "uptime"
  | "launcher"
  | "trending"
  | "custom";

const accent = (theme: Theme) => alpha(theme.palette.primary.main, 0.55);
const ink = (theme: Theme) => alpha(theme.palette.text.primary, 0.16);
const faint = (theme: Theme) => alpha(theme.palette.text.primary, 0.08);

type Fill = (theme: Theme) => string;

function Bar({
  width,
  height = 4,
  fill = ink,
  round = false,
}: {
  width: string;
  height?: number;
  fill?: Fill;
  round?: boolean;
}) {
  return <Box sx={{ width, height, flexShrink: 0, borderRadius: round ? "50%" : "2px", bgcolor: fill }} />;
}

/** A card's title row: its icon in the accent colour, then the title. */
function Header() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: "3px", mb: "4px" }}>
      <Bar width="7px" height={7} fill={accent} round />
      <Bar width="45%" height={5} />
    </Box>
  );
}

function Rows({ count, lead }: { count: number; lead: "thumb" | "avatar" | "chip" }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {Array.from({ length: count }, (_, index) => (
        <Box key={index} sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
          {lead === "chip" ? (
            // Each provider chip carries its brand colour; varied shades stand in for them.
            <Bar
              width={`${34 - (index % 3) * 6}%`}
              height={7}
              fill={(theme) => alpha(theme.palette.primary.main, 0.75 - index * 0.15)}
            />
          ) : (
            <>
              <Bar width="9px" height={9} fill={faint} round={lead === "avatar"} />
              {/* Varied widths read as real names rather than a block. */}
              <Bar width={`${48 - (index % 3) * 9}%`} />
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <Bar width="14%" height={3} fill={faint} />
        </Box>
      ))}
    </Box>
  );
}

// A fixed pattern, so the drawing doesn't change between renders. Levels 0-4, as the real heatmap's.
const LEVELS = [0, 1, 0, 2, 3, 1, 0, 4, 2, 1, 0, 3];
// The CPU panel's history line, as bar heights in percent.
const LOAD = [30, 45, 38, 60, 52, 70, 48, 40, 55, 35, 42, 58];
const HEAT = Array.from({ length: 60 }, (_, id) => ({
  id,
  level: LEVELS[(id * 5 + Math.floor(id / 5)) % LEVELS.length],
}));

function sketchBody(kind: PanelSketchKind) {
  switch (kind) {
    case "count":
      return (
        <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "5px", flex: 1 }}>
          <Bar width="10px" height={10} fill={accent} />
          <Bar width="38%" height={11} />
          <Bar width="55%" height={4} fill={faint} />
        </Box>
      );
    case "models":
      return (
        <>
          <Header />
          <Rows count={3} lead="thumb" />
        </>
      );
    case "authors":
      return (
        <>
          <Header />
          <Rows count={4} lead="avatar" />
        </>
      );
    case "providers":
      return (
        <>
          <Header />
          <Rows count={4} lead="chip" />
        </>
      );
    case "clock":
      return (
        <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: "3px", flex: 1 }}>
          <Box
            sx={{
              fontFamily: MONO_FONT,
              fontSize: 18,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: (theme) => theme.thingport.headingText,
            }}
          >
            09:41
          </Box>
          <Bar width="50%" height={3} />
          <Bar width="35%" height={3} fill={faint} />
        </Box>
      );
    case "weather":
      return (
        <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <Bar width="16px" height={16} fill={(theme) => alpha(theme.palette.warning.main, 0.8)} round />
            <Box sx={{ display: "flex", flexDirection: "column", gap: "3px", flex: 1 }}>
              <Bar width="40%" height={9} />
              <Bar width="60%" height={3} fill={faint} />
            </Box>
          </Box>
          <Box sx={{ display: "flex", gap: "3px" }}>
            {[0, 1, 2, 3].map((index) => (
              <Box key={index} sx={{ flex: 1, height: 10, borderRadius: "2px", bgcolor: faint }} />
            ))}
          </Box>
        </Box>
      );
    case "featured":
      return (
        <Box sx={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <Header />
          {/* The spinning model: a cube seen from a corner. */}
          <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Box
              sx={{
                width: 18,
                height: 18,
                borderRadius: "3px",
                bgcolor: accent,
                transform: "rotate(45deg) skew(-12deg, -12deg)",
                boxShadow: (theme) => `4px 4px 0 ${alpha(theme.palette.primary.main, 0.25)}`,
              }}
            />
          </Box>
        </Box>
      );
    case "heatmap":
      return (
        <>
          <Header />
          <Box
            sx={{
              display: "grid",
              gridTemplateRows: "repeat(5, 1fr)",
              gridAutoFlow: "column",
              gridAutoColumns: "1fr",
              gap: "2px",
              mt: "2px",
            }}
          >
            {HEAT.map((cell) => (
              <Box
                key={cell.id}
                sx={{ aspectRatio: "1", borderRadius: "1px", bgcolor: (theme) => cellColor(theme, cell.level) }}
              />
            ))}
          </Box>
        </>
      );
    case "rss":
      return (
        <>
          <Header />
          <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {[0, 1, 2].map((index) => (
              <Box key={index} sx={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <Bar width={`${80 - index * 12}%`} />
                <Bar width="30%" height={3} fill={faint} />
              </Box>
            ))}
          </Box>
        </>
      );
    case "cpu":
      return (
        <Box sx={{ display: "flex", flexDirection: "column", flex: 1, gap: "4px" }}>
          <Header />
          <Bar width="34%" height={11} />
          <Box sx={{ flex: 1, display: "flex", alignItems: "flex-end", gap: "2px" }}>
            {LOAD.map((value, index) => (
              <Box key={index} sx={{ flex: 1, height: `${value}%`, borderRadius: "1px", bgcolor: accent }} />
            ))}
          </Box>
        </Box>
      );
    case "uptime":
      return (
        <>
          <Header />
          <Box sx={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            {[true, true, false, true].map((up, index) => (
              <Box key={index} sx={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Bar
                  width="6px"
                  height={6}
                  round
                  fill={(theme) => (up ? theme.palette.success.main : theme.palette.error.main)}
                />
                <Bar width={`${46 - (index % 3) * 8}%`} />
                <Box sx={{ flex: 1 }} />
                <Bar width="12%" height={3} fill={faint} />
              </Box>
            ))}
          </Box>
        </>
      );
    case "custom":
      return (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* A jigsaw piece: something the user or the community made. */}
          <Box
            sx={{
              width: 22,
              height: 22,
              borderRadius: "4px",
              bgcolor: accent,
              position: "relative",
              "&::before, &::after": {
                content: '""',
                position: "absolute",
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: accent,
              },
              "&::before": { top: -4, left: 7 },
              "&::after": { right: -4, top: 7 },
            }}
          />
        </Box>
      );
    case "trending":
      return (
        <>
          <Box sx={{ display: "flex", gap: "4px", mb: "5px" }}>
            {[0, 1, 2].map((index) => (
              <Box
                key={index}
                sx={(theme) => ({
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  bgcolor: index === 0 ? accent(theme) : ink(theme),
                  outline: index === 0 ? `1px solid ${theme.palette.primary.main}` : "none",
                  outlineOffset: "1px",
                })}
              />
            ))}
          </Box>
          <Rows count={3} lead="thumb" />
        </>
      );
    case "launcher":
      return (
        <Box
          sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px", alignContent: "center", flex: 1 }}
        >
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            <Box key={index} sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: "4px",
                  bgcolor: index % 3 === 0 ? accent : ink,
                }}
              />
              <Bar width="70%" height={2} fill={faint} />
            </Box>
          ))}
        </Box>
      );
  }
}

/** A small drawing of a dashboard card, for choosing which ones show. */
export default function PanelSketch({ kind }: { kind: PanelSketchKind }) {
  return (
    <Box
      sx={{
        aspectRatio: "4 / 3",
        display: "flex",
        flexDirection: "column",
        p: "7px",
        borderRadius: "6px",
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
        textAlign: "left",
      }}
    >
      {sketchBody(kind)}
    </Box>
  );
}
