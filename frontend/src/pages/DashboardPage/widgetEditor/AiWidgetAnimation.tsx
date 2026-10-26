import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { prefersReducedMotion } from "../../../components/storageAnimations/parts";

// A chat on the left, a dashboard on the right and the MCP link between them. The prompt is typed, the assistant
// reads the widget guide (data flowing to it) and saves the widget (data flowing back), and the widget appears in
// the dashboard's empty slot.
export type SceneKind = "printer" | "filament" | "library";

const TYPE_MS = 22;
const CLEAR_MS = 260;
const GUIDE_MS = 1000;
const SAVE_MS = 1100;
const HOLD_MS = 3400;

type Phase = "clear" | "typing" | "guide" | "save" | "done";

// Drawn on a 560-wide stage and sized in container units, so the scene scales with whatever width it gets.
const u = (px: number) => `${(px / 5.6).toFixed(3)}cqw`;

const blink = keyframes`
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
`;
const spin = keyframes`
  to { transform: rotate(360deg); }
`;
const flow = keyframes`
  0% { transform: translateX(0); opacity: 0; }
  20%, 80% { opacity: 1; }
  100% { transform: translateX(var(--span)); opacity: 0; }
`;
const ring = keyframes`
  0% { transform: scale(1); opacity: 0.7; }
  100% { transform: scale(1.18); opacity: 0; }
`;

const FILAMENT = [0.8, 0.55, 0.14, 0.7];
const LIBRARY = [0.3, 0.45, 0.38, 0.6, 0.74, 0.92];

type Props = {
  kind: SceneKind;
  prompt: string;
  /** The widget's name, on its panel and in the assistant's reply. */
  name: string;
  /** Bumped to play the scene again, with the kind and prompt given now. */
  run: number;
  /** After the finished widget has been on show for a while. */
  onFinished?: () => void;
};

