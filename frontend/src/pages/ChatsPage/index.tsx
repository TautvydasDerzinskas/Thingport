import React from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import ChatList from "../../components/chats/ChatList";
import NewChatDialog from "../../components/chats/NewChatDialog";
import { useSocialStatus } from "../../hooks/useSocialStatus";
import Conversation from "./Conversation";

// The page's own height under the top bar, as the conversation's.
const FILL = "calc(100dvh - var(--topbar-height, 64px) - 16px)";

function Centered({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ height: FILL, minHeight: 320, display: "flex" }}>
      <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ flex: 1, p: 3, textAlign: "center" }}>
        {icon}
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          {text}
        </Typography>
        {action}
      </Stack>
    </Paper>
  );
}

/** Chats: on a wide screen the list is the column beside the sidebar (ChatsSubnav) and this is the open chat; on a phone
 *  this is the list until a chat is opened. */
export default function ChatsPage({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const { t } = useTranslation("app");
  const { chatId } = useParams<{ chatId?: string }>();
  const status = useSocialStatus();
  const mobile = useMediaQuery((theme: Theme) => theme.breakpoints.down("md"));
  const [newChat, setNewChat] = React.useState(false);

  if (status === null) return null;
  if (!status.chats) {
    return (
      <Centered icon={<ForumOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />} text={t("chats.off")} />
    );
  }
  if (chatId) return <Conversation key={chatId} chatId={chatId} mobile={mobile} onUnauthorized={onUnauthorized} />;
  if (mobile) {
    return (
      <Paper variant="outlined" sx={{ height: FILL, minHeight: 320, display: "flex", flexDirection: "column", pt: 1 }}>
        <ChatList onUnauthorized={onUnauthorized} />
      </Paper>
    );
  }
  return (
    <>
      <Centered
        icon={<ForumOutlinedIcon sx={{ fontSize: 48, color: "text.disabled" }} />}
        text={t("chats.welcome")}
        action={
          <Button variant="outlined" size="small" startIcon={<EditNoteOutlinedIcon />} onClick={() => setNewChat(true)}>
            {t("chats.newMessage")}
          </Button>
        }
      />
      {newChat && <NewChatDialog onClose={() => setNewChat(false)} onUnauthorized={onUnauthorized} />}
    </>
  );
}
