import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useNotifications } from "./NotificationsContext";
import { NotificationsTwoToneIcon, topBarButtonSx } from "./topBarIcons";
import { useConfirm } from "../ConfirmProvider";
import NotificationList from "../notifications/NotificationList";
import NotificationTabs, { clearConfirmKey, emptyKey } from "../notifications/NotificationTabs";
import { useNotificationFeed, useOpenedSince } from "../notifications/useNotificationFeed";
import type { Notification, NotificationFilter } from "../../api/notifications";

const PREVIEW_LIMIT = 10;

/** Mounted only while the dropdown is open, so each opening loads the tab fresh. */
function NotificationDropdown({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const opened = useOpenedSince();
  const feed = useNotificationFeed(filter, PREVIEW_LIMIT, opened);

  const handleOpenItem = (notification: Notification) => {
    if (!notification.internal_path) return;
    onClose();
    navigate(notification.internal_path);
  };

  const handleClear = async () => {
    const confirmed = await confirmDialog({
      message: t(clearConfirmKey(filter)),
      confirmLabel: t("notifications.clearAll"),
      destructive: true,
    });
    if (confirmed) void feed.clear();
  };

  const handleViewAll = () => {
    onClose();
    navigate(filter === "all" ? "/notifications" : `/notifications?tab=${filter}`);
  };

  return (
    <>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pl: 2, pr: 1, py: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ flex: 1 }}>
          {t("notifications.label")}
        </Typography>
        {feed.items.length > 0 && (
          <Button size="small" color="inherit" onClick={() => void handleClear()} sx={{ color: "text.secondary" }}>
            {t("notifications.clearAll")}
          </Button>
        )}
      </Stack>
      <NotificationTabs value={filter} onChange={setFilter} />
      <Divider />
      <Box sx={{ overflowY: "auto", flex: 1, px: 1, py: 1, minHeight: 120 }}>
        {feed.items.length > 0 ? (
          <NotificationList
            items={feed.items}
            since={opened.since}
            onOpen={handleOpenItem}
            onDelete={(n) => void feed.remove(n)}
          />
        ) : feed.loading ? (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={20} />
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 3 }}>
            {t(feed.failed ? "notifications.loadFailed" : emptyKey(filter))}
          </Typography>
        )}
      </Box>
      <Divider />
      <Button onClick={handleViewAll} sx={{ borderRadius: 0, py: 1.25 }}>
        {t("notifications.viewAll")}
      </Button>
    </>
  );
}

export default function NotificationBell() {
  const { t } = useTranslation("app");
  const { unreadCount } = useNotifications();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title={t("notifications.label")}>
        <IconButton
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          aria-label={t("notifications.label")}
          sx={topBarButtonSx}
        >
          <Badge
            badgeContent={unreadCount}
            color="error"
            max={99}
            // On the button's corner, small enough to leave the bell in sight.
            sx={{
              "& .MuiBadge-badge": {
                top: -3,
                right: -4,
                minWidth: 16,
                height: 16,
                px: 0.5,
                fontSize: "0.625rem",
                boxShadow: (muiTheme) => `0 0 0 2px ${muiTheme.thingport.pageBackground}`,
              },
            }}
          >
            <NotificationsTwoToneIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              width: 380,
              maxWidth: "calc(100vw - 32px)",
              display: "flex",
              flexDirection: "column",
              maxHeight: 560,
            },
          },
        }}
      >
        {anchorEl && <NotificationDropdown onClose={handleClose} />}
      </Popover>
    </>
  );
}
