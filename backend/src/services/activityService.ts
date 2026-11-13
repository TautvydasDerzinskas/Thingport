import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { MODEL_SUMMARY_SELECT, toModelSummary } from "./dashboardService";
import { scheduleAchievementCheck } from "./achievementService";

// Kept in sync by hand with the frontend's ActivityKind.
// In the order the timeline and its tooltips list them.
export const ACTIVITY_KINDS = ["import", "upload", "download", "slicer", "delete"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Fire-and-forget, like createLog: a failure here must never break the action it records. `name` is
 *  what the timeline shows once the model is deleted. */
export async function recordActivity(
  userId: string,
  kind: ActivityKind,
  printId?: string | null,
  name?: string | null,
): Promise<void> {
  try {
    await prisma.activity.create({ data: { userId, kind, printId: printId ?? null, name: name ?? null } });
    // Downloads, imports and models made (by a tool or in Studio, which come in as uploads) earn achievements.
    if (kind === "download" || kind === "import" || kind === "upload") scheduleAchievementCheck(userId);
  } catch (err) {
    console.error("[activity] Failed to record:", err);
  }
}

/** Falls back to UTC for a zone Node doesn't know, so the query below never gets an invalid one. */
export function safeTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    return new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function yearIn(date: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat("en", { timeZone: tz, year: "numeric" }).format(date));
}

export type ActivityDay = { date: string; counts: Partial<Record<ActivityKind, number>> };

/**
 * Per-day counts between two dates (inclusive, YYYY-MM-DD), the days taken in the viewer's time
 * zone so a late-evening download lands on the day they did it. Days without activity are left out.
 */
export async function getActivity(
  userId: string,
  from: string,
  to: string,
  tz: string,
): Promise<{ days: ActivityDay[]; total: number; years: number[] }> {
  const rows = await prisma.$queryRaw<{ day: string; kind: ActivityKind; count: number }[]>`
    SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
           "kind",
           count(*)::int AS count
    FROM "Activity"
    WHERE "userId" = ${userId}
      AND (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date
    GROUP BY 1, 2
    ORDER BY 1`;

  const byDay = new Map<string, ActivityDay>();
  let total = 0;
  for (const row of rows) {
    const day = byDay.get(row.day) ?? { date: row.day, counts: {} };
    day.counts[row.kind] = row.count;
    byDay.set(row.day, day);
    total += row.count;
  }

  // From the year they registered to this one: there's nothing to show before or after.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  const thisYear = yearIn(new Date(), tz);
  const firstYear = Math.min(user ? yearIn(user.createdAt, tz) : thisYear, thisYear);
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i);

  return { days: [...byDay.values()], total, years };
}

export type ActivityItem = {
  printId: string | null;
  /** The model's name now, or as it was when deleted; null for an import job's model with no record. */
  name: string | null;
  thumbUrl: string | null;
  /** False once the model is deleted: shown by name only, not linked. */
  exists: boolean;
  count: number;
  lastAt: Date;
};

export type ActivityGroup = { kind: ActivityKind; total: number; items: ActivityItem[] };

// One row per model per kind; a month of bulk imports stays a manageable answer.
const MONTH_ITEMS_MAX = 1000;

/**
 * One month (YYYY-MM, in the viewer's zone) of activity for the timeline, grouped by kind and then
 * by model, newest first, with the month before it that has any, so empty months are skipped.
 * `until` (YYYY-MM-DD) leaves out the days after it, for a timeline started from a chosen day.
 */
export async function getActivityMonth(
  userId: string,
  month: string,
  tz: string,
  until?: string,
): Promise<{ groups: ActivityGroup[]; nextMonth: string | null }> {
  const untilFilter = until
    ? Prisma.sql`AND (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date <= ${until}::date`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { kind: ActivityKind; printId: string | null; name: string | null; count: number; lastAt: Date }[]
  >`
    SELECT "kind", "printId", max("name") AS name, count(*)::int AS count, max("createdAt") AS "lastAt"
    FROM "Activity"
    WHERE "userId" = ${userId}
      AND to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') = ${month}
      ${untilFilter}
    GROUP BY "kind", "printId", CASE WHEN "printId" IS NULL THEN "name" END
    ORDER BY "lastAt" DESC
    LIMIT ${MONTH_ITEMS_MAX}`;

  const printIds = [...new Set(rows.map((row) => row.printId).filter((id): id is string => id !== null))];
  const prints = await prisma.print.findMany({ where: { userId, id: { in: printIds } }, select: MODEL_SUMMARY_SELECT });
  const byId = new Map(prints.map((print) => [print.id, toModelSummary(print)]));

  const groups = new Map<ActivityKind, ActivityGroup>();
  for (const row of rows) {
    const print = row.printId ? byId.get(row.printId) : undefined;
    const group = groups.get(row.kind) ?? { kind: row.kind, total: 0, items: [] };
    group.total += row.count;
    group.items.push({
      printId: row.printId,
      name: print?.name ?? row.name,
      thumbUrl: print?.thumbUrl ?? null,
      exists: Boolean(print),
      count: row.count,
      lastAt: row.lastAt,
    });
    groups.set(row.kind, group);
  }

  const [before] = await prisma.$queryRaw<{ month: string | null }[]>`
    SELECT to_char(max(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}), 'YYYY-MM') AS month
    FROM "Activity"
    WHERE "userId" = ${userId}
      AND (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}) < (${month} || '-01')::timestamp`;

  return {
    groups: ACTIVITY_KINDS.flatMap((kind) => groups.get(kind) ?? []),
    nextMonth: before?.month ?? null,
  };
}
