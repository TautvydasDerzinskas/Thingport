import React from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import type { ChatMessage } from "../../api/chats";
import { clockTime, dayLabel, sameDay } from "../../components/chats/chatFormat";
import UserAvatar from "../../components/UserAvatar";
import MessageText from "./MessageText";

/** A message as the conversation holds it: one still on its way, or one that didn't make it, is the user's own. */
export type ShownMessage = ChatMessage & { pending?: "sending" | "failed" };

// One person's messages a few minutes apart read as one block: one name, one time.
const GROUP_GAP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 48;
const NEAR_TOP_PX = 120;

const appear = keyframes`
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: none; }
`;

type Props = {
  messages: ShownMessage[];
  viewerId: string;
  /** A room shows who wrote each block; direct messages need not. */
  room: boolean;
  /** An admin, in a room, may take out anyone's message. */
  canDeleteAny: boolean;
  /** The first message that was unread when the chat opened. */
  firstUnreadId: string | null;
  /** Direct messages: when the other person last read them. */
  otherReadAt: string | null;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onCopy: (message: ShownMessage) => void;
  onDelete: (message: ShownMessage) => void;
  onRetry: (message: ShownMessage) => void;
  emptyText: string;
};

function sameSender(a: ShownMessage | undefined, b: ShownMessage | undefined): boolean {
  if (!a || !b) return false;
  return (
    (a.sender?.id ?? null) === (b.sender?.id ?? null) &&
    sameDay(a.created_at, b.created_at) &&
    Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < GROUP_GAP_MS
  );
}

type MenuState = { message: ShownMessage; anchor: { el: HTMLElement } | { top: number; left: number } };

