import Box from "@mui/material/Box";
import type { UserCard } from "../api/social";
import UserAvatar from "./UserAvatar";

type Props = {
  people: Pick<UserCard, "id" | "display_name" | "avatar_url">[];
  size?: number;
  /** The colour of the ring around each, so they stand apart where they overlap: what they sit on. */
  ringColor?: string;
  /** Faded, for people a collection isn't shared with right now. */
  dim?: boolean;
};

/** A few people's pictures, overlapping: who a collection is shared with. Decoration only: say their names beside it,
 *  or in the control it's in. */
export default function SharedAvatars({ people, size = 24, ringColor = "background.paper", dim = false }: Props) {
  if (!people.length) return null;
  const overlap = Math.round(size * 0.28);
  return (
    <Box aria-hidden sx={{ display: "inline-flex", flexShrink: 0, pr: `${overlap}px`, opacity: dim ? 0.6 : 1 }}>
      {people.map((person) => (
        <UserAvatar
          key={person.id}
          user={person}
          size={size}
          sx={{ mr: `-${overlap}px`, border: 2, borderColor: ringColor, boxSizing: "content-box" }}
        />
      ))}
    </Box>
  );
}
