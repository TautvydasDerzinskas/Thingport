import { useState, type ReactNode } from "react";
import Badge from "@mui/material/Badge";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Tooltip from "@mui/material/Tooltip";
import TuneIcon from "@mui/icons-material/Tune";

type Props = {
  label: string;
  /** How many filters are changed from their default, for the badge. */
  active: number;
  children: ReactNode;
};

/** A grid toolbar's filter button, badged with how many filters are changed, and the popover it opens. */
export default function FilterPopoverButton({ label, active, children }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title={label}>
        <Badge color="primary" badgeContent={active} overlap="circular">
          <IconButton
            size="small"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={Boolean(anchor)}
            onClick={(event) => setAnchor(event.currentTarget)}
            color={active ? "primary" : "default"}
          >
            <TuneIcon fontSize="small" />
          </IconButton>
        </Badge>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 1, px: 2, py: 1.5, maxWidth: "calc(100vw - 32px)" } } }}
      >
        {children}
      </Popover>
    </>
  );
}
