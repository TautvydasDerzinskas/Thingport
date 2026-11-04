import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import InsertEmoticonOutlinedIcon from "@mui/icons-material/InsertEmoticonOutlined";
import SendIcon from "@mui/icons-material/Send";
import ViewInArOutlinedIcon from "@mui/icons-material/ViewInArOutlined";
import type { Print } from "../../api/prints";
import ModelPickerDialog, { ModelThumb } from "../../components/ModelPickerDialog";

export const MESSAGE_MAX_LENGTH = 4000;
/** Models one message can carry, as the server allows. */
export const MAX_ATTACHMENTS = 5;
// The count shows once a message gets near the limit.
const COUNT_FROM = MESSAGE_MAX_LENGTH - 500;

// Only loaded once someone opens it: the library and its emoji are most of a megabyte.
const EmojiPanel = React.lazy(() => import("../../components/chats/EmojiPanel"));

type Props = {
  placeholder: string;
  /** Text, models from the user's own library, or both. */
  onSend: (body: string, models: Print[]) => void;
  onUnauthorized?: () => void;
};

/** What the user writes: Enter sends, Shift+Enter starts a new line. Emoji go in where the cursor is, and models from
 *  their library go with the message. Focused when a chat opens (one per chat), so typing starts straight away. */
export default function Composer({ placeholder, onSend, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [draft, setDraft] = React.useState("");
  const [models, setModels] = React.useState<Print[]>([]);
  const [emojiAt, setEmojiAt] = React.useState<HTMLElement | null>(null);
  const [picking, setPicking] = React.useState(false);
  const input = React.useRef<HTMLTextAreaElement | null>(null);
  // Where the cursor was when the emoji picker took focus, so an emoji goes in there.
  const caret = React.useRef<{ start: number; end: number } | null>(null);
  const trimmed = draft.trim();
  const tooLong = draft.length > MESSAGE_MAX_LENGTH;
  const canSend = (Boolean(trimmed) || models.length > 0) && !tooLong;

  React.useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const send = () => {
    if (!canSend) return;
    onSend(trimmed, models);
    setDraft("");
    setModels([]);
    input.current?.focus();
  };

  const openEmoji = (anchor: HTMLElement) => {
    const el = input.current;
    caret.current = el ? { start: el.selectionStart, end: el.selectionEnd } : null;
    setEmojiAt(anchor);
  };

  const insertEmoji = (emoji: string) => {
    const at = caret.current ?? { start: draft.length, end: draft.length };
    const next = draft.slice(0, at.start) + emoji + draft.slice(at.end);
    const after = at.start + emoji.length;
    caret.current = { start: after, end: after };
    setDraft(next);
  };

  const closeEmoji = () => {
    setEmojiAt(null);
    // Back to typing, just after what went in.
    window.requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      const at = caret.current?.end ?? el.value.length;
      el.setSelectionRange(at, at);
    });
  };

  const addModels = (picked: Print[]) => {
    setPicking(false);
    setModels((list) => {
      const known = new Set(list.map((model) => model.id));
      return [...list, ...picked.filter((model) => !known.has(model.id))].slice(0, MAX_ATTACHMENTS);
    });
    input.current?.focus();
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", px: 1.5, py: 1 }}>
      {models.length > 0 && (
        <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
          {models.map((model) => {
            const name = model.title || model.name;
            return (
              <Chip
                key={model.id}
                size="small"
                avatar={<ModelThumb url={model.thumb_url} size={20} />}
                label={name}
                onDelete={() => setModels((list) => list.filter((entry) => entry.id !== model.id))}
                aria-label={t("chats.removeAttachment", { name })}
                sx={{ maxWidth: 220 }}
              />
            );
          })}
        </Stack>
      )}
      <Stack direction="row" spacing={0.5} alignItems="flex-end">
        <Tooltip title={t("chats.emoji")}>
          <IconButton
            onClick={(event) => openEmoji(event.currentTarget)}
            aria-label={t("chats.emoji")}
            aria-haspopup="dialog"
            aria-expanded={Boolean(emojiAt)}
            sx={{ mb: 0.25 }}
          >
            <InsertEmoticonOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip
          title={
            models.length >= MAX_ATTACHMENTS
              ? t("chats.attachLimit", { count: MAX_ATTACHMENTS })
              : t("chats.attachModel")
          }
        >
          <span>
            <IconButton
              onClick={() => setPicking(true)}
              disabled={models.length >= MAX_ATTACHMENTS}
              aria-label={t("chats.attachModel")}
              sx={{ mb: 0.25 }}
            >
              <ViewInArOutlinedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <TextField
          inputRef={input}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Not while an input method is still putting a word together.
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          inputProps={{ "aria-label": placeholder }}
          multiline
          maxRows={6}
          fullWidth
          size="small"
          error={tooLong}
        />
        <Tooltip title={t("chats.send")}>
          <span>
            <IconButton
              color="primary"
              onClick={send}
              disabled={!canSend}
              aria-label={t("chats.send")}
              sx={{ mb: 0.25 }}
            >
              <SendIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
      {draft.length > COUNT_FROM && (
        <Typography variant="caption" color={tooLong ? "error" : "text.secondary"} sx={{ display: "block", mt: 0.5 }}>
          {t("chats.characters", { count: draft.length, max: MESSAGE_MAX_LENGTH })}
        </Typography>
      )}
      <Popover
        open={Boolean(emojiAt)}
        anchorEl={emojiAt}
        onClose={closeEmoji}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { overflow: "hidden" } } }}
      >
        <React.Suspense
          fallback={
            <Box sx={{ width: 340, height: 380, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CircularProgress size={24} />
            </Box>
          }
        >
          <EmojiPanel onPick={insertEmoji} />
        </React.Suspense>
      </Popover>
      {picking && (
        <ModelPickerDialog
          title={t("chats.attachTitle")}
          confirmLabel={t("chats.attach")}
          max={MAX_ATTACHMENTS - models.length}
          onClose={() => setPicking(false)}
          onPick={addModels}
          onUnauthorized={onUnauthorized}
        />
      )}
    </Box>
  );
}
