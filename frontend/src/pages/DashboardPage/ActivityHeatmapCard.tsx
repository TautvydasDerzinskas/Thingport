import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import InsightsIcon from "@mui/icons-material/Insights";
import { activityApi, type ActivityDay } from "../../api/activity";
import { UnauthorizedError } from "../../api/client";
import Heatmap from "../ProfilePage/activity/Heatmap";
import { addDays, localToday, weekday, weekStartFor, type DateRange } from "../ProfilePage/activity/calendar";
import DashboardCard, { DashboardCardTitle } from "./DashboardCard";

// The heatmap's cell and gap, and room for its weekday labels.
const WEEK_WIDTH = 14;
const LABELS_WIDTH = 40;
const MIN_WEEKS = 8;
const MAX_WEEKS = 53;

/** The last `weeks` whole columns up to today, each starting on `weekStart`. */
function recentRange(today: string, weeks: number, weekStart: 0 | 1): DateRange {
  const intoWeek = (weekday(today) - weekStart + 7) % 7;
  return { from: addDays(today, -intoWeek - (weeks - 1) * 7), to: today };
}

type Props = { onUnauthorized?: () => void };

/** The profile's heatmap, cut to as many recent weeks as the card is wide. A day opens it on the profile. */
export default function ActivityHeatmapCard({ onUnauthorized }: Props) {
  const { t, i18n } = useTranslation("app");
  const navigate = useNavigate();
  const today = localToday();
  const weekStart = weekStartFor(i18n.language);
  const [days, setDays] = useState<ActivityDay[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [weeks, setWeeks] = useState<number | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = measureRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const fit = Math.floor((entry.contentRect.width - LABELS_WIDTH) / WEEK_WIDTH);
      setWeeks(Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, fit)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The widest range the card can show, once, so resizing only changes how much of it shows. MAX_WEEKS
  // whole columns reach up to six days further back than a year.
  useEffect(() => {
    let active = true;
    const to = localToday();
    activityApi
      .get(addDays(to, -(MAX_WEEKS * 7 - 1)), to)
      .then((data) => {
        if (active) setDays(data.days);
      })
      .catch((err: unknown) => {
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [onUnauthorized]);

  const range = useMemo(() => (weeks ? recentRange(today, weeks, weekStart) : null), [today, weeks, weekStart]);
  const total = useMemo(
    () =>
      range && days
        ? days
            .filter((day) => day.date >= range.from && day.date <= range.to)
            .reduce((sum, day) => sum + Object.values(day.counts).reduce((n, c) => n + (c ?? 0), 0), 0)
        : null,
    [days, range],
  );

  return (
    // It narrows to the weeks that fit, never taller, so there's nothing to scroll; the tighter padding fits it at its
    // minimum height.
    <DashboardCard scroll={false} sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
      <DashboardCardTitle icon={<InsightsIcon />} title={t("dashboard.activityHeatmap.title")}>
        {total !== null && (
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
            {t("dashboard.activityHeatmap.total", { count: total })}
          </Typography>
        )}
      </DashboardCardTitle>
      <Box ref={measureRef} sx={{ minWidth: 0 }}>
        {failed ? (
          <Typography color="text.secondary">{t("activity.loadError")}</Typography>
        ) : (
          // Drawn straight away from the range alone, so the counts fill in without a jump.
          range && (
            <Heatmap
              range={range}
              days={days ?? []}
              selectedDay={null}
              today={today}
              onSelectDay={(date) => navigate(`/profile?day=${date}`)}
            />
          )
        )}
      </Box>
    </DashboardCard>
  );
}
