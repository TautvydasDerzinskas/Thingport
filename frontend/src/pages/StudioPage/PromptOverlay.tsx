import { useEffect, useRef, useState, type Ref } from "react";
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
import AddPhotoAlternateOutlinedIcon from "@mui/icons-material/AddPhotoAlternateOutlined";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import DeleteSweepOutlinedIcon from "@mui/icons-material/DeleteSweepOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import TuneIcon from "@mui/icons-material/Tune";
import type { StudioPromptLayout } from "../../api/settings";
import { studioApi, type StudioPicture } from "../../api/studio";
import { newLocalId } from "../../utils/localId";
import HelpTip from "../../components/HelpTip";
import { AiLogo } from "../AiPage/aiLogos";
import { AssistantConversation, endingOf, fadeIn, StepLine } from "./AssistantThread";
import PictureThumb from "./PictureThumb";
import type { StudioAssistant } from "./useStudioAssistant";

// Where a person asks Studio's assistant to make or change the design. It works on the server, through the same
// commands as the toolbar (frontend/src/studio/commands.ts), each step landing in the view as it's taken; the page
// follows its run here, and keeps the conversation with the design.
//
// The bar stays small so the model can be watched as it changes: while the AI works, one line says the step it's on,
// and then its answer; the conversation opens only when asked for, or, in the side panel layout, shows beside the view.

// What the model list's admin items are, as a Select only knows values.
const ADD_MODEL = "__add_model";
const CHOOSE_MODELS = "__choose_models";
// The bar's distance from the bottom of the view.
const MARGIN = 16;
// Pictures one prompt may carry, as the server takes them.
const MAX_PICTURES = 4;

/** A picture added to the prompt: shown from the file at once, sent by its id once the design has kept it. */
type Attachment = { key: string; url: string; picture: StudioPicture | null };

const rise = keyframes`from { opacity: 0; transform: translate(-50%, 10px) scale(0.98); } to { opacity: 1; transform: translate(-50%, 0) scale(1); }`;

type Props = {
  assistant: StudioAssistant;
  isAdmin: boolean;
  layout: StudioPromptLayout;
  /** How much of the bottom of the view the bar covers, in px: the view keeps the model above it. */
  onInset: (px: number) => void;
};

