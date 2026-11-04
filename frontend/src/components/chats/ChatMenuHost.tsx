import React from "react";
import { useTranslation } from "react-i18next";
import { chatsApi, type Chat, type ChatDetail } from "../../api/chats";
import { UnauthorizedError } from "../../api/client";
import { useToast } from "../ToastProvider";
import ChatActionsMenu, { type ChatMenuAnchor } from "./ChatActionsMenu";
import { useChats } from "./ChatsContext";
import MembersDialog from "./MembersDialog";
import RoomDialog from "./RoomDialog";
import { useChatActions } from "./useChatActions";

type Props = {
  chat: Chat | null;
  anchor: ChatMenuAnchor | null;
  onClose: () => void;
  /** The chat on screen, if any. */
  openChatId?: string;
  onUnauthorized?: () => void;
  /** After a room's been edited, for a page showing it to read it again. */
  onRoomSaved?: (chat: Chat) => void;
};

/** A chat's menu, and the members list and room editor it opens. */
export default function ChatMenuHost({ chat, anchor, onClose, openChatId, onUnauthorized, onRoomSaved }: Props) {
  const { t } = useTranslation("app");
  const showToast = useToast();
  const { viewerId, putChat } = useChats();
  const actions = useChatActions(openChatId, onUnauthorized);
  // "loading" while the room's members are read for it.
  const [members, setMembers] = React.useState<ChatDetail | "loading" | null>(null);
  const [editing, setEditing] = React.useState<ChatDetail | null>(null);

  const detail = async (target: Chat) => {
    try {
      return await chatsApi.get(target.id);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : t("chats.loadFailed"), severity: "error" });
      return null;
    }
  };

  const showMembers = async (target: Chat) => {
    setMembers("loading");
    const room = await detail(target);
    setMembers(room);
  };
  const edit = async (target: Chat) => {
    setMembers(null);
    const room = await detail(target);
    if (room) setEditing(room);
  };

  return (
    <>
      <ChatActionsMenu
        chat={chat}
        anchor={anchor}
        onClose={onClose}
        actions={actions}
        onMembers={(target) => void showMembers(target)}
        onEdit={(target) => void edit(target)}
      />
      {members && (
        <MembersDialog
          room={members === "loading" ? null : members}
          viewerId={viewerId}
          onClose={() => setMembers(null)}
          onEdit={members !== "loading" && members.can_manage ? () => void edit(members) : undefined}
        />
      )}
      {editing && (
        <RoomDialog
          room={{ chat: editing, members: editing.members }}
          viewerId={viewerId}
          onClose={() => setEditing(null)}
          onUnauthorized={onUnauthorized}
          onSaved={(saved) => {
            setEditing(null);
            putChat(saved);
            onRoomSaved?.(saved);
            showToast({ message: t("chats.roomSaved", { name: saved.name ?? "" }), severity: "success" });
          }}
        />
      )}
    </>
  );
}
