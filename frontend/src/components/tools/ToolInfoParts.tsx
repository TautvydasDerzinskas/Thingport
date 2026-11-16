import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { keyframes, type Theme } from "@mui/material/styles";
import AddIcon from "@mui/icons-material/Add";
import { toolsApi, type SharedInfo, type Tool, type ToolModelInfo } from "../../api/tools";
import { UnauthorizedError } from "../../api/client";
import { matchLanguage } from "../../constants/languages";
import { useTools } from "../../hooks/useTools";
import { translator } from "../../sdk/labels";
import UserAvatar from "../UserAvatar";
import type { OfferedCommand } from "./toolCommands";
import { onToolInfoChange } from "./toolInfoEvents";

type Props = {
  printId: string;
  /** The commands offered for the model, from which each part's own command is taken. */
  commands: OfferedCommand[];
  onCommand: (offered: OfferedCommand) => void;
  onOpenTool: (tool: Tool) => void;
  onUnauthorized?: () => void;
};

const toneColor = (tone: SharedInfo["tone"]) => (theme: Theme) =>
  ({
    waiting: theme.palette.info.main,
    active: theme.palette.warning.main,
    done: theme.palette.primary.main,
    failed: theme.palette.error.main,
    neutral: theme.palette.text.secondary,
  })[tone];

const chipSx = {
  display: "inline-flex",
  alignItems: "center",
  gap: 0.75,
  border: "1px solid",
  borderColor: "divider",
  borderRadius: 4,
  py: 0.25,
  pl: 0.375,
  pr: 1.25,
  maxWidth: "100%",
  transition: (theme: Theme) => theme.transitions.create(["background-color", "border-color"], { duration: 150 }),
  "&:hover": { bgcolor: "action.hover" },
  "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
} as const;

// A chip arriving: a person's note, or the first read of them.
const chipIn = keyframes`from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; }`;

/** "14:20" today, else "12 Nov", in the reader's language. */
function when(date: string | undefined, language: string): string | null {
  if (!date) return null;
  const at = new Date(date);
  if (Number.isNaN(at.getTime())) return null;
  const today = at.toDateString() === new Date().toDateString();
  return today
    ? at.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleDateString(language, { day: "numeric", month: "short" });
}

/**
 * The parts of a model's page the installed tools ask for (`modelInfo` in their metadata): one chip per person, from
 * their latest shared entry about the model or any copy of it, and the tool's own command as a chip of its own.
 * Nothing is drawn or asked for when no tool has such a part.
 */
export default function ToolInfoParts({ printId, commands, onCommand, onOpenTool, onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const language = matchLanguage(i18n.language);
  const tools = useTools();
  const parts = useMemo(
    () =>
      tools?.access.canUse
        ? tools.tools.flatMap((tool) => (tool.manifest.modelInfo ? [{ tool, part: tool.manifest.modelInfo }] : []))
        : [],
    [tools],
  );
  const [info, setInfo] = useState<ToolModelInfo | null>(null);
  const hasParts = parts.length > 0;
  // Which tools have a part, so installing another one reads the notes again with its own in them.
  const partTools = parts.map(({ tool }) => tool.id).join(",");
  // Read through a ref, so a new callback each render doesn't read the notes again.
  const unauthorized = useRef(onUnauthorized);
  useEffect(() => {
    unauthorized.current = onUnauthorized;
  });

  useEffect(() => {
    if (!partTools) return;
    let active = true;
    // Only the latest read lands, so an older answer arriving late can't put back what a newer one replaced.
    let latest = 0;
    const load = () => {
      const asked = ++latest;
      const current = () => active && asked === latest;
      return toolsApi.modelInfo(printId).then(
        (answer) => {
          if (current()) setInfo(answer);
        },
        (err) => {
          if (!current()) return;
          if (err instanceof UnauthorizedError) unauthorized.current?.();
          // A failed read leaves the part with its command only, rather than breaking the page.
          setInfo({ tools: [] });
        },
      );
    };
    setInfo(null);
    void load();
    const stop = onToolInfoChange(() => void load());
    return () => {
      active = false;
      stop();
    };
  }, [printId, partTools]);

  if (!hasParts) return null;

  return (
    <>
      {parts.map(({ tool, part }) => {
        const say = translator(tool.locales ?? {}, language);
        const titleKey = "modelInfo.title";
        const title = say(titleKey) === titleKey ? part.title : say(titleKey);
        const command = commands.find((offered) => offered.tool.id === tool.id && offered.command.id === part.command);
        const entries = info?.tools.find((entry) => entry.tool_id === tool.id)?.entries ?? [];
        if (info && !entries.length && !command) return null;
        return (
          <Box key={tool.id}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
              {title}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {info === null && <Skeleton variant="rounded" width={96} height={26} sx={{ borderRadius: 4 }} />}
              {entries.map((entry, index) => {
                const name = entry.mine ? t("tools.info.you") : (entry.user?.display_name ?? t("tools.info.someone"));
                const label = say(entry.info.label);
                const date = when(entry.info.date ?? entry.updated_at, language);
                const tip = [name, label, date].filter(Boolean).join(" · ");
                return (
                  <Tooltip key={entry.user?.id ?? index} title={tip}>
                    <ButtonBase
                      onClick={() => onOpenTool(tool)}
                      aria-label={tip}
                      sx={{
                        ...chipSx,
                        animation: `${chipIn} 180ms ease-out`,
                        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                      }}
                    >
                      {entry.user && <UserAvatar user={entry.user} size={20} />}
                      <Typography variant="body2" component="span" noWrap color="text.secondary">
                        {name}
                      </Typography>
                      <Box
                        component="span"
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          flexShrink: 0,
                          bgcolor: toneColor(entry.info.tone),
                        }}
                      />
                      <Typography
                        variant="body2"
                        component="span"
                        noWrap
                        sx={{ color: (theme) => theme.thingport.headingText }}
                      >
                        {label}
                      </Typography>
                    </ButtonBase>
                  </Tooltip>
                );
              })}
              {command && (
                <Tooltip title={command.label}>
                  <ButtonBase
                    onClick={() => onCommand(command)}
                    aria-label={command.label}
                    sx={{ ...chipSx, pl: 0.75, borderStyle: "dashed", color: "text.secondary" }}
                  >
                    <AddIcon sx={{ fontSize: 16 }} />
                    <Typography variant="body2" component="span" noWrap>
                      {command.label}
                    </Typography>
                  </ButtonBase>
                </Tooltip>
              )}
            </Box>
          </Box>
        );
      })}
    </>
  );
}
