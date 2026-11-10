import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import TagIcon from "@mui/icons-material/Tag";
import type { Chat, ChatPerson } from "../../api/chats";
import { personAvatar } from "../importQueue/personAvatar";
import { visuallyHiddenSx } from "../importQueue/queueParts";
import InstanceAvatar from "../InstanceAvatar";
import UserAvatar from "../UserAvatar";

/** A green dot on someone's picture while they have Thingport open; their instance's badge for someone elsewhere. */
export function PersonAvatar({
  person,
  size = 36,
}: {
  person: (Omit<ChatPerson, "online"> & { online?: boolean }) | null;
  size?: number;
}) {
  if (!person) {
    return (
      <Avatar sx={{ width: size, height: size, fontSize: Math.round(size * 0.45), bgcolor: "action.selected" }}>
        ?
      </Avatar>
    );
  }
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <Box sx={{ position: "relative", flexShrink: 0, width: size, height: size }}>
      <UserAvatar user={person} size={size} />
      {person.remote && (
        // Read out with their name, so two people of the same name elsewhere are told apart.
        <Box component="span" sx={visuallyHiddenSx}>
          {person.remote.handle ?? person.remote.instance.name}
        </Box>
      )}
      {person.remote && (
        <Box
          sx={{
            position: "absolute",
            right: -3,
            bottom: -3,
            borderRadius: "5px",
            border: "2px solid",
            borderColor: "background.paper",
            lineHeight: 0,
          }}
        >
          <InstanceAvatar
            origin={person.remote.instance.origin}
            name={person.remote.instance.name}
            size={Math.max(12, Math.round(size * 0.42))}
          />
        </Box>
      )}
      {person.online && !person.remote && (
        <Box
          sx={{
            position: "absolute",
            right: -1,
            bottom: -1,
            width: dot,
            height: dot,
            borderRadius: "50%",
            bgcolor: "success.main",
            border: "2px solid",
            borderColor: "background.paper",
          }}
        />
      )}
    </Box>
  );
}

/** The other person for direct messages; a room's mark, # or a padlock for a private one, on a colour of its own. */
export default function ChatAvatar({ chat, size = 36 }: { chat: Chat; size?: number }) {
  if (chat.kind === "direct") return <PersonAvatar person={chat.other} size={size} />;
  const { background, foreground } = personAvatar(chat.id);
  const Icon = chat.is_public ? TagIcon : LockOutlinedIcon;
  return (
    <Avatar variant="rounded" sx={{ width: size, height: size, bgcolor: background, color: foreground, flexShrink: 0 }}>
      <Icon sx={{ fontSize: Math.round(size * 0.55) }} />
    </Avatar>
  );
}
