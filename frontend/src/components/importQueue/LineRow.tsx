import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import PersonIcon from "@mui/icons-material/Person";
import { personAvatar } from "./personAvatar";
import { PlacePill, riseInSx, StatusChip } from "./queueParts";
import { nowRowText, privateRowText, type QueueRow } from "./queueView";

const AVATAR_SIZE = 28;
const avatarFrameSx = {
  width: AVATAR_SIZE,
  height: AVATAR_SIZE,
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "50%",
};

/** Whose place it is, without saying who: the same mark for all of someone's imports, so people can be told apart. */
function PersonMark({ mine, person }: { mine: boolean; person: string }) {
  if (mine) {
    return (
      <Box aria-hidden sx={{ ...avatarFrameSx, bgcolor: "primary.main", color: "primary.contrastText" }}>
        <PersonIcon sx={{ fontSize: 16 }} />
      </Box>
    );
  }
  const { background, foreground, path } = personAvatar(person);
  return (
    <Box aria-hidden sx={{ ...avatarFrameSx, bgcolor: background }}>
      <svg viewBox="0 0 24 24" width={16} height={16} style={{ display: "block", fill: foreground }}>
        <path d={path} />
      </svg>
    </Box>
  );
}

type Props = { row: Exclude<QueueRow, { kind: "card" }> };

/** A rung of the ladder that isn't one of the viewer's cards: what's on now, or someone else's place. There's nothing
 *  more to it, as others' imports stay private. */
export default function LineRow({ row }: Props) {
  const { t } = useTranslation("app");
  const now = row.kind === "now";
  const { pill, text } = now ? { pill: t("importQueue.line.now"), text: nowRowText(row, t) } : privateRowText(row, t);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, px: 1.5, py: 0.75, ...riseInSx }}>
      <PlacePill text={pill} quiet />
      <PersonMark mine={now && row.mine} person={row.person} />
      <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
        {text}
      </Typography>
      <StatusChip
        label={t(now ? "importQueue.status.running" : "importQueue.status.queued")}
        tone={now ? "warning" : "info"}
        live={now}
      />
    </Box>
  );
}
