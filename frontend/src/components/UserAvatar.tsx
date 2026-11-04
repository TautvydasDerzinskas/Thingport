import Avatar from "@mui/material/Avatar";
import type { SxProps, Theme } from "@mui/material/styles";
import type { UserCard } from "../api/social";
import { personAvatar } from "./importQueue/personAvatar";

type Props = {
  user: Pick<UserCard, "id" | "display_name" | "avatar_url">;
  size?: number;
  sx?: SxProps<Theme>;
};

/** Another of the instance's users: the picture of the profile they linked as themselves, or their initial on a colour
 *  of their own, the same one wherever they appear. */
export default function UserAvatar({ user, size = 28, sx }: Props) {
  const { background, foreground } = personAvatar(user.id);
  return (
    <Avatar
      src={user.avatar_url ?? undefined}
      alt=""
      sx={[
        {
          width: size,
          height: size,
          fontSize: Math.round(size * 0.45),
          fontWeight: 700,
          bgcolor: background,
          color: foreground,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {(user.display_name.trim() || "?").slice(0, 1).toUpperCase()}
    </Avatar>
  );
}
