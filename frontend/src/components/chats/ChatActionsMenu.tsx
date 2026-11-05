import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import LoginIcon from "@mui/icons-material/Login";
import LogoutIcon from "@mui/icons-material/Logout";
import NotificationsOffOutlinedIcon from "@mui/icons-material/NotificationsOffOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import StarIcon from "@mui/icons-material/Star";
import type { Chat } from "../../api/chats";
import type { useChatActions } from "./useChatActions";

/** Where the menu opens: under its button, or where a list row was right-clicked. */
export type ChatMenuAnchor = { el: HTMLElement } | { top: number; left: number };

type Props = {
  chat: Chat | null;
  anchor: ChatMenuAnchor | null;
  onClose: () => void;
  actions: ReturnType<typeof useChatActions>;
  onMembers: (chat: Chat) => void;
  onEdit: (chat: Chat) => void;
};

/** A chat's own actions, the same from its row's right-click and from the ⋮ above it. */
export default function ChatActionsMenu({ chat, anchor, onClose, actions, onMembers, onEdit }: Props) {
  const { t } = useTranslation("app");
  const room = chat?.kind === "room";
  const run = (action: (chat: Chat) => unknown) => () => {
    onClose();
    if (chat) void action(chat);
  };
  const item = (key: string, icon: ReactNode, label: string, onClick: () => void, danger = false) => (
    <MenuItem key={key} onClick={onClick} sx={danger ? { color: "error.main" } : undefined}>
      <ListItemIcon sx={danger ? { color: "error.main" } : undefined}>{icon}</ListItemIcon>
      <ListItemText>{label}</ListItemText>
    </MenuItem>
  );

  const items = !chat
    ? []
    : [
        chat.joined &&
          item(
            "favorite",
            chat.favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />,
            chat.favorite ? t("chats.unfavorite") : t("chats.favorite"),
            run(actions.toggleFavorite),
          ),
        chat.joined &&
          item(
            "mute",
            chat.muted ? (
              <NotificationsOutlinedIcon fontSize="small" />
            ) : (
              <NotificationsOffOutlinedIcon fontSize="small" />
            ),
            chat.muted ? t("chats.unmute") : t("chats.mute"),
            run(actions.toggleMuted),
          ),
        room &&
          !chat.joined &&
          chat.is_public &&
          item("join", <LoginIcon fontSize="small" />, t("chats.join"), run(actions.join)),
        room && item("members", <GroupOutlinedIcon fontSize="small" />, t("chats.members"), run(onMembers)),
        chat.can_manage && item("edit", <EditOutlinedIcon fontSize="small" />, t("chats.editRoom"), run(onEdit)),
        ...(room && (chat.joined || chat.can_manage)
          ? [
              <Divider key="divider" />,
              chat.joined && item("leave", <LogoutIcon fontSize="small" />, t("chats.leave"), run(actions.leave), true),
              chat.can_manage &&
                item(
                  "delete",
                  <DeleteOutlineIcon fontSize="small" />,
                  t("chats.deleteRoom"),
                  run(actions.deleteRoom),
                  true,
                ),
            ]
          : []),
      ].filter(Boolean);

  return (
    <Menu
      open={Boolean(chat && anchor) && items.length > 0}
      onClose={onClose}
      {...(anchor && "el" in anchor
        ? { anchorEl: anchor.el, anchorOrigin: { vertical: "bottom", horizontal: "right" } as const }
        : { anchorReference: "anchorPosition" as const, anchorPosition: anchor ?? undefined })}
      transformOrigin={anchor && "el" in anchor ? { vertical: "top", horizontal: "right" } : undefined}
      slotProps={{ paper: { sx: { minWidth: 200 } } }}
    >
      {items}
    </Menu>
  );
}