/** How asking an assistant for a widget plays out, once per `run`; the finished scene, still, when motion is reduced. */
export default function AiWidgetAnimation({ kind, prompt, name, run, onFinished }: Props) {
  const { t } = useTranslation("app");
  const theme = useTheme();
  const still = prefersReducedMotion();
  const [playing, setPlaying] = useState<Phase>("clear");
  const [playedRun, setPlayedRun] = useState(run);
  if (run !== playedRun) {
    setPlayedRun(run);
    setPlaying("clear");
  }
  const [typing, setTyped] = useState(0);
  // What's drawn lags what's asked for by the clearing step, so the previous widget fades out first.
  const [drawn, setShown] = useState({ kind, prompt, name });
  const latest = useRef({ kind, prompt, name, onFinished });
  useEffect(() => {
    latest.current = { kind, prompt, name, onFinished };
  });
  // With motion reduced, the finished scene for whatever is asked for now.
  const phase = still ? "done" : playing;
  const shown = still ? { kind, prompt, name } : drawn;
  const typed = still ? prompt.length : typing;

  useEffect(() => {
    if (still) return;
    let after: number;
    let next: () => void;
    if (phase === "clear") {
      after = CLEAR_MS;
      next = () => {
        const { kind: nextKind, prompt: nextPrompt, name: nextName } = latest.current;
        setShown({ kind: nextKind, prompt: nextPrompt, name: nextName });
        setTyped(0);
        setPlaying("typing");
      };
    } else if (phase === "typing") {
      const done = typed >= shown.prompt.length;
      after = done ? 300 : TYPE_MS;
      next = done ? () => setPlaying("guide") : () => setTyped((count) => count + 1);
    } else if (phase === "guide") {
      after = GUIDE_MS;
      next = () => setPlaying("save");
    } else if (phase === "save") {
      after = SAVE_MS;
      next = () => setPlaying("done");
    } else {
      after = HOLD_MS;
      next = () => latest.current.onFinished?.();
    }
    const timer = window.setTimeout(next, after);
    return () => window.clearTimeout(timer);
  }, [phase, typed, shown.prompt.length, still]);

  const accent = theme.palette.primary.main;
  const muted = theme.palette.action.selected;
  const paper = theme.palette.background.paper;
  const motion = (value: string) => (still ? "none" : value);
  const at = (from: Phase) => ORDER.indexOf(phase) >= ORDER.indexOf(from);
  const landed = phase === "done";

  const tool = (label: string, from: Phase) => {
    const busy = phase === from;
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: u(5),
          px: u(7),
          py: u(3),
          borderRadius: u(6),
          border: `${u(1)} solid`,
          borderColor: "divider",
          bgcolor: "action.hover",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: u(9.5),
          color: "text.secondary",
          opacity: at(from) ? 1 : 0,
          transform: at(from) ? "none" : `translateY(${u(4)})`,
          transition: motion("opacity 200ms ease-out, transform 200ms ease-out"),
        }}
      >
        {busy ? (
          <Box
            sx={{
              width: u(9),
              height: u(9),
              borderRadius: "50%",
              border: `${u(1.5)} solid`,
              borderColor: alpha(accent, 0.25),
              borderTopColor: accent,
              animation: motion(`${spin} 700ms linear infinite`),
            }}
          />
        ) : (
          <CheckIcon sx={{ fontSize: u(11), color: accent }} />
        )}
        {label}
      </Box>
    );
  };

  // Packets on the link: towards the assistant while it reads the guide, back to Thingport while it saves.
  const toThingport = phase === "save";
  const flowing = phase === "guide" || phase === "save";

  return (
    <Box
      aria-hidden
      sx={{
        position: "relative",
        width: "100%",
        aspectRatio: "560 / 236",
        containerType: "inline-size",
        overflow: "hidden",
        borderRadius: "12px",
        border: 1,
        borderColor: "divider",
        bgcolor: "action.hover",
        fontFamily: theme.typography.fontFamily,
      }}
    >
      {/* The chat. */}
      <Box
        sx={{
          position: "absolute",
          left: u(16),
          top: u(18),
          width: u(236),
          height: u(200),
          borderRadius: u(10),
          bgcolor: paper,
          border: `${u(1)} solid`,
          borderColor: "divider",
          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: u(8),
          p: u(10),
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: u(5), color: "text.secondary" }}>
          <SmartToyOutlinedIcon sx={{ fontSize: u(13), color: accent }} />
          <Box sx={{ height: u(5), width: u(54), borderRadius: u(3), bgcolor: muted }} />
        </Box>
        <Box
          sx={{
            alignSelf: "flex-end",
            maxWidth: u(196),
            minHeight: u(20),
            px: u(9),
            py: u(6),
            borderRadius: `${u(10)} ${u(10)} ${u(3)} ${u(10)}`,
            bgcolor: accent,
            color: theme.palette.primary.contrastText,
            fontSize: u(10.5),
            lineHeight: 1.4,
            opacity: phase === "clear" ? 0 : 1,
            transition: motion("opacity 200ms ease-out"),
          }}
        >
          {shown.prompt.slice(0, typed)}
          {phase === "typing" && (
            <Box
              component="span"
              sx={{
                display: "inline-block",
                width: u(1.5),
                height: u(11),
                ml: u(1),
                verticalAlign: "text-bottom",
                bgcolor: "currentColor",
                animation: motion(`${blink} 800ms steps(1) infinite`),
              }}
            />
          )}
        </Box>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: u(5) }}>
          {tool("widget_guide", "guide")}
          {tool("save_widget", "save")}
          <Box
            sx={{
              fontSize: u(10.5),
              color: "text.primary",
              opacity: landed ? 1 : 0,
              transform: landed ? "none" : `translateY(${u(4)})`,
              transition: motion("opacity 200ms ease-out, transform 200ms ease-out"),
            }}
          >
            {t("dashboard.custom.saved", { name: shown.name })}
          </Box>
        </Box>
      </Box>

      {/* The MCP link. */}
      <Box
        sx={{
          position: "absolute",
          left: u(258),
          top: u(104),
          width: u(44),
          textAlign: "center",
          fontSize: u(8.5),
          fontWeight: 700,
          letterSpacing: "0.06em",
          color: flowing ? accent : "text.disabled",
          transition: motion("color 200ms"),
        }}
      >
        MCP
      </Box>
      <Box
        sx={{
          position: "absolute",
          left: u(258),
          top: u(118),
          width: u(44),
          height: 0,
          borderTop: `${u(2)} solid`,
          borderColor: flowing ? alpha(accent, 0.35) : "divider",
          transition: motion("border-color 200ms"),
        }}
      />
      {flowing &&
        !still &&
        [0, 1, 2].map((index) => (
          <Box
            key={`${phase}-${index}`}
            sx={{
              position: "absolute",
              left: toThingport ? u(258) : u(296),
              top: u(116),
              width: u(6),
              height: u(6),
              borderRadius: "50%",
              bgcolor: accent,
              "--span": toThingport ? u(38) : u(-38),
              animation: `${flow} 600ms ease-in-out ${index * 200}ms infinite both`,
            }}
          />
        ))}

      {/* The dashboard: three panels already there and the slot the new widget lands in. */}
      <Box
        sx={{
          position: "absolute",
          left: u(308),
          top: u(18),
          width: u(236),
          height: u(200),
          borderRadius: u(10),
          bgcolor: theme.thingport.pageBackground,
          border: `${u(1)} solid`,
          borderColor: "divider",
          p: u(8),
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: `${u(10)} 1fr 1fr`,
          gap: u(7),
        }}
      >
        <Box sx={{ gridColumn: "1 / -1", width: u(60), borderRadius: u(3), bgcolor: muted }} />
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              borderRadius: u(6),
              bgcolor: paper,
              border: `${u(1)} solid`,
              borderColor: "divider",
              p: u(7),
              display: "flex",
              flexDirection: "column",
              gap: u(5),
            }}
          >
            <Box sx={{ height: u(5), width: u(34 + index * 6), borderRadius: u(3), bgcolor: muted }} />
            <Box sx={{ height: u(4), width: "80%", borderRadius: u(3), bgcolor: muted, opacity: 0.6 }} />
            <Box sx={{ height: u(4), width: "60%", borderRadius: u(3), bgcolor: muted, opacity: 0.6 }} />
          </Box>
        ))}
        <Box
          sx={{
            position: "relative",
            borderRadius: u(6),
            border: `${u(1.5)} dashed`,
            borderColor: landed ? "transparent" : "divider",
            transition: motion("border-color 200ms"),
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: u(-1.5),
              borderRadius: u(6),
              bgcolor: paper,
              border: `${u(1)} solid`,
              borderColor: alpha(accent, 0.6),
              p: u(7),
              display: "flex",
              flexDirection: "column",
              gap: u(5),
              opacity: landed ? 1 : 0,
              transform: landed ? "none" : "scale(0.6)",
              transition: motion(
                landed
                  ? "opacity 220ms ease-out, transform 380ms cubic-bezier(0.34, 1.56, 0.64, 1)"
                  : "opacity 200ms ease-in, transform 200ms ease-in",
              ),
              "&::after": {
                content: '""',
                position: "absolute",
                inset: 0,
                borderRadius: "inherit",
                border: `${u(2)} solid`,
                borderColor: accent,
                opacity: 0,
                animation: landed && !still ? `${ring} 700ms ease-out 200ms 2` : "none",
              },
            }}
          >
            <Box sx={{ fontSize: u(8.5), fontWeight: 700, color: "text.primary", lineHeight: 1.2 }}>{shown.name}</Box>
            <WidgetBody kind={shown.kind} landed={landed} still={still} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

