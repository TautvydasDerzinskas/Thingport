import React from "react";
import { useTranslation } from "react-i18next";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useToast } from "./ToastProvider";
import { buildBookmarklet } from "../utils/bookmarklet";
import { copyText } from "../utils/clipboard";

/** The bookmarklet as a button to drag to the bookmarks bar, with a button copying its code. */
export default function BookmarkletButton() {
  const { t } = useTranslation("app");
  const showToast = useToast();
  const code = React.useMemo(() => buildBookmarklet(window.location.origin), []);
  const linkRef = React.useRef<HTMLAnchorElement | null>(null);

  // Set outside React, which warns about (and will block) javascript: links in href.
  React.useEffect(() => {
    linkRef.current?.setAttribute("href", code);
  }, [code]);

  // Where the browser won't copy, the link can still be dragged or copied by right-click.
  const copy = async () => {
    try {
      await copyText(code);
      showToast({ message: t("bookmarklet.copied"), severity: "success" });
    } catch {
      showToast({ message: t("bookmarklet.copyFailed"), severity: "warning" });
    }
  };

  return (
    <Stack direction="row" alignItems="center" spacing={0.5}>
      <Tooltip title={t("bookmarklet.dragHint")}>
        <Button
          ref={linkRef}
          component="a"
          variant="outlined"
          size="small"
          draggable
          startIcon={<BookmarkAddOutlinedIcon fontSize="small" />}
          // Only works from the bookmarks bar; here a click just says so.
          onClick={(event: React.MouseEvent) => {
            event.preventDefault();
            showToast({ message: t("bookmarklet.dragHint"), severity: "info" });
          }}
          sx={{ cursor: "grab", "&:active": { cursor: "grabbing" } }}
        >
          {t("bookmarklet.linkLabel")}
        </Button>
      </Tooltip>
      <Tooltip title={t("bookmarklet.copy")}>
        <IconButton size="small" onClick={() => void copy()} aria-label={t("bookmarklet.copy")}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}