/** A conversation: its messages oldest first, by day, kept at the newest as they come unless the user scrolled up. */
export default function MessageList({
  messages,
  viewerId,
  room,
  canDeleteAny,
  firstUnreadId,
  otherReadAt,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onCopy,
  onDelete,
  onRetry,
  emptyText,
}: Props) {
  const { t, i18n } = useTranslation(["app", "common"]);
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const atBottom = React.useRef(true);
  const [showJump, setShowJump] = React.useState(false);
  const [menu, setMenu] = React.useState<MenuState | null>(null);
  // Older messages go in above: what was on screen stays where it was.
  const heightBeforeOlder = React.useRef<number | null>(null);
  const lastId = messages.at(-1)?.id;
  const firstId = messages[0]?.id;
  const previousFirst = React.useRef(firstId);

  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (previousFirst.current !== firstId && heightBeforeOlder.current !== null) {
      el.scrollTop += el.scrollHeight - heightBeforeOlder.current;
      heightBeforeOlder.current = null;
    }
    previousFirst.current = firstId;
  }, [firstId]);

  const scrolledFor = React.useRef<string | undefined>(undefined);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    // Only when a newer message arrives: not for one deleted or confirmed.
    if (!el || !lastId || scrolledFor.current === lastId) return;
    scrolledFor.current = lastId;
    const last = messages.at(-1);
    // Down to the newest when the user was there already, or it's what they just sent.
    if (atBottom.current || last?.sender?.id === viewerId) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [lastId, messages, viewerId]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (atBottom.current) setShowJump(false);
    if (el.scrollTop < NEAR_TOP_PX && hasMore && !loadingOlder) {
      heightBeforeOlder.current = el.scrollHeight;
      onLoadOlder();
    }
  };

  const jump = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setShowJump(false);
  };

  // My newest message the other person has read, for "Seen" under it.
  const seenId = React.useMemo(() => {
    if (room || !otherReadAt) return null;
    const mine = messages.filter((m) => m.sender?.id === viewerId && !m.pending && m.created_at <= otherReadAt);
    return mine.at(-1)?.id ?? null;
  }, [messages, otherReadAt, room, viewerId]);

  const canDelete = (message: ShownMessage) => !message.deleted && (message.sender?.id === viewerId || canDeleteAny);

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <Box
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        sx={{ flex: 1, overflowY: "auto", px: { xs: 1.5, md: 2.5 }, py: 2 }}
      >
        {hasMore && (
          <Box sx={{ display: "flex", justifyContent: "center", pb: 1 }}>
            {loadingOlder ? (
              <CircularProgress size={18} />
            ) : (
              <Button size="small" onClick={onLoadOlder}>
                {t("chats.loadOlder")}
              </Button>
            )}
          </Box>
        )}
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 6 }}>
            {emptyText}
          </Typography>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const mine = message.sender?.id === viewerId || Boolean(message.pending);
          const newDay = !previous || !sameDay(previous.created_at, message.created_at);
          const startsGroup = newDay || !sameSender(previous, message) || message.id === firstUnreadId;
          const endsGroup = !sameSender(message, next) || next?.id === firstUnreadId;
          const showName = room && !mine && startsGroup;
          return (
            <React.Fragment key={message.id}>
              {newDay && (
                <Divider sx={{ my: 1.5, "&::before, &::after": { borderColor: "divider" } }}>
                  <Typography variant="caption" color="text.secondary">
                    {dayLabel(message.created_at, i18n.language, t)}
                  </Typography>
                </Divider>
              )}
              {message.id === firstUnreadId && (
                <Divider sx={{ my: 1, color: "primary.main", "&::before, &::after": { borderColor: "primary.main" } }}>
                  <Typography variant="caption" fontWeight={700}>
                    {t("chats.newMessages")}
                  </Typography>
                </Divider>
              )}
              <Stack
                direction="row"
                spacing={1}
                justifyContent={mine ? "flex-end" : "flex-start"}
                alignItems="flex-end"
                sx={{
                  mt: startsGroup ? 1 : 0.25,
                  animation: `${appear} 180ms ease-out`,
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                  "&:hover .message-more, &:focus-within .message-more": { opacity: 1 },
                }}
                onContextMenu={(event) => {
                  if (message.pending || message.deleted) return;
                  event.preventDefault();
                  setMenu({ message, anchor: { top: event.clientY, left: event.clientX } });
                }}
              >
                {room && !mine && (
                  <Box sx={{ width: 28, flexShrink: 0 }}>
                    {endsGroup &&
                      (message.sender ? (
                        <UserAvatar user={message.sender} size={28} />
                      ) : (
                        <UserAvatar user={{ id: "", display_name: "?", avatar_url: null }} size={28} />
                      ))}
                  </Box>
                )}
                {mine && !message.pending && !message.deleted && (
                  <MoreButton
                    onClick={(el) => setMenu({ message, anchor: { el } })}
                    label={t("chats.messageActions")}
                  />
                )}
                <Box sx={{ maxWidth: { xs: "85%", md: "70%" }, minWidth: 0 }}>
                  {showName && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", ml: 1, mb: 0.25 }}>
                      {message.sender?.display_name ?? t("chats.deletedUser")}
                    </Typography>
                  )}
                  <Tooltip
                    title={new Date(message.created_at).toLocaleString(i18n.language)}
                    placement={mine ? "left" : "right"}
                    enterDelay={600}
                  >
                    <Box
                      sx={(theme) => ({
                        px: 1.25,
                        py: 0.75,
                        borderRadius: "14px",
                        ...(mine
                          ? { borderBottomRightRadius: endsGroup ? "4px" : "14px" }
                          : { borderBottomLeftRadius: endsGroup ? "4px" : "14px" }),
                        bgcolor: message.deleted
                          ? "transparent"
                          : mine
                            ? theme.palette.primary.main
                            : alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.1 : 0.06),
                        color: message.deleted
                          ? "text.secondary"
                          : mine
                            ? theme.palette.primary.contrastText
                            : "text.primary",
                        border: message.deleted ? `1px dashed ${theme.palette.divider}` : "none",
                        opacity: message.pending === "sending" ? 0.7 : 1,
                        transition: "opacity 150ms",
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      })}
                    >
                      <Typography
                        variant="body2"
                        component="div"
                        sx={{ fontStyle: message.deleted ? "italic" : undefined }}
                      >
                        {message.deleted ? t("chats.messageDeleted") : <MessageText body={message.body} />}
                      </Typography>
                    </Box>
                  </Tooltip>
                  {message.pending === "failed" ? (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      alignItems="center"
                      justifyContent="flex-end"
                      sx={{ mt: 0.25 }}
                    >
                      <Typography variant="caption" color="error">
                        {t("chats.sendFailed")}
                      </Typography>
                      <Button size="small" onClick={() => onRetry(message)} sx={{ minWidth: 0, py: 0 }}>
                        {t("common:retry")}
                      </Button>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => onDelete(message)}
                        sx={{ minWidth: 0, py: 0 }}
                      >
                        {t("chats.discard")}
                      </Button>
                    </Stack>
                  ) : (
                    endsGroup && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mt: 0.25, mx: 1, textAlign: mine ? "right" : "left" }}
                      >
                        {message.pending === "sending"
                          ? t("chats.sending")
                          : message.id === seenId
                            ? t("chats.seenAt", { time: clockTime(message.created_at, i18n.language) })
                            : clockTime(message.created_at, i18n.language)}
                      </Typography>
                    )
                  )}
                </Box>
                {!mine && !message.deleted && (
                  <MoreButton
                    onClick={(el) => setMenu({ message, anchor: { el } })}
                    label={t("chats.messageActions")}
                  />
                )}
              </Stack>
            </React.Fragment>
          );
        })}
      </Box>
      {showJump && (
        <Button
          size="small"
          variant="contained"
          onClick={jump}
          endIcon={<KeyboardArrowDownIcon />}
          sx={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            boxShadow: 3,
            animation: `${appear} 180ms ease-out`,
            "@media (prefers-reduced-motion: reduce)": { animation: "none" },
          }}
        >
          {t("chats.jumpToNew")}
        </Button>
      )}
      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        {...(menu && "el" in menu.anchor
          ? { anchorEl: menu.anchor.el }
          : {
              anchorReference: "anchorPosition" as const,
              anchorPosition: menu?.anchor as { top: number; left: number },
            })}
      >
        <MenuItem
          onClick={() => {
            if (menu) onCopy(menu.message);
            setMenu(null);
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("chats.copyMessage")}</ListItemText>
        </MenuItem>
        {menu &&
          canDelete(menu.message) && [
            <Divider key="divider" />,
            <MenuItem
              key="delete"
              onClick={() => {
                onDelete(menu.message);
                setMenu(null);
              }}
              sx={{ color: "error.main" }}
            >
              <ListItemIcon sx={{ color: "error.main" }}>
                <DeleteOutlineIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("chats.deleteMessage")}</ListItemText>
            </MenuItem>,
          ]}
      </Menu>
    </Box>
  );
}

/** A message's ⋮, shown while it's hovered or focused. */
function MoreButton({ onClick, label }: { onClick: (el: HTMLElement) => void; label: string }) {
  return (
    <Tooltip title={label}>
      <IconButton
        className="message-more"
        size="small"
        aria-label={label}
        onClick={(event) => onClick(event.currentTarget)}
        sx={{
          opacity: 0,
          alignSelf: "center",
          transition: "opacity 150ms",
          "&:focus-visible": { opacity: 1 },
          "@media (hover: none)": { opacity: 0.6 },
          "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
