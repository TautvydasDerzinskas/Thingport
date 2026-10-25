import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import NewReleasesIcon from "@mui/icons-material/NewReleases";
import { dashboardApi, type DashboardModel } from "../../api/dashboard";
import DashboardModelThumb from "./DashboardModelThumb";
import SeeMoreDialog from "./SeeMoreDialog";
import DashboardCard, { DashboardCardBody, DashboardCardTitle, hasMore } from "./DashboardCard";

type Props = {
  models: DashboardModel[];
  /** How many rows show; the summary holds more. */
  count: number;
  showMore: boolean;
};

export function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return t("notifications.justNow");
  if (minutes < 60) return t("notifications.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("notifications.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("notifications.daysAgo", { count: days });
}

function RecentRow({ model, onClick }: { model: DashboardModel; onClick: () => void }) {
  const { t } = useTranslation("app");
  return (
    <ListItemButton onClick={onClick} sx={{ borderRadius: 1, px: 1 }}>
      <DashboardModelThumb model={model} />
      <ListItemText primary={model.name} primaryTypographyProps={{ noWrap: true }} />
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, pl: 1 }}>
        {relativeTime(model.created_at, t)}
      </Typography>
    </ListItemButton>
  );
}

export default function RecentlyAddedCard({ models, count, showMore }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <DashboardCard scroll={false} sx={{ p: 2.5, display: "flex", flexDirection: "column" }}>
      <DashboardCardTitle
        icon={<NewReleasesIcon />}
        title={t("dashboard.recentlyAdded.title")}
        sx={{ mb: 1, flexShrink: 0 }}
      />

      <DashboardCardBody>
        {models.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {t("dashboard.recentlyAdded.empty")}
          </Typography>
        ) : (
          <List dense disablePadding>
            {models.slice(0, count).map((model) => (
              <RecentRow key={model.id} model={model} onClick={() => navigate(`/models/${model.id}`)} />
            ))}
          </List>
        )}
      </DashboardCardBody>

      {showMore && hasMore(models.length, count) && (
        <Button onClick={() => setDialogOpen(true)} sx={{ alignSelf: "flex-start", mt: 1, flexShrink: 0 }}>
          {t("dashboard.seeMore")}
        </Button>
      )}

      <SeeMoreDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t("dashboard.recentlyAdded.title")}
        emptyText={t("dashboard.recentlyAdded.empty")}
        fetcher={dashboardApi.getRecentlyAdded}
        getKey={(model) => model.id}
        renderItem={(model) => (
          <RecentRow
            model={model}
            onClick={() => {
              setDialogOpen(false);
              navigate(`/models/${model.id}`);
            }}
          />
        )}
      />
    </DashboardCard>
  );
}
