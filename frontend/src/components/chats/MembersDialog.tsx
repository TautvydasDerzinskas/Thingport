import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Typography from "@mui/material/Typography";
import type { ChatDetail, ChatPerson } from "../../api/chats";
import InstanceAvatar from "../InstanceAvatar";
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

const monoSx = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "text.secondary" } as const;

type Group = {
  key: string;
  /** This instance's people, named so only beside others'. */
  here: boolean;
  instance: { name: string; origin: string } | null;
  members: ChatPerson[];
};

/** A room's members by where they are: this instance's first, then each partner's. One group, unheaded, for a room
 *  of this instance's people only. */
function groupsOf(room: ChatDetail): Group[] {
  const local = room.members.filter((member) => !member.remote);
  const elsewhere = new Map<string, Group>();
  for (const member of room.members) {
    if (!member.remote) continue;
    const { origin, name } = member.remote.instance;
    const group = elsewhere.get(origin) ?? { key: origin, here: false, instance: { origin, name }, members: [] };
    group.members.push(member);
    elsewhere.set(origin, group);
  }
  if (!elsewhere.size) return [{ key: "here", here: false, instance: null, members: local }];
  return [
    ...(local.length ? [{ key: "here", here: true, instance: null, members: local }] : []),
    ...elsewhere.values(),
  ];
}

/** Who's in a room, the online ones marked, and those on partner instances under theirs. */
export default function MembersDialog({ room, viewerId, onClose, onEdit }: Props) {
  const { t } = useTranslation(["app", "common", "models"]);
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
            {groupsOf(room).map((group) => (
              <li key={group.key}>
                <List dense disablePadding>
                  {group.instance && (
                    <ListSubheader sx={{ display: "flex", alignItems: "center", gap: 1, lineHeight: "32px", px: 1.5 }}>
                      <InstanceAvatar origin={group.instance.origin} name={group.instance.name} size={18} />
                      {group.instance.name}
                    </ListSubheader>
                  )}
                  {group.here && (
                    <ListSubheader sx={{ lineHeight: "32px", px: 1.5 }}>{t("models:explore.scope.here")}</ListSubheader>
                  )}
                  {group.members.map((member) => (
                    <ListItem key={member.id} sx={{ gap: 1.5, px: 1.5 }}>
                      <PersonAvatar person={member} size={32} />
                      <ListItemText
                        primary={
                          member.id === viewerId ? t("chats.you", { name: member.display_name }) : member.display_name
                        }
                        secondary={member.remote ? member.remote.handle : member.online ? t("chats.online") : undefined}
                        primaryTypographyProps={{ variant: "body2", noWrap: true }}
                        secondaryTypographyProps={
                          member.remote
                            ? { variant: "caption", noWrap: true, sx: monoSx }
                            : { variant: "caption", color: "success.main" }
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </li>
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
