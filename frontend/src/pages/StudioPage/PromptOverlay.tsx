import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { keyframes } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import TuneIcon from "@mui/icons-material/Tune";
import { UnauthorizedError } from "../../api/client";
import {
  studioApi,
  type StudioAiModels,
  type StudioAssistantMessage,
  type StudioAssistantStep,
  type StudioAssistantThread,
} from "../../api/studio";
import { useConfirm } from "../../components/ConfirmProvider";
import HelpTip from "../../components/HelpTip";
import { AiLogo } from "../AiPage/aiLogos";

// Where a person asks Studio's assistant to make or change the design. It works on the server, through the same
// commands as the toolbar (frontend/src/studio/commands.ts), each step landing in the view as it's taken; the page
// follows its run here, and keeps the conversation with the design.

const MINIMIZED_KEY = "thingport_studio_prompt_minimized";
const MODEL_KEY = "thingport_studio_ai_model";
const POLL_MS = 1000;
// What the model list's admin items are, as a Select only knows values.
const ADD_MODEL = "__add_model";
const CHOOSE_MODELS = "__choose_models";

const rise = keyframes`from { opacity: 0; transform: translate(-50%, 10px) scale(0.98); } to { opacity: 1; transform: translate(-50%, 0) scale(1); }`;
const appear = keyframes`from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; }`;
const fadeIn = {
  animation: `${appear} 180ms ease-out`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

type Props = {
  designId: string;
  /** The AIs offered for the assistant; null while loading. */
  assistant: StudioAiModels | null;
  isAdmin: boolean;
  /** What's selected in the view, by feature id, sent along so "round this" has a "this". */
  selected: readonly string[];
  /** A step landed: the design changed on the server. */
  onProgress: () => void;
  onError: (message: string) => void;
  onUnauthorized?: () => void;
};

function StepLine({ step, working }: { step: StudioAssistantStep; working?: boolean }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={fadeIn}>
      {working ? (
        <CircularProgress size={12} sx={{ mt: "3px", flexShrink: 0 }} />
      ) : step.ok ? (
        <CheckCircleOutlineIcon sx={{ fontSize: 14, mt: "2px", color: "success.main", flexShrink: 0 }} />
      ) : (
        <ErrorOutlineIcon sx={{ fontSize: 14, mt: "2px", color: "warning.main", flexShrink: 0 }} />
      )}
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
        {step.summary ?? step.title}
      </Typography>
    </Stack>
  );
}

