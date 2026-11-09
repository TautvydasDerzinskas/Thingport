import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import { chatsApi, type ChatPerson } from "../../api/chats";
import { UnauthorizedError } from "../../api/client";
import { useChats } from "./ChatsContext";
import PeoplePicker from "../PeoplePicker";

/** Someone to write to: picking them opens the user's direct messages with them, new or not. */
export default function NewChatDialog({
  onClose,
  onUnauthorized,
}: {
  onClose: () => void;
  onUnauthorized?: () => void;
}) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const { putChat } = useChats();
  const [error, setError] = React.useState<string | null>(null);
  const [opening, setOpening] = React.useState(false);

  const open = async (person: ChatPerson) => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const chat = await chatsApi.openDirect(person);
      putChat(chat);
      onClose();
      navigate(`/chats/${chat.id}`);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else setError(err instanceof Error ? err.message : t("chats.openFailed"));
      setOpening(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1.5 }}>
        {t("chats.newMessage")}
        <Tooltip title={t("common:close")}>
          <IconButton size="small" onClick={onClose} aria-label={t("common:close")}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          {error && <Alert severity="error">{error}</Alert>}
          <PeoplePicker
            search={chatsApi.people}
            onPick={(person) => void open(person)}
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onUnauthorized={onUnauthorized}
            height={320}
          />
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
