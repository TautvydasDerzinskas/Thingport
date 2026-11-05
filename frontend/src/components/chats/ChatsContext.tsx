import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { chatsApi, ChatsOffError, type Chat } from "../../api/chats";
import { UnauthorizedError } from "../../api/client";
import { refreshSocialStatus, useSocialStatus } from "../../hooks/useSocialStatus";
import { useNotifications } from "../Layout/NotificationsContext";
import { useToast } from "../ToastProvider";

// Chats' shared state: the unread count, for the sidebar's badge, asked every half a minute wherever the user is (and
// which shows them online while Thingport is in front of them); and while Chats is open, the list of chats, asked
// more often. A new message while the user is somewhere else comes up as a toast that opens its chat.

const UNREAD_POLL_MS = 30_000;
const LIST_POLL_MS = 10_000;

type ChatsContextValue = {
  /** The sidebar offers Chats: social features and chats on, and someone to talk to. */
  enabled: boolean;
  viewerId: string;
  isAdmin: boolean;
  unread: number;
  /** Null until read; only read while Chats is open. */
  chats: Chat[] | null;
  listFailed: boolean;
  refreshList: () => Promise<void>;
  refreshUnread: () => void;
  /** Puts in what an action answered a chat now is, ahead of the next poll. */
  putChat: (chat: Chat) => void;
  dropChat: (chatId: string) => void;
};

const ChatsContext = React.createContext<ChatsContextValue | null>(null);

const visible = () => document.visibilityState === "visible";

type ProviderProps = {
  viewerId: string | null;
  isAdmin: boolean;
  onUnauthorized?: () => void;
  children: React.ReactNode;
};

export function ChatsProvider({ viewerId, isAdmin, onUnauthorized, children }: ProviderProps) {
  const { t } = useTranslation("app");
  const enabled = useSocialStatus()?.chats === true && viewerId !== null;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const showToast = useToast();
  const { refresh: refreshNotifications } = useNotifications();
  const active = enabled && (pathname === "/chats" || pathname.startsWith("/chats/"));
  const [unread, setUnread] = React.useState(0);
  const [chats, setChats] = React.useState<Chat[] | null>(null);
  const [listFailed, setListFailed] = React.useState(false);

  // Read inside the polls without restarting them on every navigation.
  const pathRef = React.useRef(pathname);
  const live = React.useRef({ toast: showToast, notifications: refreshNotifications, navigate, t, onUnauthorized });
  const shown = React.useRef({ enabled, active });
  React.useEffect(() => {
    pathRef.current = pathname;
    live.current = { toast: showToast, notifications: refreshNotifications, navigate, t, onUnauthorized };
    shown.current = { enabled, active };
  });
  // The newest unread message already said: the first answer only sets it, as what's waiting isn't news this moment.
  const toldId = React.useRef<string | null | undefined>(undefined);
  // Only the latest ask of each counts: answers can come back in any order.
  const listGeneration = React.useRef(0);
  const unreadGeneration = React.useRef(0);

  const failed = React.useCallback((err: unknown) => {
    if (err instanceof UnauthorizedError) live.current.onUnauthorized?.();
    // Switched off since the sidebar last asked: it stops offering Chats.
    else if (err instanceof ChatsOffError) void refreshSocialStatus();
  }, []);

  const refreshUnread = React.useCallback(() => {
    const asked = ++unreadGeneration.current;
    chatsApi.unread(visible()).then(
      (summary) => {
        if (asked !== unreadGeneration.current) return;
        setUnread(summary.unread);
        const latest = summary.latest;
        const known = toldId.current;
        toldId.current = latest?.message_id ?? null;
        if (known === undefined || !latest || latest.message_id === known) return;
        // Something new: the bell has it as well, and Chats' own list, if it's open, shows it now.
        void live.current.notifications();
        const path = pathRef.current;
        if (path === "/chats" || path.startsWith("/chats/")) return;
        live.current.toast({
          message: `${latest.title} — ${latest.body}`,
          severity: "info",
          action: {
            label: live.current.t("chats.open"),
            onClick: () => live.current.navigate(`/chats/${latest.chat_id}`),
          },
          autoHideMs: 8000,
        });
      },
      (err) => {
        if (asked === unreadGeneration.current) failed(err);
      },
    );
  }, [failed]);

  const refreshList = React.useCallback(async () => {
    const asked = ++listGeneration.current;
    try {
      const list = await chatsApi.list();
      if (asked !== listGeneration.current) return;
      setChats(list);
      setListFailed(false);
    } catch (err) {
      if (asked !== listGeneration.current) return;
      failed(err);
      setListFailed(true);
    }
  }, [failed]);

  React.useEffect(() => {
    if (!enabled) {
      setUnread(0);
      toldId.current = undefined;
      return;
    }
    refreshUnread();
    const interval = window.setInterval(refreshUnread, UNREAD_POLL_MS);
    const onReturn = () => {
      if (visible()) refreshUnread();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [enabled, refreshUnread]);

  React.useEffect(() => {
    if (!active) return;
    void refreshList();
    const interval = window.setInterval(() => {
      if (visible()) void refreshList();
    }, LIST_POLL_MS);
    const onReturn = () => {
      if (visible()) void refreshList();
    };
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [active, refreshList]);

  // Another account signed in, in another tab: nothing of the last one's stays on show, and theirs is read at once.
  const shownFor = React.useRef(viewerId);
  React.useEffect(() => {
    if (shownFor.current === viewerId) return;
    shownFor.current = viewerId;
    listGeneration.current += 1;
    unreadGeneration.current += 1;
    toldId.current = undefined;
    setChats(null);
    setListFailed(false);
    setUnread(0);
    if (!shown.current.enabled) return;
    refreshUnread();
    if (shown.current.active) void refreshList();
  }, [viewerId, refreshUnread, refreshList]);

  // What's read in the list is read for the badge too.
  React.useEffect(() => {
    if (!chats) return;
    setUnread(chats.reduce((sum, chat) => sum + (chat.joined && !chat.muted ? chat.unread : 0), 0));
  }, [chats]);

  const putChat = React.useCallback((chat: Chat) => {
    listGeneration.current += 1;
    setChats((list) => {
      if (!list) return list;
      const rest = list.filter((entry) => entry.id !== chat.id);
      return [chat, ...rest].toSorted((a, b) => b.last_message_at.localeCompare(a.last_message_at));
    });
  }, []);

  const dropChat = React.useCallback((chatId: string) => {
    listGeneration.current += 1;
    setChats((list) => list?.filter((entry) => entry.id !== chatId) ?? list);
  }, []);

  const value = React.useMemo(
    () => ({
      enabled,
      viewerId: viewerId ?? "",
      isAdmin,
      unread,
      chats,
      listFailed,
      refreshList,
      refreshUnread,
      putChat,
      dropChat,
    }),
    [enabled, viewerId, isAdmin, unread, chats, listFailed, refreshList, refreshUnread, putChat, dropChat],
  );
  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats(): ChatsContextValue {
  const ctx = React.useContext(ChatsContext);
  if (!ctx) throw new Error("useChats must be used within a ChatsProvider");
  return ctx;
}
