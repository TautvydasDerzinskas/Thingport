import React from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { AnimatedTile } from "../../components/storageAnimations/parts";

type Props = {
  /** Drawn in the tile, at 76 like the other admin sections. */
  animation: React.ReactNode;
  title: string;
  /** A `HelpTip` beside the title. */
  help: React.ReactNode;
  summary: string;
  checked: boolean;
  disabled: boolean;
  /** Its own save is going. */
  busy: boolean;
  /** Why it can't be switched, shown on the switch while it's disabled for that reason. */
  blockedReason?: string;
  onChange: (checked: boolean) => void;
  /** Under the summary, e.g. a status line. */
  extra?: React.ReactNode;
  /** Before the switch, e.g. a ⋮ menu. */
  actions?: React.ReactNode;
};

/** One feature on the Social page: its tile, what it does, and its switch at the end. */
export default function FeatureRow({
  animation,
  title,
  help,
  summary,
  checked,
  disabled,
  busy,
  blockedReason,
  onChange,
  extra,
  actions,
}: Props) {
  const id = React.useId();
  const toggle = (
    <Switch
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      inputProps={{ role: "switch", "aria-labelledby": `${id}-title`, "aria-describedby": `${id}-summary` }}
    />
  );
  return (
    // A gap rather than margins: the tile is hidden on phones and leaves no space then.
    <Stack direction="row" spacing={2.5} useFlexGap alignItems="center" sx={{ p: 2.5 }}>
      <AnimatedTile>{animation}</AnimatedTile>
      <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={600} component="div">
          <span id={`${id}-title`}>{title}</span>
          {help}
        </Typography>
        <Typography id={`${id}-summary`} variant="body2" color="text.secondary">
          {summary}
        </Typography>
        {extra}
      </Stack>
      {busy && <CircularProgress size={16} />}
      {actions}
      {blockedReason ? (
        <Tooltip title={blockedReason}>
          <span>{toggle}</span>
        </Tooltip>
      ) : (
        toggle
      )}
    </Stack>
  );
}
