import { useState } from "react";
import { useTranslation } from "react-i18next";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import { UnauthorizedError } from "../../api/client";
import { dashboardApi, type FeedItem } from "../../api/dashboard";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import DashboardCard, { DashboardCardBody, DashboardCardTitle } from "./DashboardCard";
import { relativeTime } from "./RecentlyAddedCard";
import { usePolling } from "./usePolling";

// The server keeps each feed ten minutes, so asking more often only gets the same items.
const REFRESH_MS = 10 * 60 * 1000;

type Props = {
  /** The user's own name for the panel; empty shows the default. */
  title: string;
  feeds: string[];
  count: number;
  showDates: boolean;
  onUnauthorized?: () => void;
};

/** The newest items of every feed the user listed, together. An item opens in a new tab. */
export default function RssCard({ title, feeds, count, showDates, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [result, setResult] = useState<{ items: FeedItem[]; failed: string[] } | null>(null);
  const [error, setError] = useState(false);

  usePolling(
    () => {
      dashboardApi
        .getFeeds(feeds)
        .then((value) => {
          setResult(value);
          setError(false);
        })
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setError(true);
        });
    },
    REFRESH_MS,
    feeds.join("\n"),
  );

  let body: React.ReactNode;
  if (!feeds.length)
    body = (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        {t("dashboard.rss.empty")}
      </Typography>
    );
  else if (error && !result)
    body = (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        {t("dashboard.rss.loadError")}
      </Typography>
    );
  else if (!result) body = <ListRowSkeletons count={Math.min(count, 4)} lead={null} twoLines={showDates} />;
  else if (!result.items.length)
    body = (
      <Typography color="text.secondary" sx={{ py: 2 }}>
        {t("dashboard.rss.noItems")}
      </Typography>
    );
  else
    body = (
      <List dense disablePadding>
        {result.items.slice(0, count).map((item, index) => {
          const secondary = [
            feeds.length > 1 ? item.feed : null,
            showDates && item.published ? relativeTime(item.published, t) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <ListItemButton
              key={`${item.link ?? item.title}-${index}`}
              component="a"
              href={item.link ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              disabled={!item.link}
              sx={{ borderRadius: 1, px: 1 }}
            >
              <ListItemText
                primary={item.title}
                secondary={secondary || undefined}
                primaryTypographyProps={{ noWrap: true, title: item.title }}
                secondaryTypographyProps={{ noWrap: true }}
              />
            </ListItemButton>
          );
        })}
      </List>
    );

  return (
    <DashboardCard scroll={false} sx={{ p: 2.5, display: "flex", flexDirection: "column" }}>
      <DashboardCardTitle
        icon={<RssFeedIcon />}
        title={title || t("dashboard.rss.title")}
        sx={{ mb: 1, flexShrink: 0 }}
      >
        {result && result.failed.length > 0 && (
          <Tooltip title={result.failed.join("\n")}>
            <Typography variant="caption" color="warning.main" sx={{ flexShrink: 0, cursor: "help" }}>
              {t("dashboard.rss.failed", { count: result.failed.length })}
            </Typography>
          </Tooltip>
        )}
      </DashboardCardTitle>
      <DashboardCardBody>{body}</DashboardCardBody>
    </DashboardCard>
  );
}
