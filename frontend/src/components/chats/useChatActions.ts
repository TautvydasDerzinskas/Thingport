import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { chatsApi, type Chat } from "../../api/chats";
import { UnauthorizedError } from "../../api/client";
import { useConfirm } from "../ConfirmProvider";
import { useToast } from "../ToastProvider";
import { chatTitle } from "./chatFormat";
import { useChats } from "./ChatsContext";

/** What can be done to a chat from its menu, each saying how it went. `openChatId` is the chat on screen: leaving or
 *  deleting it goes back to the list. */
export function useChatActions(openChatId?: string, onUnauthorized?: () => void) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const confirm = useConfirm();
  const showToast = useToast();
  const { putChat, dropChat, refreshList, refreshUnread } = useChats();

  const fail = React.useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : fallback, severity: "error" });
    },
    [onUnauthorized, showToast],
  );

  const update = React.useCallback(
    async (chat: Chat, patch: { favorite?: boolean; muted?: boolean }) => {
      try {
        putChat(await chatsApi.updateMembership(chat.id, patch));
        refreshUnread();
      } catch (err) {
        fail(err, t("chats.actionFailed"));
      }
    },
    [fail, putChat, refreshUnread, t],
  );

  const join = React.useCallback(
    async (chat: Chat) => {
      try {
        putChat(await chatsApi.join(chat.id));
        return true;
      } catch (err) {
        fail(err, t("chats.actionFailed"));
        return false;
      }
    },
    [fail, putChat, t],
  );

  const leave = React.useCallback(
    async (chat: Chat) => {
      const ok = await confirm({
        title: t("chats.leaveTitle", { name: chatTitle(chat, t) }),
        message: chat.is_public ? t("chats.leavePublic") : t("chats.leavePrivate"),
        confirmLabel: t("chats.leave"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await chatsApi.leave(chat.id);
        if (chat.is_public) void refreshList();
        else dropChat(chat.id);
        refreshUnread();
        if (openChatId === chat.id && !chat.is_public) navigate("/chats");
      } catch (err) {
        fail(err, t("chats.actionFailed"));
      }
    },
    [confirm, dropChat, fail, navigate, openChatId, refreshList, refreshUnread, t],
  );

  const deleteRoom = React.useCallback(
    async (chat: Chat) => {
      const ok = await confirm({
        title: t("chats.deleteRoomTitle", { name: chatTitle(chat, t) }),
        message: t("chats.deleteRoomMessage"),
        confirmLabel: t("chats.deleteRoom"),
        destructive: true,
      });
      if (!ok) return;
      try {
        await chatsApi.deleteRoom(chat.id);
        dropChat(chat.id);
        refreshUnread();
        showToast({ message: t("chats.roomDeleted", { name: chatTitle(chat, t) }), severity: "success" });
        if (openChatId === chat.id) navigate("/chats");
      } catch (err) {
        fail(err, t("chats.actionFailed"));
      }
    },
    [confirm, dropChat, fail, navigate, openChatId, refreshUnread, showToast, t],
  );

  return React.useMemo(
    () => ({
      toggleFavorite: (chat: Chat) => update(chat, { favorite: !chat.favorite }),
      toggleMuted: (chat: Chat) => update(chat, { muted: !chat.muted }),
      join,
      leave,
      deleteRoom,
    }),
    [update, join, leave, deleteRoom],
  );
}
