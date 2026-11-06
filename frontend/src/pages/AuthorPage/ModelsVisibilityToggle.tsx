import { useState } from "react";
import { useTranslation } from "react-i18next";
import { keyframes } from "@emotion/react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PublicIcon from "@mui/icons-material/Public";

const turn = keyframes`from { transform: rotate(-120deg) scale(0.4); opacity: 0; } to { transform: none; opacity: 1; }`;

type Props = {
  isPublic: boolean;
  busy: boolean;
  onToggle: () => void;
};

/** Whether the user's own models are on Explore: a lock while only they see them, a globe once everyone can. */
export default function ModelsVisibilityToggle({ isPublic, busy, onToggle }: Props) {
  const { t } = useTranslation("models");
  // The icon turns when it changes, not when the page first shows it.
  const [changed, setChanged] = useState(false);
  return (
    <Tooltip title={t(isPublic ? "author.visibility.publicTip" : "author.visibility.privateTip")}>
      {/* A disabled button fires no events for the tooltip to hear. */}
      <Box component="span" sx={{ display: "inline-flex" }}>
        <IconButton
          aria-label={t("author.visibility.toggle")}
          aria-pressed={isPublic}
          disabled={busy}
          onClick={() => {
            setChanged(true);
            onToggle();
          }}
          sx={{
            width: 31,
            height: 31,
            border: 1,
            borderRadius: 1,
            borderColor: isPublic ? "primary.main" : "divider",
            color: isPublic ? "primary.main" : "text.secondary",
            transition: "border-color 200ms ease-out, color 200ms ease-out",
          }}
        >
          <Box
            key={String(isPublic)}
            sx={{
              display: "flex",
              ...(changed && {
                animation: `${turn} 250ms ease-out`,
                "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              }),
            }}
          >
            {isPublic ? <PublicIcon sx={{ fontSize: 18 }} /> : <LockOutlinedIcon sx={{ fontSize: 18 }} />}
          </Box>
        </IconButton>
      </Box>
    </Tooltip>
  );
}
