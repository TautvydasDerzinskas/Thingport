import React from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { alpha, type Theme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import SyncIcon from "@mui/icons-material/Sync";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import FolderSharedOutlinedIcon from "@mui/icons-material/FolderSharedOutlined";
import type { Notification, NotificationType } from "../../api/notifications";
import { isNew } from "./useNotificationFeed";
import { notificationTitle } from "./notificationTitle";

type Palette = "primary" | "info" | "warning" | "secondary" | "success" | "error";

const TYPE_STYLE: Record<NotificationType, { Icon: typeof SyncIcon; color: Palette | null }> = {
  import: { Icon: CloudDownloadOutlinedIcon, color: "primary" },
  upload: { Icon: CloudUploadOutlinedIcon, color: "primary" },
  sync: { Icon: SyncIcon, color: "info" },
  queue: { Icon: HourglassEmptyIcon, color: "warning" },
  consume: { Icon: MoveToInboxOutlinedIcon, color: "success" },
  ai: { Icon: AutoAwesomeOutlinedIcon, color: "secondary" },
  system: { Icon: CampaignOutlinedIcon, color: "error" },
  chat: { Icon: ChatBubbleOutlineIcon, color: "info" },
  federation: { Icon: HubOutlinedIcon, color: "success" },
  share: { Icon: FolderSharedOutlinedIcon, color: "primary" },
  general: { Icon: NotificationsNoneIcon, color: null },
};

function typeColor(theme: Theme, color: Palette | null): string {
  return color ? theme.palette[color].main : theme.palette.text.secondary;
}

/** Shows where an outside link goes, e.g. "makerworld.com". */
function linkHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

type Group = { key: string; label: string; items: Notification[] };

/** Today, Yesterday, then one group per date, in the order the items come (newest first). */
function groupByDay(items: Notification[], t: TFunction, locale: string): Group[] {
  const today = startOfDay(new Date());
  const yesterday = today - 24 * 60 * 60 * 1000;
  const dateFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
  const groups: Group[] = [];
  for (const item of items) {
    const created = new Date(item.created_at);
    const day = startOfDay(created);
    const key = String(day);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label =
        day === today
          ? t("notifications.today")
          : day === yesterday
            ? t("notifications.yesterday")
            : dateFormat.format(created);
      group = { key, label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** Relative today ("5 minutes ago"); the time of day for older ones, whose date is the group heading. */
function timeLabel(iso: string, t: TFunction, locale: string): string {
  const created = new Date(iso);
  if (startOfDay(created) !== startOfDay(new Date())) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(created);
  }
  const minutes = Math.round((Date.now() - created.getTime()) / 60_000);
  if (minutes < 1) return t("notifications.justNow");
  if (minutes < 60) return t("notifications.minutesAgo", { count: minutes });
  return t("notifications.hoursAgo", { count: Math.round(minutes / 60) });
}

function NotificationRow({
  notification,
  highlighted,
  locale,
  onOpen,
  onDelete,
}: {
  notification: Notification;
  /** New when the list was opened. */
  highlighted: boolean;
  locale: string;
  onOpen: (notification: Notification) => void;
  onDelete: (notification: Notification) => void;
}) {
  const { t } = useTranslation("app");
  const { Icon, color } = TYPE_STYLE[notification.type] ?? TYPE_STYLE.general;
  const clickable = Boolean(notification.internal_path);

  return (
    <Box
      sx={{
        position: "relative",
        borderRadius: 1.5,
        "&:hover": { bgcolor: "action.hover" },
        // The delete button only shows on hover where there is one; touch screens always show it.
        "@media (hover: hover)": {
          "& .notification-delete": { opacity: 0 },
          "&:hover .notification-delete, &:focus-within .notification-delete": { opacity: 1 },
        },
      }}
    >
      <Box
        role={clickable ? "link" : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onOpen(notification) : undefined}
        onKeyDown={
          clickable
            ? (event: React.KeyboardEvent) => {
                if (event.key === "Enter") onOpen(notification);
              }
            : undefined
        }
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1.5,
          p: 1.25,
          pr: 5,
          borderRadius: 1.5,
          cursor: clickable ? "pointer" : "default",
          outline: "none",
          "&:focus-visible": { boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}` },
        }}
      >
        <Box
          sx={(theme) => ({
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: typeColor(theme, color),
            bgcolor: alpha(typeColor(theme, color), 0.14),
          })}
        >
          <Icon sx={{ fontSize: 19 }} />
        </Box>
        <Stack spacing={0.25} sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={highlighted ? 700 : 500} sx={{ wordBreak: "break-word" }}>
            {notificationTitle(notification, t)}
          </Typography>
          {notification.body && (
            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-word" }}>
              {notification.body}
            </Typography>
          )}
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="caption" color="text.disabled">
              {timeLabel(notification.created_at, t, locale)}
            </Typography>
            {notification.external_url && (
              <Link
                href={notification.external_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, fontSize: 12 }}
              >
                {linkHost(notification.external_url) ?? t("notifications.viewSource")}
                <OpenInNewIcon sx={{ fontSize: 12 }} />
              </Link>
            )}
          </Stack>
        </Stack>
      </Box>
      <Tooltip title={t("notifications.delete")}>
        <IconButton
          className="notification-delete"
          size="small"
          aria-label={t("notifications.delete")}
          onClick={() => onDelete(notification)}
          sx={{ position: "absolute", top: 6, right: 6, transition: "opacity 120ms" }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

type Props = {
  items: Notification[];
  /** When the list was opened; items read since then still show as new. */
  since: string | null;
  onOpen: (notification: Notification) => void;
  onDelete: (notification: Notification) => void;
};

/** Notifications grouped by day under small headings, the way the bell and the full page both show them. */
export default function NotificationList({ items, since, onOpen, onDelete }: Props) {
  const { t, i18n } = useTranslation("app");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const groups = React.useMemo(() => groupByDay(items, t, locale), [items, t, locale]);

  return (
    <Stack spacing={1.5}>
      {groups.map((group) => (
        <Box key={group.key}>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: "block", px: 1.25, lineHeight: 2, letterSpacing: "0.08em" }}
          >
            {group.label}
          </Typography>
          <Stack spacing={0.25}>
            {group.items.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                highlighted={isNew(notification, since)}
                locale={locale}
                onOpen={onOpen}
                onDelete={onDelete}
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
