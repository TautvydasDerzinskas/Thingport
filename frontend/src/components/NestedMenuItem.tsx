import React, { useState } from "react";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

type Props = {
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** What it's set to now, at the item's end. */
  detail?: React.ReactNode;
  disabled?: boolean;
  /** The submenu's items; `close` closes the submenu, for an item that's done. */
  children: (close: () => void) => React.ReactNode;
};

/** A menu item that opens a submenu beside it: on click, Enter or the right arrow key, closed again by the left one. */
export default function NestedMenuItem({ label, icon, detail, disabled, children }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <MenuItem
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        disabled={disabled}
        selected={Boolean(anchor)}
        onClick={(event) => setAnchor(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setAnchor(event.currentTarget);
          }
        }}
      >
        {icon && <ListItemIcon>{icon}</ListItemIcon>}
        <ListItemText>{label}</ListItemText>
        {detail && (
          <Typography variant="body2" color="text.secondary" noWrap sx={{ ml: 2, maxWidth: 160 }}>
            {detail}
          </Typography>
        )}
        <ChevronRightIcon fontSize="small" sx={{ ml: 0.5, mr: -0.75, color: "text.secondary" }} />
      </MenuItem>
      <Menu
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        // Its own right-clicks, and the left arrow back, stay in it.
        onContextMenu={(event) => event.preventDefault()}
        slotProps={{
          paper: { sx: { minWidth: 200 } },
          list: {
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "ArrowLeft") {
                event.stopPropagation();
                close();
              }
            },
          },
        }}
      >
        {children(close)}
      </Menu>
    </>
  );
}