/** An answer: its text, its steps folded away, and how its run ended if not as it should. */
function Answer({ message }: { message: StudioAssistantMessage }) {
  const { t } = useTranslation("app");
  const [open, setOpen] = useState(false);
  const ending =
    message.outcome === "stopped"
      ? t("studio.prompt.stopped")
      : message.outcome === "limit"
        ? t("studio.prompt.limit", { count: message.steps.length })
        : message.outcome === "failed"
          ? t("studio.prompt.failed", { error: message.error ?? "" })
          : null;
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

export default function PromptOverlay({
  designId,
  assistant,
  isAdmin,
  selected,
  onProgress,
  onError,
  onUnauthorized,
}: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [minimized, setMinimized] = useState(() => stored(MINIMIZED_KEY) === "true");
  const [modelId, setModelId] = useState<string>(() => stored(MODEL_KEY) ?? "");
  const [text, setText] = useState("");
  const [thread, setThread] = useState<StudioAssistantThread | null>(null);
  const [sending, setSending] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const models = assistant?.models ?? null;
  const running = thread?.run?.status === "running";

  const fail = useCallback(
    (error: unknown) => {
      if (error instanceof UnauthorizedError) onUnauthorized?.();
      else onError(error instanceof Error ? error.message : String(error));
    },
    [onError, onUnauthorized],
  );

  // The one chosen before while it's still offered, else the default.
  useEffect(() => {
    if (!models?.length || models.some((model) => model.id === modelId)) return;
    setModelId((models.find((model) => model.is_default) ?? models[0]).id);
  }, [models, modelId]);

  // Another design, another conversation.
  useEffect(() => {
    let active = true;
    setThread(null);
    studioApi.assistant(designId).then(
      (loaded) => active && setThread(loaded),
      (error: unknown) => active && fail(error),
    );
    return () => {
      active = false;
    };
  }, [designId, fail]);

  // While it works: its steps as they land, and the design with them; then its answer.
  const steps = thread?.run?.steps.length ?? 0;
  const seenSteps = useRef(0);
  useEffect(() => {
    if (!running) return;
    seenSteps.current = 0;
    const timer = window.setInterval(() => {
      studioApi.assistant(designId).then(
        (next) => {
          const count = next.run?.steps.length ?? 0;
          if (count !== seenSteps.current || next.run?.status !== "running") onProgress();
          seenSteps.current = count;
          setThread(next);
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, designId, onProgress]);

  // The newest line in view, as an answer or a step comes in.
  const messageCount = thread?.messages.length ?? 0;
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [messageCount, steps]);

  const minimize = (value: boolean) => {
    setMinimized(value);
    store(MINIMIZED_KEY, String(value));
  };

  const send = async () => {
    const prompt = text.trim();
    if (!prompt || running || sending) return;
    setSending(true);
    try {
      const { run } = await studioApi.ask(designId, {
        prompt,
        ai_connection_id: modelId || null,
        selected: [...selected],
      });
      setText("");
      // The prompt shows at once; the server has kept it too.
      setThread((current) => ({
        messages: [
          ...(current?.messages ?? []),
          {
            id: `local-${run.started_at}`,
            role: "user",
            text: prompt,
            steps: [],
            outcome: null,
            error: null,
            model: null,
            created_at: run.started_at,
          },
        ],
        run,
      }));
    } catch (error) {
      fail(error);
    } finally {
      setSending(false);
    }
  };

  const stop = () => {
    studioApi
      .stopAssistant(designId)
      .then(({ run }) => setThread((current) => (current ? { ...current, run } : current)), fail);
  };

  const clear = async () => {
    const ok = await confirm({
      title: t("studio.prompt.clearTitle"),
      message: t("studio.prompt.clearMessage"),
      confirmLabel: t("studio.prompt.clear"),
      destructive: true,
    });
    if (!ok) return;
    studioApi.clearAssistant(designId).then(() => setThread({ messages: [], run: null }), fail);
  };

  const placement = {
    position: "absolute",
    left: "50%",
    bottom: 16,
    transform: "translate(-50%, 0)",
    zIndex: 2,
    animation: `${rise} 200ms ease-out`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  } as const;

  if (minimized) {
    return (
      <Button
        variant="contained"
        color="inherit"
        startIcon={running ? <CircularProgress size={16} /> : <AutoAwesomeOutlinedIcon />}
        onClick={() => minimize(false)}
        aria-label={t("studio.prompt.open")}
        sx={{
          ...placement,
          borderRadius: 999,
          px: 2,
          textTransform: "none",
          bgcolor: "background.paper",
          color: "text.primary",
          border: 1,
          borderColor: "divider",
          boxShadow: 4,
          "&:hover": { bgcolor: "background.paper", boxShadow: 6 },
        }}
      >
        {running ? t("studio.prompt.working") : t("studio.prompt.title")}
      </Button>
    );
  }

  const off = assistant !== null && !assistant.enabled;
  const noModels = assistant !== null && assistant.enabled && !assistant.models.length;
  const usable = Boolean(assistant?.enabled && assistant.models.length);
  const messages = thread?.messages ?? [];
  // The run's steps under the prompt that started it, until its answer comes.
  const live = running ? (thread?.run?.steps ?? []) : [];

  return (
    <Paper
      component="section"
      elevation={6}
      aria-label={t("studio.prompt.title")}
      sx={{
        ...placement,
        width: "min(680px, calc(100% - 32px))",
        borderRadius: 3,
        border: 1,
        borderColor: "divider",
        px: 1.5,
        pt: 1,
        pb: 1.25,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <AutoAwesomeOutlinedIcon sx={{ fontSize: 18, color: "primary.main" }} />
        <Typography variant="subtitle2">{t("studio.prompt.title")}</Typography>
        <HelpTip text={t("studio.prompt.help")} />
        <Box sx={{ flex: 1 }} />
        {usable && (
          <Select
            size="small"
            variant="standard"
            disableUnderline
            value={models?.some((model) => model.id === modelId) ? modelId : ""}
            displayEmpty
            disabled={running}
            onChange={(event) => {
              const value = event.target.value;
              if (value === ADD_MODEL) return navigate("/admin-ai?add=model");
              if (value === CHOOSE_MODELS) return navigate("/admin-ai?feature=studio");
              setModelId(value);
              store(MODEL_KEY, value);
            }}
            inputProps={{ "aria-label": t("studio.prompt.model") }}
            renderValue={(id) => {
              const model = models?.find((each) => each.id === id);
              return model ? (
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <AiLogo model={model.model} baseUrl={`http://${model.host}`} size={16} />
                  <Typography variant="body2" noWrap sx={{ maxWidth: 200 }}>
                    {model.model}
                  </Typography>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t("studio.prompt.model")}
                </Typography>
              );
            }}
            sx={{ fontSize: "0.85rem" }}
          >
            {models?.map((model) => (
              <MenuItem key={model.id} value={model.id}>
                <ListItemIcon sx={{ minWidth: 30 }}>
                  <AiLogo model={model.model} baseUrl={`http://${model.host}`} size={20} />
                </ListItemIcon>
                <ListItemText primary={model.model} secondary={model.host} />
              </MenuItem>
            ))}
            {isAdmin && <Divider />}
            {isAdmin && (
              <MenuItem value={ADD_MODEL}>
                <ListItemIcon sx={{ minWidth: 30 }}>
                  <AddIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={t("studio.prompt.addModel")} />
              </MenuItem>
            )}
            {isAdmin && (
              <MenuItem value={CHOOSE_MODELS}>
                <ListItemIcon sx={{ minWidth: 30 }}>
                  <TuneIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={t("studio.prompt.chooseModels")} />
              </MenuItem>
            )}
          </Select>
        )}
        {messages.length > 0 && !running && (
          <Tooltip title={t("studio.prompt.clear")}>
            <IconButton size="small" aria-label={t("studio.prompt.clear")} onClick={() => void clear()}>
              <DeleteSweepOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t("studio.prompt.minimize")}>
          <IconButton size="small" aria-label={t("studio.prompt.minimize")} onClick={() => minimize(true)}>
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {(messages.length > 0 || running) && (
        <Stack
          spacing={1.25}
          role="log"
          aria-live="polite"
          sx={{ mt: 1, maxHeight: "min(40vh, 320px)", overflowY: "auto", pr: 0.5 }}
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
          <div ref={threadEnd} />
        </Stack>
      )}

      {off || noModels ? (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1, minHeight: 36 }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {off ? t("studio.prompt.off") : t("studio.prompt.noModels")}
          </Typography>
          {isAdmin && (
            <Button
              size="small"
              onClick={() => navigate("/admin-ai?feature=studio")}
              sx={{ textTransform: "none", flexShrink: 0 }}
            >
              {off ? t("studio.prompt.turnOn") : t("studio.prompt.chooseModels")}
            </Button>
          )}
        </Stack>
      ) : (
        <Stack
          direction="row"
          alignItems="flex-end"
          spacing={1}
          sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 2, pl: 1.5, pr: 0.5, py: 0.5 }}
        >
          <InputBase
            multiline
            maxRows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter starts a new line; not while an input method is composing.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={t("studio.prompt.placeholder")}
            disabled={!usable}
            inputProps={{ "aria-label": t("studio.prompt.placeholder") }}
            sx={{ flex: 1, fontSize: "0.9rem", py: 0.5 }}
          />
          {running ? (
            <Tooltip title={t("studio.prompt.stop")}>
              <IconButton size="small" color="primary" aria-label={t("studio.prompt.stop")} onClick={stop}>
                <StopRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title={t("studio.prompt.send")}>
              <span>
                <IconButton
                  size="small"
                  color="primary"
                  aria-label={t("studio.prompt.send")}
                  disabled={!usable || !text.trim() || sending}
                  onClick={() => void send()}
                >
                  {sending ? <CircularProgress size={16} /> : <SendRoundedIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
      )}
    </Paper>
  );
}
