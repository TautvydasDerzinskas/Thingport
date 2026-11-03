import { useEffect, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { StudioAssistantMessage, StudioAssistantStep } from "../../api/studio";
import PictureThumb from "./PictureThumb";
import type { StudioAssistant } from "./useStudioAssistant";

// What the assistant and the person said about a design, and the steps it took: in the bar's conversation, opened from
// it, or in the panel beside the view.

const appear = keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; }`;
export const fadeIn = {
  animation: `${appear} 180ms ease-out`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

/** `oneLine` keeps a long step to a line, cut short, where the bar has room for one. */
export function StepLine({
  step,
  working,
  oneLine,
}: {
  step: StudioAssistantStep;
  working?: boolean;
  oneLine?: boolean;
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={fadeIn}>
      {working ? (
        <CircularProgress size={12} sx={{ mt: "3px", flexShrink: 0 }} />
      ) : step.ok ? (
        <CheckCircleOutlineIcon sx={{ fontSize: 14, mt: "2px", color: "success.main", flexShrink: 0 }} />
      ) : (
        <ErrorOutlineIcon sx={{ fontSize: 14, mt: "2px", color: "warning.main", flexShrink: 0 }} />
      )}
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap={oneLine}
        sx={{ minWidth: 0, overflowWrap: oneLine ? undefined : "anywhere" }}
      >
        {step.summary ?? step.title}
      </Typography>
    </Stack>
  );
}

/** How a run ended, when it didn't end as it should. */
export function endingOf(t: TFunction, message: StudioAssistantMessage): string | null {
  return message.outcome === "stopped"
    ? t("studio.prompt.stopped")
    : message.outcome === "limit"
      ? t("studio.prompt.limit", { count: message.steps.length })
      : message.outcome === "failed"
        ? t("studio.prompt.failed", { error: message.error ?? "" })
        : null;
}

/** An answer: its text, its steps folded away, and how its run ended if not as it should. */
function Answer({ message }: { message: StudioAssistantMessage }) {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState(false);
  const ending = endingOf(t, message);
  return (
    <Box sx={fadeIn}>
      {message.text && (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {message.text}
        </Typography>
      )}
      {ending && (
        <Typography variant="caption" sx={{ display: "block", color: "warning.main", mt: 0.25 }}>
          {ending}
        </Typography>
      )}
      {message.steps.length > 0 && (
        <>
          <Button
            size="small"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  transform: open ? "rotate(180deg)" : "none",
                  transition: "transform 150ms",
                  "@media (prefers-reduced-motion: reduce)": { transition: "none" },
                }}
              />
            }
            sx={{ textTransform: "none", px: 0.5, minWidth: 0, color: "text.secondary", fontSize: "0.75rem" }}
          >
            {t("studio.prompt.steps", { count: message.steps.length })}
          </Button>
          {open && (
            <Stack spacing={0.25} sx={{ pl: 0.5 }}>
              {message.steps.map((step, index) => (
                // Steps have no id of their own, and never move.
                // oxlint-disable-next-line react/no-array-index-key
                <StepLine key={index} step={step} />
              ))}
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}

/** The conversation, the newest line kept in view as an answer or a step comes in. */
export function AssistantConversation({ assistant, maxHeight }: { assistant: StudioAssistant; maxHeight?: string }) {
  const { t } = useTranslation("app");
  const end = useRef<HTMLDivElement>(null);
  const { messages, running } = assistant;
  // The run's steps under the prompt that started it, until its answer comes.
  const live = running ? (assistant.thread?.run?.steps ?? []) : [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [messages.length, live.length]);
  return (
    <Stack
      spacing={1.25}
      role="log"
      aria-live="polite"
      sx={{ maxHeight, overflowY: "auto", pr: 0.5, ...(maxHeight ? {} : { flex: 1, minHeight: 0 }) }}
    >
      {messages.map((message) =>
        message.role === "user" ? (
          <Box
            key={message.id}
            sx={{
              ...fadeIn,
              alignSelf: "flex-end",
              maxWidth: "85%",
              bgcolor: "action.selected",
              borderRadius: 2,
              px: 1.25,
              py: 0.75,
            }}
          >
            {message.pictures.length > 0 && assistant.designId && (
              <Stack direction="row" spacing={0.5} sx={{ mb: 0.75, flexWrap: "wrap" }}>
                {message.pictures.map((picture, index) => (
                  <PictureThumb
                    key={picture.id}
                    source={{ designId: assistant.designId!, pictureId: picture.id }}
                    size={56}
                    alt={t("studio.prompt.picture", { number: index + 1 })}
                  />
                ))}
              </Stack>
            )}
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {message.text}
            </Typography>
          </Box>
        ) : (
          <Answer key={message.id} message={message} />
        ),
      )}
      {running && (
        <Stack spacing={0.25}>
          {live.map((step, index) => (
            // oxlint-disable-next-line react/no-array-index-key
            <StepLine key={index} step={step} />
          ))}
          <StepLine step={{ tool: "", title: t("studio.prompt.working"), summary: null, ok: true }} working />
        </Stack>
      )}
      <div ref={end} />
    </Stack>
  );
}

/** The conversation beside the view, for the side panel layout: the bar under the view keeps only the prompt. */
export function AssistantPanel({ assistant }: { assistant: StudioAssistant }) {
  const { t } = useTranslation("app");
  return (
    <Stack sx={{ flex: 1, minHeight: 0, p: 1.5, pr: 1 }} component="section" aria-label={t("studio.prompt.title")}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, minHeight: 30 }}>
        <AutoAwesomeOutlinedIcon sx={{ fontSize: 18, color: "primary.main" }} />
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {t("studio.prompt.title")}
        </Typography>
        {assistant.messages.length > 0 && !assistant.running && (
          <Tooltip title={t("studio.prompt.clear")}>
            <IconButton size="small" aria-label={t("studio.prompt.clear")} onClick={() => void assistant.clear()}>
              <DeleteSweepOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <AssistantConversation assistant={assistant} />
    </Stack>
  );
}
