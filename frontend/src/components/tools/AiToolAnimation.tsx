import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import CheckIcon from "@mui/icons-material/Check";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { prefersReducedMotion } from "../storageAnimations/parts";

// A chat on the left, the Tools page on the right and the MCP link between them. The prompt is typed, the assistant
// reads the tool guide (data flowing to it) and saves the tool (data flowing back), the tool appears in the page's
// empty slot, and its window opens underneath — which is what a tool does that a widget doesn't.
export type ToolSceneKind = "label" | "box" | "tidy";

const TYPE_MS = 22;
const CLEAR_MS = 260;
const GUIDE_MS = 1000;
const SAVE_MS = 1100;
const OPEN_MS = 700;
const HOLD_MS = 3200;

type Phase = "clear" | "typing" | "guide" | "save" | "landed" | "done";
const ORDER: Phase[] = ["clear", "typing", "guide", "save", "landed", "done"];

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

type Props = {
  kind: ToolSceneKind;
  prompt: string;
  /** The tool's name, on its tile, its window and in the assistant's reply. */
  name: string;
  /** Bumped to play the scene again, with the kind and prompt given now. */
  run: number;
  /** After the finished tool has been on show for a while. */
  onFinished?: () => void;
};

/** How asking an assistant for a tool plays out, once per `run`; the finished scene, still, when motion is reduced. */
export default function AiToolAnimation({ kind, prompt, name, run, onFinished }: Props) {
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
  // What's drawn lags what's asked for by the clearing step, so the previous tool fades out first.
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
      next = () => setPlaying("landed");
    } else if (phase === "landed") {
      after = OPEN_MS;
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
  const landed = at("landed");
  const opened = phase === "done";

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
          {tool("tool_guide", "guide")}
          {tool("save_tool", "save")}
          <Box
            sx={{
              fontSize: u(10.5),
              color: "text.primary",
              opacity: landed ? 1 : 0,
              transform: landed ? "none" : `translateY(${u(4)})`,
              transition: motion("opacity 200ms ease-out, transform 200ms ease-out"),
            }}
          >
            {t("tools.editor.saved", { name: shown.name })}
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

      {/* The Tools page: three tools already there, the slot the new one lands in, and its window opening. */}
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
          p: u(10),
          display: "flex",
          flexDirection: "column",
          gap: u(9),
        }}
      >
        <Box sx={{ height: u(5), width: u(48), borderRadius: u(3), bgcolor: muted }} />
        <Box sx={{ display: "flex", gap: u(8) }}>
          {[0, 1, 2].map((index) => (
            <Tile key={index} muted={muted} paper={paper} />
          ))}
          <Box
            sx={{
              position: "relative",
              flex: 1,
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
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: u(4),
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
              <Box sx={{ width: u(14), height: u(14), borderRadius: u(4), bgcolor: alpha(accent, 0.7) }} />
              <Box sx={{ height: u(3.5), width: u(22), borderRadius: u(2), bgcolor: muted }} />
            </Box>
          </Box>
        </Box>

        {/* The window the tool opens in, once it's there. */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            borderRadius: u(7),
            bgcolor: paper,
            border: `${u(1)} solid`,
            borderColor: opened ? alpha(accent, 0.5) : "divider",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transformOrigin: "50% 0%",
            opacity: opened ? 1 : 0,
            transform: opened ? "none" : "scale(0.92)",
            transition: motion(
              opened
                ? "opacity 220ms ease-out, transform 320ms cubic-bezier(0.34, 1.4, 0.64, 1)"
                : "opacity 160ms ease-in, transform 160ms ease-in",
            ),
          }}
        >
          <Box
            sx={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: u(4),
              px: u(7),
              py: u(5),
              borderBottom: `${u(1)} solid`,
              borderColor: "divider",
            }}
          >
            <Box sx={{ width: u(7), height: u(7), borderRadius: u(2), bgcolor: alpha(accent, 0.7) }} />
            <Box sx={{ fontSize: u(8.5), fontWeight: 700, color: "text.primary", flex: 1, minWidth: 0 }}>
              {shown.name}
            </Box>
            <Box sx={{ width: u(6), height: u(6), borderRadius: "50%", bgcolor: muted }} />
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, p: u(8), display: "flex", gap: u(8) }}>
            <ToolBody kind={shown.kind} opened={opened} still={still} />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

