import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { keyframes } from "@emotion/react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CloseIcon from "@mui/icons-material/Close";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import NotificationsOffOutlinedIcon from "@mui/icons-material/NotificationsOffOutlined";
import SearchIcon from "@mui/icons-material/Search";
import { chatsApi, type Chat, type ChatPerson } from "../../api/chats";
import { UnauthorizedError } from "../../api/client";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ListRowSkeletons } from "../ListSkeleton";
import { useToast } from "../ToastProvider";
import ChatAvatar, { PersonAvatar } from "./ChatAvatar";
import type { ChatMenuAnchor } from "./ChatActionsMenu";
import { chatTitle, shortTime } from "./chatFormat";
import ChatMenuHost from "./ChatMenuHost";
import { useChats } from "./ChatsContext";
import NewChatDialog from "./NewChatDialog";
import RoomDialog from "./RoomDialog";

const appear = keyframes`
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
`;

/** A count on a coloured pill, as for unread messages. */
export function UnreadPill({ count, muted = false }: { count: number; muted?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        minWidth: 18,
        height: 18,
        px: "5px",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "9px",
        fontSize: "0.65rem",
        fontWeight: 700,
        bgcolor: muted ? "action.selected" : "primary.main",
        color: muted ? "text.secondary" : "primary.contrastText",
      }}
    >
      {count > 99 ? "99+" : count}
    </Box>
  );
}

function SectionHeading({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1, pt: 1.5, pb: 0.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.5, fontWeight: 700 }}>
        {label}
      </Typography>
      {action}
    </Stack>
  );
}

