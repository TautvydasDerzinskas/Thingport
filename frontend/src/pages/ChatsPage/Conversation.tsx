import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ForumOutlinedIcon from "@mui/icons-material/ForumOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import {
  ChatNotFoundError,
  chatsApi,
  ChatsOffError,
  type Chat,
  type ChatDetail,
  type ChatMessage,
  type MessagePage,
} from "../../api/chats";
import { UnauthorizedError } from "../../api/client";
import { chatTitle } from "../../components/chats/chatFormat";
import ChatMenuHost from "../../components/chats/ChatMenuHost";
import { useChats } from "../../components/chats/ChatsContext";
import { useChatActions } from "../../components/chats/useChatActions";
import { useConfirm } from "../../components/ConfirmProvider";
import { usePageHeader } from "../../components/Layout/PageHeaderContext";
import StarToggle from "../../components/StarToggle";
import { useToast } from "../../components/ToastProvider";
import { refreshSocialStatus } from "../../hooks/useSocialStatus";
import { copyText } from "../../utils/clipboard";
import { newLocalId } from "../../utils/localId";
import Composer from "./Composer";
import MessageList, { type ShownMessage } from "./MessageList";

// While a chat is open in front of the user, it asks for what's new every few seconds; hidden, it waits.
const POLL_MS = 3_000;

const visible = () => document.visibilityState === "visible";
const byTime = (a: ShownMessage, b: ShownMessage) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** The chat as the list has it, without the members the full read brings. */
function summaryOf(detail: ChatDetail): Chat {
  const { members: _members, ...chat } = detail;
  return chat;
}

/** The first message of the last `unread` from others: where "New messages" goes. */
function firstUnread(messages: ChatMessage[], viewerId: string, unread: number): string | null {
  if (unread <= 0) return null;
  let left = unread;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.sender?.id === viewerId || message.deleted) continue;
    left -= 1;
    if (left === 0) return message.id;
  }
  return messages[0]?.id ?? null;
}

/** The user's message as shown until the server has it. */
function pendingMessage(chatId: string, viewerId: string, body: string): ShownMessage {
  return {
    id: `local-${newLocalId()}`,
    chat_id: chatId,
    sender: { id: viewerId, display_name: "", avatar_url: null },
    body,
    deleted: false,
    created_at: new Date().toISOString(),
    pending: "sending",
  };
}

const SKELETON_WIDTHS = [60, 40, 72, 35, 50];

function MessageSkeletons() {
  return (
    <Stack spacing={1.5} sx={{ p: 2.5 }} aria-hidden>
      {SKELETON_WIDTHS.map((width, index) => (
        <Box key={width} sx={{ display: "flex", justifyContent: index % 2 ? "flex-end" : "flex-start" }}>
          <Skeleton variant="rounded" height={34} sx={{ width: `${width}%`, borderRadius: "14px" }} />
        </Box>
      ))}
    </Stack>
  );
}

type Props = { chatId: string; mobile: boolean; onUnauthorized?: () => void };

type LoadState = "loading" | "ready" | "notFound" | "failed";