/** One of the tools already on the page: an icon and its name. */
function Tile({ muted, paper }: { muted: string; paper: string }) {
  return (
    <Box
      sx={{
        flex: 1,
        borderRadius: u(6),
        bgcolor: paper,
        border: `${u(1)} solid`,
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: u(4),
      }}
    >
      <Box sx={{ width: u(14), height: u(14), borderRadius: u(4), bgcolor: muted }} />
      <Box sx={{ height: u(3.5), width: u(22), borderRadius: u(2), bgcolor: muted, opacity: 0.7 }} />
    </Box>
  );
}

/** What the tool shows in its window: a few settings on the left, and what it makes on the right. */
function ToolBody({ kind, opened, still }: { kind: ToolSceneKind; opened: boolean; still: boolean }) {
  const theme = useTheme();
  const accent = theme.palette.primary.main;
  const muted = theme.palette.action.selected;
  const draw = (delay: number) => (still ? "none" : `all 500ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`);

  return (
    <>
      {/* The settings panel every tool has. */}
      <Box sx={{ width: "38%", display: "flex", flexDirection: "column", gap: u(5) }}>
        {[0, 1, 2].map((index) => (
          <Box key={index} sx={{ display: "flex", flexDirection: "column", gap: u(2.5) }}>
            <Box sx={{ height: u(3), width: u(24 - index * 4), borderRadius: u(2), bgcolor: muted, opacity: 0.7 }} />
            <Box
              sx={{
                height: u(7),
                borderRadius: u(3),
                border: `${u(1)} solid`,
                borderColor: "divider",
                bgcolor: "action.hover",
              }}
            />
          </Box>
        ))}
        <Box sx={{ mt: "auto", height: u(8), borderRadius: u(4), bgcolor: accent, opacity: opened ? 1 : 0.4 }} />
      </Box>

      {/* What it makes. */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          borderRadius: u(4),
          bgcolor: theme.thingport.pageBackground,
          border: `${u(1)} solid`,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: u(6),
        }}
      >
        {kind === "label" && (
          <Box
            sx={{
              position: "relative",
              width: "84%",
              height: u(26),
              borderRadius: u(5),
              bgcolor: alpha(accent, 0.18),
              border: `${u(1.5)} solid`,
              borderColor: accent,
              display: "flex",
              alignItems: "center",
              pl: u(12),
              gap: u(3),
              transformOrigin: "center",
              transform: opened ? "none" : "scale(0.7)",
              opacity: opened ? 1 : 0,
              transition: draw(120),
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: u(5),
                width: u(5),
                height: u(5),
                borderRadius: "50%",
                border: `${u(1.5)} solid`,
                borderColor: accent,
              }}
            />
            <Box sx={{ height: u(4), width: "46%", borderRadius: u(2), bgcolor: accent }} />
            <Box sx={{ height: u(3), width: "26%", borderRadius: u(2), bgcolor: accent, opacity: 0.5 }} />
          </Box>
        )}

        {kind === "box" && (
          <Box sx={{ position: "relative", width: u(52), height: u(44) }}>
            {/* The lid, which lifts off once the tool has drawn it. */}
            <Box
              sx={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: u(10),
                borderRadius: u(2),
                border: `${u(1.5)} solid`,
                borderColor: accent,
                bgcolor: alpha(accent, 0.25),
                transform: opened ? `translateY(${u(-3)})` : `translateY(${u(12)})`,
                opacity: opened ? 1 : 0,
                transition: draw(200),
              }}
            />
            <Box
              sx={{
                position: "absolute",
                left: 0,
                top: u(13),
                width: "100%",
                height: u(31),
                borderRadius: u(2),
                border: `${u(1.5)} solid`,
                borderColor: accent,
                bgcolor: alpha(accent, 0.12),
                transformOrigin: "bottom",
                transform: opened ? "none" : "scaleY(0.2)",
                opacity: opened ? 1 : 0,
                transition: draw(80),
              }}
            />
          </Box>
        )}

        {kind === "tidy" && (
          <Box sx={{ width: "100%", display: "flex", flexDirection: "column", gap: u(5) }}>
            {[0, 1, 2].map((index) => (
              <Box key={index} sx={{ display: "flex", alignItems: "center", gap: u(4) }}>
                <Box sx={{ width: u(10), height: u(8), borderRadius: u(2), bgcolor: muted }} />
                <Box sx={{ height: u(3), flex: 1, borderRadius: u(2), bgcolor: muted, opacity: 0.7 }} />
                <Box
                  sx={{
                    height: u(7),
                    width: u(18),
                    borderRadius: u(4),
                    bgcolor: alpha(accent, 0.2),
                    border: `${u(1)} solid`,
                    borderColor: accent,
                    transform: opened ? "none" : `translateX(${u(10)})`,
                    opacity: opened ? 1 : 0,
                    transition: draw(120 + index * 90),
                  }}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </>
  );
}
