import { useState } from "react";
import { useTranslation } from "react-i18next";
import { alpha } from "@mui/material/styles";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Skeleton from "@mui/material/Skeleton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MemoryIcon from "@mui/icons-material/Memory";
import { ForbiddenError, UnauthorizedError } from "../../api/client";
import { dashboardApi, type SystemStats } from "../../api/dashboard";
import DashboardCard, { DashboardCardTitle } from "./DashboardCard";
import { usePolling } from "./usePolling";

const REFRESH_MS = 5000;
// The last two and a half minutes, at one reading every five seconds.
const HISTORY = 30;

const gigabytes = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

type Props = {
  showLoad: boolean;
  showMemory: boolean;
  onUnauthorized?: () => void;
};

/** The server's CPU, as a figure and a short history, with its load average and memory. Admins only. */
export default function CpuCard({ showLoad, showMemory, onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [problem, setProblem] = useState<"forbidden" | "failed" | null>(null);

  usePolling(
    () => {
      dashboardApi
        .getSystem()
        .then((value) => {
          setStats(value);
          setProblem(null);
          setHistory((previous) => [...previous, value.cpu.usage].slice(-HISTORY));
        })
        .catch((err: unknown) => {
          if (err instanceof UnauthorizedError) onUnauthorized?.();
          else setProblem(err instanceof ForbiddenError ? "forbidden" : "failed");
        });
    },
    REFRESH_MS,
    "cpu",
  );

  let body: React.ReactNode;
  if (problem && !stats)
    body = (
      <Typography color="text.secondary">
        {t(problem === "forbidden" ? "dashboard.cpu.adminsOnly" : "dashboard.cpu.loadError")}
      </Typography>
    );
  else if (!stats)
    body = (
      <>
        <Skeleton variant="text" sx={{ fontSize: "2.5rem", width: "35%" }} />
        <Skeleton variant="rounded" sx={{ flex: 1, minHeight: 32 }} />
      </>
    );
  else {
    const memory = stats.memory.total ? (stats.memory.used / stats.memory.total) * 100 : 0;
    body = (
      <>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: "2.5rem",
              fontWeight: 700,
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
              color: (theme) => theme.thingport.headingText,
            }}
          >
            {`${Math.round(stats.cpu.usage)}%`}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap title={stats.cpu.model ?? undefined}>
            {t("dashboard.cpu.cores", { count: stats.cpu.cores })}
          </Typography>
        </Box>
        {/* The history, oldest on the left, each bar one reading; it fills in from the right as readings come. */}
        <Box
          aria-hidden
          sx={{
            flex: 1,
            minHeight: 24,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            gap: "2px",
          }}
        >
          {history.map((value, index) => (
            <Box
              key={index}
              sx={(theme) => ({
                flex: `0 0 calc((100% - ${(HISTORY - 1) * 2}px) / ${HISTORY})`,
                height: `${Math.max(2, value)}%`,
                borderRadius: "2px 2px 0 0",
                bgcolor:
                  index === history.length - 1 ? theme.palette.primary.main : alpha(theme.palette.primary.main, 0.45),
                transition: "height 300ms ease",
                "@media (prefers-reduced-motion: reduce)": { transition: "none" },
              })}
            />
          ))}
        </Box>
        {showLoad && (
          <Tooltip title={t("dashboard.cpu.loadHint")}>
            <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {t("dashboard.cpu.load", { values: stats.cpu.load.map((value) => value.toFixed(2)).join(" · ") })}
            </Typography>
          </Tooltip>
        )}
        {showMemory && (
          <Box>
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {t("dashboard.cpu.memory")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {t("dashboard.cpu.memoryUsed", {
                  used: gigabytes(stats.memory.used),
                  total: gigabytes(stats.memory.total),
                })}
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={memory}
              aria-label={t("dashboard.cpu.memory")}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>
        )}
      </>
    );
  }

  return (
    <DashboardCard scroll={false} sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1 }}>
      <DashboardCardTitle icon={<MemoryIcon />} title={t("dashboard.cpu.title")} sx={{ flexShrink: 0 }} />
      {body}
    </DashboardCard>
  );
}
