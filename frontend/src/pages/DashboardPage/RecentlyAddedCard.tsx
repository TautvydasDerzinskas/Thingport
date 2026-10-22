import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import NewReleasesIcon from "@mui/icons-material/NewReleases";
import type { DashboardModel } from "../../api/dashboard";
import DashboardModelThumb from "./DashboardModelThumb";
import DashboardCard, { DashboardCardTitle } from "./DashboardCard";

type Props = {
  models: DashboardModel[];
};

function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return t("notifications.justNow");
  if (minutes < 60) return t("notifications.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t("notifications.hoursAgo", { count: hours });
  const days = Math.round(hours / 24);
  return t("notifications.daysAgo", { count: days });
}

export default function RecentlyAddedCard({ models }: Props) {
  const { t } = useTranslation("app");
  const navigate = useNavigate();

  return (
    <DashboardCard sx={{ p: 2.5, display: "flex", flexDirection: "column" }}>
      <DashboardCardTitle icon={<NewReleasesIcon />} title={t("dashboard.recentlyAdded.title")} sx={{ mb: 1 }} />

      {models.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          {t("dashboard.recentlyAdded.empty")}
        </Typography>
      ) : (
        <List dense disablePadding>
          {models.map((model) => (
            <ListItemButton
              key={model.id}
              onClick={() => navigate(`/models/${model.id}`)}
              sx={{ borderRadius: 1, px: 1 }}
            >
              <DashboardModelThumb model={model} />
              <ListItemText primary={model.name} primaryTypographyProps={{ noWrap: true }} />
              <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, pl: 1 }}>
                {relativeTime(model.created_at, t)}
              </Typography>
            </ListItemButton>
          ))}
        </List>
      )}
    </DashboardCard>
  );
}
