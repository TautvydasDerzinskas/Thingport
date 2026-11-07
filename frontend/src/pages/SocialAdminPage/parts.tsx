import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { visuallyHiddenSx } from "../../components/importQueue/queueParts";
import InstanceAvatar from "../../components/InstanceAvatar";
import ToneChip from "../../components/ToneChip";

export { InstanceAvatar, ToneChip };
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as const;

/** An address or a key, set in monospace. */
export function Mono({ children, muted = true }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <Typography
      component="span"
      variant="caption"
      sx={{ ...mono, color: muted ? "text.secondary" : "text.primary", overflowWrap: "anywhere" }}
    >
      {children}
    </Typography>
  );
}

/** A key's fingerprint in its groups of four: `large` for reading it out to another admin. */
export function KeyBlocks({ fingerprint, large = false }: { fingerprint: string; large?: boolean }) {
  const { t } = useTranslation("app");
  // Positions, not values, tell the groups apart: two can be the same.
  const groups = fingerprint.split(" ").map((group, position) => ({ group, id: `${position}:${group}` }));
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: large ? "repeat(3, minmax(0, 1fr))" : `repeat(${groups.length}, auto)`,
        justifyContent: large ? "stretch" : "start",
        gap: large ? 1 : 0.75,
      }}
    >
      <Box component="span" sx={visuallyHiddenSx}>
        {t("adminSettings.social.federation.keyAria", { key: fingerprint })}
      </Box>
      {groups.map(({ group, id }) => (
        <Box
          key={id}
          aria-hidden
          sx={{
            ...mono,
            fontSize: large ? 24 : 13,
            fontWeight: large ? 600 : 500,
            letterSpacing: "0.06em",
            textAlign: "center",
            px: large ? 0 : 0.75,
            py: large ? 1 : 0.25,
            borderRadius: 1,
            bgcolor: "action.hover",
            color: "text.primary",
          }}
        >
          {group}
        </Box>
      ))}
    </Box>
  );
}

/** Shown beside an instance reached over plain HTTP: it works, but what's sent can be read on the way. */
export function HttpChip() {
  const { t } = useTranslation("app");
  return (
    <ToneChip tone="warning" icon={<LockOpenOutlinedIcon />} label={t("adminSettings.social.federation.plainHttp")} />
  );
}
