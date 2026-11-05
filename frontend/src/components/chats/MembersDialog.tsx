import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import type { ChatDetail } from "../../api/chats";
import { ListRowSkeletons } from "../ListSkeleton";
import { PersonAvatar } from "./ChatAvatar";

type Props = {
  /** Null while it loads. */
  room: ChatDetail | null;
  viewerId: string;
  onClose: () => void;
  /** An admin's: opens the room's own editor. */
  onEdit?: () => void;
};

/** Who's in a room, the online ones marked. */
export default function MembersDialog({ room, viewerId, onClose, onEdit }: Props) {
  const { t } = useTranslation(["app", "common"]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("chats.membersOf", { name: room?.name ?? "" })}</DialogTitle>
      <DialogContent sx={{ px: 1.5 }}>
        {!room ? (
          <ListRowSkeletons count={4} lead="circle" leadSize={32} />
        ) : room.members.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 2 }}>
            {t("chats.noMembers")}
          </Typography>
        ) : (
          <List dense disablePadding>
            {room.members.map((member) => (
              <ListItem key={member.id} sx={{ gap: 1.5, px: 1.5 }}>
                <PersonAvatar person={member} size={32} />
                <ListItemText
                  primary={member.id === viewerId ? t("chats.you", { name: member.display_name }) : member.display_name}
                  secondary={member.online ? t("chats.online") : undefined}
                  primaryTypographyProps={{ variant: "body2", noWrap: true }}
                  secondaryTypographyProps={{ variant: "caption", color: "success.main" }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        {onEdit && room && <Button onClick={onEdit}>{t("chats.editRoom")}</Button>}
        <Button onClick={onClose}>{t("common:close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
