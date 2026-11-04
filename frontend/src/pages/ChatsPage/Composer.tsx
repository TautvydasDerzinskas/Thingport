import React from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SendIcon from "@mui/icons-material/Send";

export const MESSAGE_MAX_LENGTH = 4000;
// The count shows once a message gets near the limit.
const COUNT_FROM = MESSAGE_MAX_LENGTH - 500;

type Props = {
  placeholder: string;
  onSend: (body: string) => void;
};

/** What the user writes: Enter sends, Shift+Enter starts a new line. Focused when a chat opens (one per chat), so typing
 *  starts straight away. */
export default function Composer({ placeholder, onSend }: Props) {
  const { t } = useTranslation("app");
  const [draft, setDraft] = React.useState("");
  const input = React.useRef<HTMLTextAreaElement | null>(null);
  const trimmed = draft.trim();
  const tooLong = draft.length > MESSAGE_MAX_LENGTH;

  React.useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);

  const send = () => {
    if (!trimmed || tooLong) return;
    onSend(trimmed);
    setDraft("");
    input.current?.focus();
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", px: 1.5, py: 1 }}>
      <Stack direction="row" spacing={1} alignItems="flex-end">
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
              disabled={!trimmed || tooLong}
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
    </Box>
  );
}
