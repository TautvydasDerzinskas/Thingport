import React from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { UnauthorizedError } from "../../../api/client";
import { activityApi, type ActivitySummary } from "../../../api/activity";
import { dividerBorderColor } from "../../../theme";
import Heatmap from "./Heatmap";
import Timeline from "./Timeline";
import { lastYearRange, localToday, yearRange } from "./calendar";

type Props = {
  onUnauthorized?: () => void;
};

/** The signed-in user's own activity, as a year of days. Opens on the last 12 months, like GitHub. */
export default function ActivitySection({ onUnauthorized }: Props) {
  const { t } = useTranslation("app");
  // Null is the last 12 months; a year is that calendar year.
  const [year, setYear] = React.useState<number | null>(null);
  // A day picked on the heatmap, which the timeline starts from.
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const today = localToday();
  const thisYear = Number(today.slice(0, 4));
  // Tagged with the range it's for, so switching years never shows the last one's numbers.
  const [loaded, setLoaded] = React.useState<{ key: string; data: ActivitySummary } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const range = React.useMemo(() => (year === null ? lastYearRange(localToday()) : yearRange(year)), [year]);
  const rangeKey = `${range.from}/${range.to}`;
  const summary = loaded?.key === rangeKey ? loaded.data : null;
  // The timeline runs back from the end of the range, but never from a month still to come.
  const startMonth = (selectedDay ?? [range.to, today].toSorted()[0]).slice(0, 7);

  const selectDay = (date: string) => {
    // Picking it again goes back to the whole range.
    setSelectedDay((current) => (current === date ? null : date));
    timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const selectYear = (next: number) => {
    // This year is the default view, the last 12 months, as on GitHub.
    setYear(next === thisYear ? null : next);
    setSelectedDay(null);
  };

  React.useEffect(() => {
    let active = true;
    setError(null);
    activityApi
      .get(range.from, range.to)
      .then((data) => {
        if (active) setLoaded({ key: `${range.from}/${range.to}`, data });
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof UnauthorizedError) onUnauthorized?.();
        else setError(t("activity.loadError"));
      });
    return () => {
      active = false;
    };
  }, [range, onUnauthorized, t]);

  // The year list comes with the first answer; until then, this year.
  const years = loaded?.data.years ?? [thisYear];

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Stack direction={{ xs: "column-reverse", md: "row" }} spacing={2} alignItems="flex-start">
        <Box sx={{ minWidth: 0, maxWidth: "100%" }}>
          <Typography variant="h6" sx={{ mb: 1, color: (theme) => theme.thingport.headingText }}>
            {summary
              ? year === null
                ? t("activity.totalLastYear", { count: summary.total })
                : t("activity.totalInYear", { count: summary.total, year })
              : " "}
          </Typography>
          <Paper
            variant="outlined"
            sx={{ p: 2, borderColor: dividerBorderColor, display: "inline-block", maxWidth: "100%" }}
          >
            {/* Drawn straight away from the range alone, so the counts fill in without a jump. */}
            <Heatmap
              range={range}
              days={summary?.days ?? []}
              selectedDay={selectedDay}
              today={today}
              onSelectDay={selectDay}
            />
          </Paper>
          {/* Clear of the sticky top bar when scrolled to. Zero width with a 100% minimum: as wide as
              the heatmap, so a long model name is cut short rather than widening the page. */}
          <Box
            ref={timelineRef}
            sx={{ mt: 3, width: 0, minWidth: "100%", scrollMarginTop: "calc(var(--topbar-height, 64px) + 8px)" }}
          >
            <Timeline
              startMonth={startMonth}
              fromDay={selectedDay}
              onClearDay={() => setSelectedDay(null)}
              onUnauthorized={onUnauthorized}
            />
          </Box>
        </Box>
        <Stack
          direction={{ xs: "row", md: "column" }}
          spacing={0.5}
          aria-label={t("activity.years") ?? undefined}
          sx={{ flexWrap: "wrap", pt: { md: 5 } }}
        >
          {years.map((y) => (
            <Button
              key={y}
              size="small"
              variant={(year ?? thisYear) === y ? "contained" : "text"}
              aria-pressed={(year ?? thisYear) === y}
              onClick={() => selectYear(y)}
              sx={{ minWidth: 72, justifyContent: "flex-start" }}
            >
              {y}
            </Button>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}