/** The step the run is on, or how the last one ended: one line in place of the conversation. */
function Status({ assistant, onOpen }: { assistant: StudioAssistant; onOpen: () => void }) {
  const { t } = useTranslation("app");
  const { messages, running } = assistant;
  const steps = assistant.thread?.run?.steps ?? [];
  const last = messages.at(-1);
  const answer = !running && last?.role === "assistant" ? last : null;
  const ending = answer ? endingOf(t, answer) : null;
  if (running) {
    const step = steps.at(-1);
    return (
      <Box component="output" aria-live="polite" sx={{ display: "block", mt: 1, px: 0.25 }}>
        {/* Keyed by the step, so each new one fades in over the last. */}
        <Box key={steps.length}>
          <StepLine
            working
            oneLine
            step={{
              tool: "",
              title: step
                ? t("studio.prompt.live", { number: steps.length, step: step.summary ?? step.title })
                : t("studio.prompt.working"),
              summary: null,
              ok: true,
            }}
          />
        </Box>
      </Box>
    );
  }
  if (!answer || (!answer.text && !ending)) return null;
  // The answer is what the button says; what it does is in its tooltip.
  return (
    <Tooltip title={t("studio.prompt.showConversation")} placement="top" describeChild>
      <Box
        component="button"
        type="button"
        onClick={onOpen}
        sx={{
          ...fadeIn,
          display: "block",
          width: "100%",
          mt: 1,
          p: 0.25,
          border: 0,
          borderRadius: 1,
          background: "none",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineStyle: "solid" },
        }}
      >
        {answer.text && (
          <Typography
            variant="body2"
            sx={{
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {answer.text}
          </Typography>
        )}
        {ending && (
          <Typography variant="caption" sx={{ display: "block", color: "warning.main" }} noWrap>
            {ending}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
}

export default function PromptOverlay({ assistant, isAdmin, layout, onInset }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [text, setText] = useState("");
  // The conversation, opened from the bar; it folds away again as a new run starts, so the model can be watched.
  const [expanded, setExpanded] = useState(false);
  const { offered, models, modelId, messages, running, sending, minimized } = assistant;
  const panel = layout === "panel";
  const open = expanded && !panel;
  const vision = Boolean(models?.find((each) => each.id === modelId)?.vision);

  // Pictures, for an AI that sees them: picked, pasted or dropped, kept with the design as soon as they're added.
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const shown = useRef<Attachment[]>([]);
  useEffect(() => {
    shown.current = attached;
  }, [attached]);
  const letGo = (keep: (each: Attachment) => boolean) =>
    setAttached((list) => {
      for (const each of list) if (!keep(each)) URL.revokeObjectURL(each.url);
      return list.filter(keep);
    });
  // Another design's prompt starts with none; the files' addresses go with the page.
  const designId = assistant.designId;
  useEffect(() => {
    if (designId !== undefined) letGo(() => false);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [designId]);
  useEffect(() => () => shown.current.forEach((each) => URL.revokeObjectURL(each.url)), []);
  const attach = (files: ArrayLike<File>) => {
    if (!designId || !vision) return;
    const room = MAX_PICTURES - shown.current.length;
    for (const file of Array.from(files)
      .filter((each) => each.type.startsWith("image/"))
      .slice(0, Math.max(0, room))) {
      const key = newLocalId();
      const added = { key, url: URL.createObjectURL(file), picture: null };
      shown.current = [...shown.current, added];
      setAttached((list) => [...list, added]);
      studioApi.addPicture(designId, file).then(
        (picture) => setAttached((list) => list.map((each) => (each.key === key ? { ...each, picture } : each))),
        (error: unknown) => {
          letGo((each) => each.key !== key);
          assistant.fail(error);
        },
      );
    }
  };
  const uploading = attached.some((each) => !each.picture);
  // A picture the AI chosen now can't see: the person decides, rather than it quietly being left out.
  const blocked = attached.length > 0 && !vision;

  // How much of the view the bar takes, kept up as it changes; not while the conversation is open over the view, which
  // the person asked for.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element || open) return;
    const report = () => onInset(element.offsetHeight + MARGIN);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
    // The bar and the minimized button are different elements.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [open, minimized, onInset]);
  useEffect(() => () => onInset(0), [onInset]);

  const send = async () => {
    const prompt = text.trim();
    if (uploading || blocked) return;
    setExpanded(false);
    if (
      await assistant.send(
        prompt,
        attached.flatMap((each) => (each.picture ? [each.picture] : [])),
      )
    ) {
      setText("");
      letGo(() => false);
    }
  };

  const placement = {
    position: "absolute",
    left: "50%",
    bottom: MARGIN,
    transform: "translate(-50%, 0)",
    zIndex: 2,
    animation: `${rise} 200ms ease-out`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  } as const;

  if (minimized) {
    return (
      <Button
        ref={bar as Ref<HTMLButtonElement>}
        variant="contained"
        color="inherit"
        startIcon={running ? <CircularProgress size={16} /> : <AutoAwesomeOutlinedIcon />}
        onClick={() => assistant.minimize(false)}
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

  const off = offered !== null && !offered.enabled;
  const noModels = offered !== null && offered.enabled && !offered.models.length;
  const usable = Boolean(offered?.enabled && offered.models.length);

  const hasFiles = (event: React.DragEvent) => vision && event.dataTransfer.types.includes("Files");

  return (
    <Paper
      ref={bar}
      component="section"
      elevation={6}
      aria-label={t("studio.prompt.title")}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        setDragging(false);
        if (!hasFiles(event)) return;
        event.preventDefault();
        attach(event.dataTransfer.files);
      }}
      sx={{
        ...placement,
        width: "min(680px, calc(100% - 32px))",
        borderRadius: 3,
        border: 1,
        borderColor: dragging ? "primary.main" : "divider",
        transition: "border-color 150ms",
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
              assistant.chooseModel(value);
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
        {!panel && messages.length > 0 && (
          <Tooltip title={open ? t("studio.prompt.hideConversation") : t("studio.prompt.showConversation")}>
            <IconButton
              size="small"
              aria-label={open ? t("studio.prompt.hideConversation") : t("studio.prompt.showConversation")}
              aria-expanded={open}
              color={open ? "primary" : "default"}
              onClick={() => setExpanded((value) => !value)}
            >
              <ForumOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {open && !running && (
          <Tooltip title={t("studio.prompt.clear")}>
            <IconButton size="small" aria-label={t("studio.prompt.clear")} onClick={() => void assistant.clear()}>
              <DeleteSweepOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title={t("studio.prompt.minimize")}>
          <IconButton size="small" aria-label={t("studio.prompt.minimize")} onClick={() => assistant.minimize(true)}>
            <KeyboardArrowDownIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      {open && (messages.length > 0 || running) ? (
        <Box sx={{ mt: 1 }}>
          <AssistantConversation assistant={assistant} maxHeight="min(40vh, 320px)" />
        </Box>
      ) : (
        !panel && <Status assistant={assistant} onOpen={() => setExpanded(true)} />
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
        <Box sx={{ mt: 1, border: 1, borderColor: "divider", borderRadius: 2, pl: 1.5, pr: 0.5, py: 0.5 }}>
          {attached.length > 0 && (
            <Stack direction="row" spacing={0.75} sx={{ pt: 0.75, pb: 0.25, flexWrap: "wrap" }}>
              {attached.map((each, index) => (
                <Box key={each.key} sx={{ position: "relative", ...fadeIn }}>
                  <PictureThumb
                    source={{ url: each.url }}
                    size={48}
                    alt={t("studio.prompt.picture", { number: index + 1 })}
                    dim={!each.picture || blocked}
                  />
                  {!each.picture && (
                    <CircularProgress
                      size={18}
                      aria-label={t("studio.working")}
                      sx={{ position: "absolute", top: 15, left: 15 }}
                    />
                  )}
                  <IconButton
                    size="small"
                    aria-label={t("studio.prompt.removePicture", { number: index + 1 })}
                    onClick={() => letGo((other) => other.key !== each.key)}
                    sx={{
                      position: "absolute",
                      top: -8,
                      right: -8,
                      p: 0.25,
                      bgcolor: "background.paper",
                      border: 1,
                      borderColor: "divider",
                      "&:hover": { bgcolor: "background.paper" },
                    }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}
          {blocked && (
            <Typography variant="caption" sx={{ display: "block", color: "warning.main", pt: 0.5 }}>
              {t("studio.prompt.noVision")}
            </Typography>
          )}
          <Stack direction="row" alignItems="flex-end" spacing={1}>
            {vision && (
              <Tooltip title={t("studio.prompt.attach")}>
                <span>
                  <IconButton
                    size="small"
                    aria-label={t("studio.prompt.attach")}
                    disabled={!usable || attached.length >= MAX_PICTURES}
                    onClick={() => picker.current?.click()}
                    sx={{ ml: -1 }}
                  >
                    <AddPhotoAlternateOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                attach(event.target.files ?? []);
                event.target.value = "";
              }}
            />
            <InputBase
              multiline
              maxRows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                if (!vision || !files.length) return;
                event.preventDefault();
                attach(files);
              }}
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
                <IconButton size="small" color="primary" aria-label={t("studio.prompt.stop")} onClick={assistant.stop}>
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
                    disabled={!usable || !text.trim() || sending || uploading || blocked}
                    onClick={() => void send()}
                  >
                    {sending ? <CircularProgress size={16} /> : <SendRoundedIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