const ORDER: Phase[] = ["clear", "typing", "guide", "save", "done"];

/** What the new widget shows, drawn in once it lands. */
function WidgetBody({ kind, landed, still }: { kind: SceneKind; landed: boolean; still: boolean }) {
  const theme = useTheme();
  const accent = theme.palette.primary.main;
  const grow = (delay: number) => (still ? "none" : `transform 600ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`);

  if (kind === "printer")
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: u(5) }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: u(4) }}>
          <PrintOutlinedIcon sx={{ fontSize: u(14), color: accent }} />
          <Box sx={{ fontSize: u(12), fontWeight: 700, color: "text.primary" }}>68%</Box>
        </Box>
        <Box sx={{ height: u(5), borderRadius: u(3), bgcolor: "action.selected", overflow: "hidden" }}>
          <Box
            sx={{
              height: "100%",
              bgcolor: accent,
              transformOrigin: "left",
              transform: landed ? "scaleX(0.68)" : "scaleX(0)",
              transition: grow(250),
            }}
          />
        </Box>
      </Box>
    );

  const bars = kind === "filament" ? FILAMENT : LIBRARY;
  return (
    <Box sx={{ flex: 1, display: "flex", alignItems: "flex-end", gap: u(kind === "filament" ? 6 : 4) }}>
      {bars.map((height, index) => {
        const low = kind === "filament" && height < 0.2;
        return (
          <Box
            key={height}
            sx={{
              flex: 1,
              height: "100%",
              borderRadius: `${u(2)} ${u(2)} 0 0`,
              bgcolor: low ? theme.palette.error.main : alpha(accent, kind === "library" ? 0.45 + height * 0.55 : 1),
              transformOrigin: "bottom",
              transform: landed ? `scaleY(${height})` : "scaleY(0)",
              transition: grow(200 + index * 70),
            }}
          />
        );
      })}
    </Box>
  );
}
