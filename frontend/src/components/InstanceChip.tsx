import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import type { InstanceRef } from "../api/social";
import { statusTint } from "../theme";
import InstanceAvatar from "./InstanceAvatar";

type Props = {
  instance: Pick<InstanceRef, "name" | "origin">;
  label: string;
  /** Laid over a picture (a card's), on the paper colour; otherwise tinted, beside a name. */
  overlay?: boolean;
};

/** Which connected instance something is on: its badge and a few words. */
export default function InstanceChip({ instance, label, overlay = false }: Props) {
  const tint = statusTint(useTheme(), "success");
  return (
    <Box
      component="span"
      title={instance.origin}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
        height: overlay ? 22 : 26,
        pl: 0.375,
        pr: 1,
        maxWidth: "100%",
        borderRadius: "7px",
        fontSize: overlay ? 11 : 12,
        fontWeight: overlay ? 500 : 600,
        whiteSpace: "nowrap",
        ...(overlay
          ? { bgcolor: "background.paper", color: "text.primary", border: 1, borderColor: "divider" }
          : { bgcolor: tint.background, color: tint.text }),
      }}
    >
      <InstanceAvatar origin={instance.origin} name={instance.name} size={overlay ? 16 : 18} />
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </Box>
    </Box>
  );
}