function ChatRow({
  chat,
  selected,
  viewerId,
  onOpen,
  onMenu,
}: {
  chat: Chat;
  selected: boolean;
  viewerId: string;
  onOpen: () => void;
  onMenu: (anchor: ChatMenuAnchor) => void;
}) {
  const { t, i18n } = useTranslation("app");
  const last = chat.last_message;
  const unread = chat.joined && chat.unread > 0;
  // A message that's only models says which.
  const said =
    last && !last.body && last.attachments.length
      ? last.attachments.length === 1
        ? t("chats.sentModel", { name: last.attachments[0].name })
        : t("chats.sentModels", { count: last.attachments.length })
      : (last?.body ?? "");
  const preview = !last
    ? chat.kind === "room"
      ? chat.description || (chat.is_public ? t("chats.publicRoom") : t("chats.privateRoom"))
      : t("chats.noMessagesYet")
    : last.deleted
      ? t("chats.messageDeleted")
      : last.sender?.id === viewerId
        ? t("chats.youWrote", { body: said })
        : chat.kind === "room"
          ? `${last.sender?.display_name ?? t("chats.deletedUser")}: ${said}`
          : said;
  return (
    <ListItemButton
      selected={selected}
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ top: event.clientY, left: event.clientX });
      }}
      aria-current={selected ? "page" : undefined}
      sx={{
        borderRadius: 1,
        mb: 0.25,
        gap: 1.25,
        py: 0.75,
        px: 1,
        animation: `${appear} 180ms ease-out`,
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    >
      <ChatAvatar chat={chat} size={36} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography
            variant="body2"
            noWrap
            sx={{ flex: 1, minWidth: 0, fontWeight: unread ? 700 : 500, opacity: chat.joined ? 1 : 0.8 }}
          >
            {chatTitle(chat, t)}
          </Typography>
          {last && (
            <Typography variant="caption" color={unread ? "primary.main" : "text.secondary"} sx={{ flexShrink: 0 }}>
              {shortTime(last.created_at, i18n.language)}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography
            variant="caption"
            color={unread ? "text.primary" : "text.secondary"}
            noWrap
            sx={{ flex: 1, minWidth: 0, fontStyle: last?.deleted ? "italic" : undefined, display: "block" }}
          >
            {preview}
          </Typography>
          {chat.muted && (
            <NotificationsOffOutlinedIcon
              sx={{ fontSize: 14, color: "text.disabled" }}
              titleAccess={t("chats.mutedLabel")}
            />
          )}
          {unread && <UnreadPill count={chat.unread} muted={chat.muted} />}
        </Stack>
      </Box>
    </ListItemButton>
  );
}

type Props = {
  onUnauthorized?: () => void;
  /** After a chat's been opened, as a phone's menu closes. */
  onNavigate?: () => void;
};

/** Every chat the user has, in Favourites, Direct messages and Rooms; the search finds them and anyone to write to. */
export default function ChatList({ onUnauthorized, onNavigate }: Props) {
  const { t } = useTranslation(["app", "common"]);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showToast = useToast();
  const { chats, listFailed, refreshList, viewerId, isAdmin, putChat } = useChats();
  const openChatId = pathname.startsWith("/chats/") ? decodeURIComponent(pathname.slice("/chats/".length)) : undefined;
  const [query, setQuery] = React.useState("");
  const term = query.trim().toLocaleLowerCase();
  const debounced = useDebouncedValue(query.trim(), 250);
  const [people, setPeople] = React.useState<ChatPerson[]>([]);
  const [menu, setMenu] = React.useState<{ chat: Chat; anchor: ChatMenuAnchor } | null>(null);
  const [newChat, setNewChat] = React.useState(false);
  const [newRoom, setNewRoom] = React.useState(false);

  // People to write to, for a search: those not already in the user's direct messages.
  React.useEffect(() => {
    if (!debounced) {
      setPeople([]);
      return;
    }
    let current = true;
    chatsApi.people(debounced).then(
      (found) => {
        if (current) setPeople(found);
      },
      (err) => {
        if (current && err instanceof UnauthorizedError) onUnauthorized?.();
      },
    );
    return () => {
      current = false;
    };
  }, [debounced, onUnauthorized]);

  const open = (chatId: string) => {
    navigate(`/chats/${chatId}`);
    onNavigate?.();
  };
  const openPerson = async (person: ChatPerson) => {
    try {
      const chat = await chatsApi.openDirect(person);
      putChat(chat);
      setQuery("");
      open(chat.id);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized?.();
      else showToast({ message: err instanceof Error ? err.message : t("chats.openFailed"), severity: "error" });
    }
  };

  const matching = (chats ?? []).filter((chat) => !term || chatTitle(chat, t).toLocaleLowerCase().includes(term));
  const favorites = matching.filter((chat) => chat.favorite);
  const direct = matching.filter((chat) => !chat.favorite && chat.kind === "direct");
  const rooms = matching.filter((chat) => !chat.favorite && chat.kind === "room");
  const directWith = new Set(
    (chats ?? []).flatMap((chat) => (chat.kind === "direct" && chat.other ? [chat.other.id] : [])),
  );
  const newPeople = people.filter((person) => !directWith.has(person.id));

  const rows = (list: Chat[]) => (
    <List dense disablePadding>
      {list.map((chat) => (
        <ChatRow
          key={chat.id}
          chat={chat}
          viewerId={viewerId}
          selected={chat.id === openChatId}
          onOpen={() => open(chat.id)}
          onMenu={(anchor) => setMenu({ chat, anchor })}
        />
      ))}
    </List>
  );
  const addButton = (label: string, onClick: () => void) => (
    <Tooltip title={label}>
      <IconButton size="small" onClick={onClick} aria-label={label} sx={{ p: 0.25 }}>
        <AddIcon sx={{ fontSize: 18 }} />
      </IconButton>
    </Tooltip>
  );

  let body: React.ReactNode;
  if (chats === null && listFailed) {
    body = (
      <Alert
        severity="error"
        sx={{ mx: 1, mt: 1 }}
        action={
          <Button color="inherit" size="small" onClick={() => void refreshList()}>
            {t("common:retry")}
          </Button>
        }
      >
        {t("chats.loadFailed")}
      </Alert>
    );
  } else if (chats === null) {
    body = (
      <Box sx={{ pt: 1.5 }}>
        <ListRowSkeletons count={6} lead="circle" leadSize={36} twoLines />
      </Box>
    );
  } else if (!chats.length && !term) {
    body = (
      <Stack alignItems="center" spacing={1.5} sx={{ px: 2, py: 5, textAlign: "center" }}>
        <ChatBubbleOutlineIcon sx={{ fontSize: 36, color: "text.disabled" }} />
        <Typography variant="body2" color="text.secondary">
          {t("chats.emptyList")}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
          <Button size="small" variant="outlined" startIcon={<EditNoteOutlinedIcon />} onClick={() => setNewChat(true)}>
            {t("chats.newMessage")}
          </Button>
          {isAdmin && (
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={() => setNewRoom(true)}>
              {t("chats.newRoom")}
            </Button>
          )}
        </Stack>
      </Stack>
    );
  } else {
    body = (
      <>
        {favorites.length > 0 && (
          <>
            <SectionHeading label={t("chats.favorites")} />
            {rows(favorites)}
          </>
        )}
        {(!term || direct.length > 0) && (
          <>
            <SectionHeading
              label={t("chats.directMessages")}
              action={addButton(t("chats.newMessage"), () => setNewChat(true))}
            />
            {direct.length ? (
              rows(direct)
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, pb: 1 }}>
                {t("chats.noDirect")}
              </Typography>
            )}
          </>
        )}
        {(!term || rooms.length > 0) && (rooms.length > 0 || isAdmin) && (
          <>
            <SectionHeading
              label={t("chats.rooms")}
              action={isAdmin ? addButton(t("chats.newRoom"), () => setNewRoom(true)) : undefined}
            />
            {rooms.length ? (
              rows(rooms)
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 1, pb: 1 }}>
                {t("chats.noRooms")}
              </Typography>
            )}
          </>
        )}
        {term && newPeople.length > 0 && (
          <>
            <SectionHeading label={t("chats.people")} />
            <List dense disablePadding>
              {newPeople.map((person) => (
                <ListItemButton
                  key={person.id}
                  onClick={() => void openPerson(person)}
                  sx={{ borderRadius: 1, mb: 0.25, gap: 1.25, py: 0.75, px: 1 }}
                >
                  <PersonAvatar person={person} size={36} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap fontWeight={500}>
                      {person.display_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>
                      {t("chats.startChat")}
                    </Typography>
                  </Box>
                </ListItemButton>
              ))}
            </List>
          </>
        )}
        {term && !matching.length && !newPeople.length && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 3, textAlign: "center" }}>
            {t("chats.nothingFound")}
          </Typography>
        )}
      </>
    );
  }

  return (
    <Stack sx={{ minHeight: 0, flex: 1 }}>
      <Box sx={{ px: 1, pb: 0.5 }}>
        <TextField
          size="small"
          fullWidth
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("chats.search")}
          inputProps={{ "aria-label": t("chats.search") }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: query ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setQuery("")} aria-label={t("chats.clearSearch")} edge="end">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 0.5, pb: 2 }}>{body}</Box>
      <ChatMenuHost
        chat={menu?.chat ?? null}
        anchor={menu?.anchor ?? null}
        onClose={() => setMenu(null)}
        openChatId={openChatId}
        onUnauthorized={onUnauthorized}
      />
      {newChat && <NewChatDialog onClose={() => setNewChat(false)} onUnauthorized={onUnauthorized} />}
      {newRoom && (
        <RoomDialog
          viewerId={viewerId}
          onClose={() => setNewRoom(false)}
          onUnauthorized={onUnauthorized}
          onSaved={(room) => {
            setNewRoom(false);
            putChat(room);
            open(room.id);
          }}
        />
      )}
    </Stack>
  );
}
