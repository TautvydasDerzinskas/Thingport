import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MonitorHeartOutlinedIcon from "@mui/icons-material/MonitorHeartOutlined";
import { UnauthorizedError } from "../../api/client";
import { dashboardApi, type MonitorResult, type SystemStats } from "../../api/dashboard";
import { ListRowSkeletons } from "../../components/ListSkeleton";
import DashboardCard, { DashboardCardBody, DashboardCardTitle } from "./DashboardCard";
import { usePolling } from "./usePolling";

// For screen readers only.
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

// The server rechecks an address at most every 30 seconds; a minute keeps the panel current without the noise.
const REFRESH_MS = 60 * 1000;

/** Seconds as the two largest units: "3d 4h", "5h 12m", "12m". */
export function formatDuration(t: TFunction, seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return t("dashboard.uptime.days", { days, hours });
  if (hours) return t("dashboard.uptime.hours", { hours, minutes });
  return t("dashboard.uptime.minutes", { minutes });
}

/** The address as people say it: its host, and its path when there is one. */
function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.host}${path}`;
  } catch {
    return value;
  }
}

type Props = {
  urls: string[];
  /** How long Thingport and its host have been running; admins only. */
  showServer: boolean;
  onUnauthorized?: () => void;
};

/** Whether each listed service answers, and how quickly; and for admins, how long the server has been up. */
export default function UptimeCard({ urls, showServer, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [results, setResults] = useState<MonitorResult[] | null>(null);
  const [server, setServer] = useState<SystemStats["uptime"] | null>(null);
  const [failed, setFailed] = useState(false);

  usePolling(
    () => {
      const fail = (err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setFailed(true);
      };
      if (urls.length)
        dashboardApi
          .getMonitors(urls)
          .then((value) => {
            setResults(value);
            setFailed(false);
          })
          .catch(fail);
      if (showServer)
        dashboardApi
          .getSystem()
          .then((value) => setServer(value.uptime))
          .catch(fail);
    },
    REFRESH_MS,
    urls.length || showServer ? `${showServer}\n${urls.join("\n")}` : "",
  );

  const up = results?.filter((result) => result.up).length ?? 0;

  let monitors: React.ReactNode = null;
  if (urls.length && failed && !results)
    monitors = <Typography color="text.secondary">{t("dashboard.uptime.loadError")}</Typography>;
  else if (urls.length && !results)
    monitors = <ListRowSkeletons count={Math.min(urls.length, 4)} lead={null} trailing />;
  else if (results)
    monitors = (
      <List dense disablePadding>
        {results.map((result) => (
          <ListItem key={result.url} sx={{ px: 1, gap: 1.25 }}>
            <Tooltip title={t(result.up ? "dashboard.uptime.up" : "dashboard.uptime.down")}>
              <Box
                aria-hidden
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flexShrink: 0,
                  bgcolor: result.up ? "success.main" : "error.main",
                  boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.text.primary, 0.06)}`,
                }}
              />
            </Tooltip>
            {/* The dot's meaning, for screen readers. */}
            <Box component="span" sx={visuallyHidden}>
              {t(result.up ? "dashboard.uptime.up" : "dashboard.uptime.down")}
            </Box>
            <Typography variant="body2" noWrap title={result.url} sx={{ flex: 1, minWidth: 0 }}>
              {shortUrl(result.url)}
            </Typography>
            <Typography
              variant="body2"
              color={result.up ? "text.secondary" : "error.main"}
              sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
            >
              {result.up
                ? t("dashboard.uptime.ms", { ms: result.ms })
                : result.status
                  ? t("dashboard.uptime.status", { status: result.status })
                  : t("dashboard.uptime.down")}
            </Typography>
          </ListItem>
        ))}
      </List>
    );

  return (
    <DashboardCard scroll={false} sx={{ p: 2.5, display: "flex", flexDirection: "column" }}>
      <DashboardCardTitle
        icon={<MonitorHeartOutlinedIcon />}
        title={t("dashboard.uptime.title")}
        sx={{ mb: 1, flexShrink: 0 }}
      >
        {results && results.length > 0 && (
          <Typography
            variant="body2"
            color={up === results.length ? "success.main" : "error.main"}
            sx={{ flexShrink: 0, fontWeight: 600 }}
          >
            {t("dashboard.uptime.summary", { up, total: results.length })}
          </Typography>
        )}
      </DashboardCardTitle>
      {showServer && server && (
        <Box sx={{ display: "flex", gap: 2, px: 1, mb: urls.length ? 1 : 0, flexShrink: 0, flexWrap: "wrap" }}>
          <Typography variant="body2" color="text.secondary">
            {t("dashboard.uptime.thingport")}{" "}
            <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
              {formatDuration(t, server.thingport)}
            </Box>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("dashboard.uptime.host")}{" "}
            <Box component="span" sx={{ color: "text.primary", fontWeight: 600 }}>
              {formatDuration(t, server.host)}
            </Box>
          </Typography>
        </Box>
      )}
      <DashboardCardBody>
        {!urls.length && !showServer ? (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {t("dashboard.uptime.empty")}
          </Typography>
        ) : (
          monitors
        )}
      </DashboardCardBody>
    </DashboardCard>
  );
}
