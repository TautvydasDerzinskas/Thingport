import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import DashboardCard from "./DashboardCard";

// A status-bar look: monospace, the time as the anchor, the date small and spaced out.
export const MONO_FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function greetingKey(hour: number): string {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

// As browsers with Belarusian data write them: months in the genitive, "8 мая".
const BE_SHORT_DATE = {
  weekdays: ["нд", "пн", "аў", "ср", "чц", "пт", "сб"],
  months: ["сту", "лют", "сак", "кра", "мая", "чэр", "ліп", "жні", "вер", "кас", "ліс", "сне"],
};

export function shortDate(language: string, now: Date) {
  // Chromium's ICU omits Belarusian, so its Intl formatter silently falls back to English.
  if (language === "be" && !Intl.DateTimeFormat.supportedLocalesOf([language]).length) {
    return {
      weekday: BE_SHORT_DATE.weekdays[now.getDay()],
      day: `${now.getDate()} ${BE_SHORT_DATE.months[now.getMonth()]}`,
    };
  }
  return {
    weekday: new Intl.DateTimeFormat(language, { weekday: "short" }).format(now),
    day: new Intl.DateTimeFormat(language, { month: "short", day: "numeric" }).format(now),
  };
}

/** Re-renders on each new minute, lined up with the wall clock rather than drifting from mount time. */
function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const schedule = () => {
      const next = new Date();
      timer = window.setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        60_000 - (next.getSeconds() * 1000 + next.getMilliseconds()),
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

type Props = {
  /** 12-hour shows AM/PM, smaller, after the time. */
  hourCycle: "12" | "24";
  showDate: boolean;
  showGreeting: boolean;
};

export default function ClockCard({ hourCycle, showDate, showGreeting }: Props) {
  const { t, i18n } = useTranslation("app");
  const now = useMinute();
  const parts = new Intl.DateTimeFormat(i18n.language, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: hourCycle === "12" ? "h12" : "h23",
  }).formatToParts(now);
  const time = parts
    .filter((part) => part.type !== "dayPeriod")
    .map((part) => part.value)
    .join("")
    .trim();
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value;
  const { weekday, day } = shortDate(i18n.language, now);

  return (
    <DashboardCard
      scroll={false}
      sx={{
        p: 3,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 0.75,
        fontFamily: MONO_FONT,
      }}
    >
      <Typography
        component="time"
        dateTime={now.toISOString()}
        sx={{
          fontFamily: "inherit",
          fontSize: "2.75rem",
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color: (theme) => theme.thingport.headingText,
        }}
      >
        {time}
        {dayPeriod && (
          <Box component="span" sx={{ fontSize: "0.4em", fontWeight: 500, letterSpacing: "0.04em", ml: 0.75 }}>
            {dayPeriod}
          </Box>
        )}
      </Typography>
      {showDate && (
        <Typography
          sx={{
            fontFamily: "inherit",
            fontSize: "0.8rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "text.secondary",
          }}
        >
          {`${weekday} · ${day}`}
        </Typography>
      )}
      {showGreeting && (
        <Typography sx={{ fontFamily: "inherit", fontSize: "0.75rem", color: "text.disabled" }}>
          {t(`dashboard.clock.greeting.${greetingKey(now.getHours())}`)}
        </Typography>
      )}
    </DashboardCard>
  );
}