export default function Conversation({ chatId, mobile, onUnauthorized }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const showToast = useToast();
  const confirm = useConfirm();
  const { chats, viewerId, putChat, refreshUnread } = useChats();
  const actions = useChatActions(chatId, onUnauthorized);
  const listed = chats?.find((chat) => chat.id === chatId) ?? null;
  const [detail, setDetail] = React.useState<ChatDetail | null>(null);
  const [state, setState] = React.useState<LoadState>("loading");
  const [reload, setReload] = React.useState(0);
  const [messages, setMessages] = React.useState<ShownMessage[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [otherReadAt, setOtherReadAt] = React.useState<string | null>(null);
  const [firstUnreadId, setFirstUnreadId] = React.useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = React.useState<HTMLElement | null>(null);
  const [joining, setJoining] = React.useState(false);
  const chat: Chat | null = listed ?? (detail ? summaryOf(detail) : null);

  // The newest message from the server and its time, for the next poll; and which opening of a chat answers count for.
  const cursor = React.useRef<{ lastId: string | null; lastAt: string; since: string | null }>({
    lastId: null,
    lastAt: "",
    since: null,
  });
  const opened = React.useRef(0);
  const polling = React.useRef(false);
  const listedRef = React.useRef(listed);
  const joinedRef = React.useRef(false);
  const joinedNow = Boolean(chat?.joined);
  React.useEffect(() => {
    listedRef.current = listed;
    joinedRef.current = joinedNow;
  });

  const failed = React.useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else if (err instanceof ChatsOffError) void refreshSocialStatus();
      return err instanceof ChatNotFoundError || err instanceof ChatsOffError;
    },
    [onUnauthorized],
  );

  const take = React.useCallback((page: MessagePage, replace = false) => {
    setMessages((previous) => {
      const byId = new Map((replace ? [] : previous).map((message) => [message.id, message]));
      for (const message of page.messages) byId.set(message.id, message);
      for (const id of page.deleted_ids) {
        const message = byId.get(id);
        if (message) byId.set(id, { ...message, deleted: true, body: "" });
      }
      return [...byId.values()].toSorted(byTime);
    });
    const newest = page.messages.at(-1);
    if (newest && newest.created_at >= cursor.current.lastAt) {
      cursor.current.lastId = newest.id;
      cursor.current.lastAt = newest.created_at;
    }
    cursor.current.since = page.now;
    setOtherReadAt(page.other_read_at);
  }, []);

  React.useEffect(() => {
    const opening = ++opened.current;
    const current = () => opening === opened.current;
    setState("loading");
    setMessages([]);
    setDetail(null);
    setHasMore(false);
    setFirstUnreadId(null);
    cursor.current = { lastId: null, lastAt: "", since: null };
    // What the list said was unread before this read clears it.
    const unreadAtOpen = listedRef.current?.unread ?? 0;
    void (async () => {
      try {
        const read = await chatsApi.get(chatId);
        if (!current()) return;
        setDetail(read);
        if (!read.readable) {
          setState("ready");
          return;
        }
        const page = await chatsApi.messages(chatId, { seen: read.joined && visible() });
        if (!current()) return;
        take(page, true);
        setHasMore(page.has_more);
        setFirstUnreadId(firstUnread(page.messages, viewerId, unreadAtOpen));
        setState("ready");
        if (read.joined && visible()) {
          putChat({ ...summaryOf(read), unread: 0 });
          refreshUnread();
        }
      } catch (err) {
        if (!current()) return;
        setState(failed(err) ? "notFound" : "failed");
      }
    })();
    // `reload` isn't read here: it's what asks for the chat again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [chatId, reload, take, failed, viewerId, putChat, refreshUnread]);

  const readable = Boolean(detail?.readable);
  React.useEffect(() => {
    if (state !== "ready" || !readable) return;
    const opening = opened.current;
    const tick = async () => {
      if (!visible() || polling.current) return;
      polling.current = true;
      try {
        const page = await chatsApi.messages(chatId, {
          after: cursor.current.lastId ?? undefined,
          since: cursor.current.since ?? undefined,
          seen: joinedRef.current,
        });
        if (opening !== opened.current) return;
        const known = cursor.current.lastId;
        take(page);
        // Read here, so the badge and the list stop counting it.
        if (joinedRef.current && cursor.current.lastId !== known) refreshUnread();
      } catch (err) {
        if (opening === opened.current && failed(err)) setState("notFound");
      } finally {
        polling.current = false;
      }
    };
    const interval = window.setInterval(() => void tick(), POLL_MS);
    const onReturn = () => {
      if (visible()) void tick();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
    };
  }, [state, readable, chatId, take, failed, refreshUnread]);

  const loadOlder = async () => {
    const first = messages.find((message) => !message.pending);
    if (!first || loadingOlder) return;
    const opening = opened.current;
    setLoadingOlder(true);
    try {
      const page = await chatsApi.messages(chatId, { before: first.id });
      if (opening !== opened.current) return;
      setMessages((previous) => {
        const ids = new Set(previous.map((message) => message.id));
        return [...page.messages.filter((message) => !ids.has(message.id)), ...previous];
      });
      setHasMore(page.has_more);
    } catch (err) {
      if (!failed(err)) showToast({ message: t("chats.loadFailed"), severity: "error" });
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (body: string) => {
    if (!chat) return;
    const local = pendingMessage(chatId, viewerId, body);
    setMessages((previous) => [...previous, local]);
    setFirstUnreadId(null);
    try {
      const saved = await chatsApi.send(chatId, body);
      setMessages((previous) =>
        [...previous.filter((message) => message.id !== local.id && message.id !== saved.id), saved].toSorted(byTime),
      );
      putChat({ ...chat, last_message: saved, last_message_at: saved.created_at, unread: 0 });
    } catch (err) {
      setMessages((previous) =>
        previous.map((message) => (message.id === local.id ? { ...message, pending: "failed" } : message)),
      );
      if (failed(err)) setState("notFound");
      else if (!(err instanceof UnauthorizedError) && err instanceof Error) {
        showToast({ message: err.message, severity: "error" });
      }
    }
  };

  const remove = async (message: ShownMessage) => {
    if (message.pending) {
      setMessages((previous) => previous.filter((m) => m.id !== message.id));
      return;
    }
    const ok = await confirm({
      title: t("chats.deleteMessageTitle"),
      message: t("chats.deleteMessageText"),
      confirmLabel: t("chats.deleteMessage"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await chatsApi.deleteMessage(chatId, message.id);
      setMessages((previous) => previous.map((m) => (m.id === message.id ? { ...m, deleted: true, body: "" } : m)));
    } catch (err) {
      if (!failed(err) && !(err instanceof UnauthorizedError)) {
        showToast({ message: err instanceof Error ? err.message : t("chats.actionFailed"), severity: "error" });
      }
    }
  };

  const retry = (message: ShownMessage) => {
    setMessages((previous) => previous.filter((m) => m.id !== message.id));
    void send(message.body);
  };

  const copy = (message: ShownMessage) => {
    copyText(message.body).then(
      () => showToast({ message: t("chats.copied"), severity: "success" }),
      () => showToast({ message: t("chats.copyFailed"), severity: "error" }),
    );
  };

  const join = async () => {
    if (!chat) return;
    setJoining(true);
    if (await actions.join(chat)) setReload((n) => n + 1);
    setJoining(false);
  };

  const title = chat ? chatTitle(chat, t) : state === "loading" ? "" : t("sidebar.chats");
  const subtitle = !chat
    ? undefined
    : chat.kind === "direct"
      ? chat.other?.online
        ? t("chats.online")
        : chat.other
          ? t("chats.offline")
          : undefined
      : t(chat.is_public ? "chats.publicRoomMembers" : "chats.privateRoomMembers", { count: chat.member_count });
  const favorite = chat?.favorite ?? false;
  const joined = chat?.joined ?? false;
  const headerActions = React.useMemo(
    () =>
      chat ? (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          {joined && (
            <StarToggle
              active={favorite}
              onClick={() => void actions.toggleFavorite(chat)}
              ariaLabel={favorite ? t("chats.unfavorite") : t("chats.favorite")}
            />
          )}
          <Tooltip title={t("chats.chatActions")}>
            <IconButton aria-label={t("chats.chatActions")} onClick={(event) => setMenuAnchor(event.currentTarget)}>
              <MoreVertIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : undefined,
    [chat, actions, favorite, joined, t],
  );
  const back = React.useCallback(() => navigate("/chats"), [navigate]);
  usePageHeader({ title, subtitle, actions: headerActions, onBack: mobile ? back : undefined });

  let body: React.ReactNode;
  if (state === "loading") {
    body = <MessageSkeletons />;
  } else if (state === "notFound") {
    body = (
      <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ flex: 1, p: 3, textAlign: "center" }}>
        <ForumOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
        <Typography variant="body2" color="text.secondary">
          {t("chats.notFound")}
        </Typography>
        <Button size="small" variant="outlined" onClick={back}>
          {t("chats.backToChats")}
        </Button>
      </Stack>
    );
  } else if (state === "failed") {
    body = (
      <Box sx={{ p: 2 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => setReload((n) => n + 1)}>
              {t("common:retry")}
            </Button>
          }
        >
          {t("chats.loadFailed")}
        </Alert>
      </Box>
    );
  } else if (!readable) {
    body = (
      <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ flex: 1, p: 3, textAlign: "center" }}>
        <LockOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
          {t("chats.notAMember")}
        </Typography>
      </Stack>
    );
  } else {
    const name = chat ? chatTitle(chat, t) : "";
    const footer =
      chat?.kind === "room" && !chat.joined ? (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{ borderTop: 1, borderColor: "divider", px: 2, py: 1.25 }}
        >
          <Typography variant="body2" color="text.secondary">
            {t("chats.readingRoom")}
          </Typography>
          <Button
            variant="contained"
            size="small"
            onClick={() => void join()}
            disabled={joining}
            startIcon={joining ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {t("chats.join")}
          </Button>
        </Stack>
      ) : chat?.kind === "direct" && !chat.other ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ borderTop: 1, borderColor: "divider", px: 2, py: 1.5 }}
        >
          {t("chats.recipientGone")}
        </Typography>
      ) : (
        <Composer placeholder={t("chats.writeTo", { name })} onSend={(text) => void send(text)} />
      );
    body = (
      <>
        <MessageList
          messages={messages}
          viewerId={viewerId}
          room={chat?.kind === "room"}
          canDeleteAny={Boolean(chat?.can_manage)}
          firstUnreadId={firstUnreadId}
          otherReadAt={otherReadAt}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onLoadOlder={() => void loadOlder()}
          onCopy={copy}
          onDelete={(message) => void remove(message)}
          onRetry={retry}
          emptyText={chat?.kind === "room" ? t("chats.emptyRoom") : t("chats.emptyDirect", { name })}
        />
        {footer}
      </>
    );
  }

  return (
    <>
      <Paper
        variant="outlined"
        sx={{
          // The page's own height, under the top bar: the messages scroll, the box writing them stays put.
          height: "calc(100dvh - var(--topbar-height, 64px) - 16px)",
          minHeight: 320,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {body}
      </Paper>
      <ChatMenuHost
        chat={menuAnchor ? chat : null}
        anchor={menuAnchor ? { el: menuAnchor } : null}
        onClose={() => setMenuAnchor(null)}
        openChatId={chatId}
        onUnauthorized={onUnauthorized}
        onRoomSaved={() => setReload((n) => n + 1)}
      />
    </>
  );
}
