import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  BADGES,
  REGULAR_MIN_DAYS,
  REGULAR_WINDOW_DAYS,
  SECRETS,
  badgeDef,
  badgeRank,
  type BadgeDef,
} from "./achievementCatalog";
import { createNotification } from "./notificationService";
import { getAchievementSettings } from "./settingsService";

// Achievements: badges for what a user has done in Thingport, at tiers that only go up. Everything they count is
// already kept for its own sake (Activity, the models and their Print.createdWith, collection syncs), bar the days
// someone used Thingport, so turning them on finds what was earned before, told in one notification. A badge is
// raised in the background a moment after what may have earned it (scheduleAchievementCheck), and the app shows the
// ones it hasn't yet (seenAt null) as they come. Secrets aren't counted: a widget or tool gives them away
// (claimSecret).

const DAY_MS = 24 * 60 * 60 * 1000;
/** Long enough for an import's burst of models to land as one check. */
const CHECK_DELAY_MS = 1500;
/** Active days kept: the Regular badge reads the last 30. */
const KEEP_DAYS = 40;

/** As others see it: on their profile, on partner instances. */
export type AchievementOut = {
  id: string;
  tier: number;
  earned_at: string;
  /** A badge that lapses (Regular) no longer holding: shown grey. */
  expired?: boolean;
};

/** As its owner sees it, with how far the next tier is. */
export type OwnAchievementOut = AchievementOut & {
  /** What it counts, now; null for a secret. */
  count: number | null;
  /** The next tier's threshold, null at the top. */
  next: number | null;
  /** Shown to them reaching this tier yet. */
  seen: boolean;
};

const startOfUtcDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
/** The first of the Regular badge's 30 days, today being the last. */
const regularSince = (now = new Date()) => new Date(startOfUtcDay(now).getTime() - (REGULAR_WINDOW_DAYS - 1) * DAY_MS);

// Copies keep their original's source (modelCopyService, remoteCopy), so they'd count as imports of their own.
const NOT_A_COPY: Prisma.PrintWhereInput = { originalId: null, remoteSource: { equals: Prisma.DbNull } };

/** What every badge counts for `userId`, by badge id. */
async function countsFor(userId: string): Promise<Map<string, number>> {
  const [downloads, importsDone, imported, bySite, byTool, studio, syncs, days] = await Promise.all([
    prisma.activity.count({ where: { userId, kind: "download" } }),
    prisma.activity.count({ where: { userId, kind: "import" } }),
    prisma.print.count({ where: { userId, sourceProvider: { not: null }, ...NOT_A_COPY } }),
    prisma.print.groupBy({
      by: ["sourceProvider"],
      where: { userId, sourceProvider: { not: null }, ...NOT_A_COPY },
      _count: true,
    }),
    prisma.print.groupBy({ by: ["createdWithRef"], where: { userId, createdWith: "tool" }, _count: true }),
    prisma.print.count({ where: { userId, createdWith: "studio" } }),
    prisma.collectionSync.findMany({ where: { userId }, select: { collectionId: true, provider: true } }),
    prisma.userActiveDay.count({ where: { userId, day: { gte: regularSince() } } }),
  ]);
  const counts = new Map<string, number>([
    ["downloads", downloads],
    // Imports recorded since activity was, or the imported models there are, whichever is more: models imported
    // before then still count, and so do ones since deleted.
    ["imports", Math.max(importsDone, imported)],
    ["studio", studio],
    ["synced", new Set(syncs.map((sync) => sync.collectionId)).size],
    ["sync-sources", new Set(syncs.map((sync) => sync.provider)).size],
    ["regular", days],
  ]);
  for (const row of bySite) if (row.sourceProvider) counts.set(`site:${row.sourceProvider}`, row._count);
  for (const row of byTool) if (row.createdWithRef) counts.set(`tool:${row.createdWithRef}`, row._count);
  return counts;
}

/** The highest tier `count` reaches, or -1 for none. */
function tierFor(def: BadgeDef, count: number): number {
  let tier = -1;
  def.thresholds.forEach((threshold, index) => {
    if (count >= threshold) tier = index;
  });
  return tier;
}

/** Sets `badge` to `tier` unless it's there already at that or higher. Only raises: two checks at once can't take a
 *  badge back down. True when it changed. */
async function raise(userId: string, badge: string, tier: number, seenAt: Date | null): Promise<boolean> {
  const earnedAt = new Date();
  const created = await prisma.userAchievement.createMany({
    data: [{ userId, badge, tier, earnedAt, seenAt }],
    skipDuplicates: true,
  });
  if (created.count) return true;
  const updated = await prisma.userAchievement.updateMany({
    where: { userId, badge, tier: { lt: tier } },
    data: { tier, earnedAt, seenAt },
  });
  return updated.count > 0;
}

type Raised = { badge: string; tier: number };

/** Tells the user what they've just earned: one notification, however many came at once. */
async function notifyRaised(userId: string, raised: Raised[]): Promise<void> {
  if (!raised.length) return;
  const [first] = raised;
  if (raised.length === 1) {
    await createNotification(userId, {
      type: "achievement",
      title: "Achievement unlocked",
      message: { key: "achievementUnlocked", values: { badge: first.badge, tier: first.tier } },
      internalPath: `/authors/self?achievement=${encodeURIComponent(first.badge)}`,
    });
    return;
  }
  await createNotification(userId, {
    type: "achievement",
    title: `${raised.length} achievements unlocked`,
    message: { key: "achievementsUnlocked", values: { count: raised.length } },
    internalPath: "/authors/self?achievements=all",
  });
}

/** Raises every badge `userId` has earned past what they have. `silent`: as turning achievements on does, marked
 *  seen at once and left for the caller to tell. Returns what was raised. */
export async function evaluateAchievements(userId: string, { silent = false } = {}): Promise<Raised[]> {
  const counts = await countsFor(userId);
  const have = new Map(
    (await prisma.userAchievement.findMany({ where: { userId }, select: { badge: true, tier: true } })).map((row) => [
      row.badge,
      row.tier,
    ]),
  );
  const raised: Raised[] = [];
  const seenAt = silent ? new Date() : null;
  for (const def of BADGES) {
    if (def.counter.kind === "secret") continue;
    const tier = tierFor(def, counts.get(def.id) ?? 0);
    if (tier < 0 || (have.get(def.id) ?? -1) >= tier) continue;
    if (await raise(userId, def.id, tier, seenAt)) raised.push({ badge: def.id, tier });
  }
  if (!silent) await notifyRaised(userId, raised);
  return raised;
}

// One check at a time a user, a moment after the last thing that asked for one.
const waiting = new Map<string, ReturnType<typeof setTimeout>>();
const running = new Map<string, Promise<void>>();
// While turning achievements on credits everyone: who's been credited so far. A check for someone who hasn't been yet
// credits them, in the same turn as their checks, so what they did meanwhile is told with the rest rather than as a
// toast for each badge they had long ago, and a check for someone who has been is an ordinary one.
let credited: Set<string> | null = null;

/** Runs `task` for `userId` once what's already running for them is over. */
async function inTurn(userId: string, what: string, task: () => Promise<void>): Promise<void> {
  const before = running.get(userId) ?? Promise.resolve();
  const next = before.then(task).catch((err: unknown) => console.error(`[achievements] ${what} failed`, userId, err));
  running.set(userId, next);
  await next;
  if (running.get(userId) === next) running.delete(userId);
}

/** Raises what `userId` had earned before achievements were on, seen at once, and says so in one notification. */
async function creditOne(userId: string): Promise<void> {
  const raised = await evaluateAchievements(userId, { silent: true });
  if (!raised.length) return;
  await createNotification(userId, {
    type: "achievement",
    title: `You've earned ${raised.length} achievements`,
    message: { key: "achievementsCredited", values: { count: raised.length } },
    internalPath: "/authors/self?achievements=all",
  });
}

/** While everyone is being credited, credits `userId` unless they have been already; true when it did. */
async function creditIfDue(userId: string): Promise<boolean> {
  if (!credited || credited.has(userId)) return false;
  credited.add(userId);
  await creditOne(userId);
  return true;
}

function check(userId: string): Promise<void> {
  return inTurn(userId, "check", async () => {
    if (!(await getAchievementSettings()).enabled) return;
    if (!(await creditIfDue(userId))) await evaluateAchievements(userId);
  });
}

/** Checks `userId`'s badges in a moment, while achievements are on. Fire-and-forget, like recordActivity: whatever
 *  asked must never wait on it or fail for it. */
export function scheduleAchievementCheck(userId: string): void {
  const before = waiting.get(userId);
  if (before) clearTimeout(before);
  const timer = setTimeout(() => {
    waiting.delete(userId);
    void check(userId);
  }, CHECK_DELAY_MS);
  timer.unref?.();
  waiting.set(userId, timer);
}

/** Checks now, waiting for it: for tests, and for whatever needs the answer. */
export async function checkAchievementsNow(userId: string): Promise<void> {
  const before = waiting.get(userId);
  if (before) clearTimeout(before);
  waiting.delete(userId);
  await check(userId);
}

let creditRun: Promise<void> | null = null;
// Switched off and on while a run goes: it may have stopped short, so everyone is gone over again once it ends.
let creditAgain = false;

/** Credits every user with what they'd earned before achievements were turned on: no toasts, one notification
 *  each. Stops when they're switched off; asked again while it runs, it goes over everyone again after. */
export function creditEveryone(): Promise<void> {
  if (creditRun) {
    creditAgain = true;
    return creditRun;
  }
  creditRun = (async () => {
    try {
      do {
        creditAgain = false;
        await creditAll();
      } while (creditAgain);
    } finally {
      creditRun = null;
    }
  })();
  return creditRun;
}

async function creditAll(): Promise<void> {
  credited = new Set();
  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const { id } of users) {
      let on = true;
      await inTurn(id, "crediting", async () => {
        on = (await getAchievementSettings()).enabled;
        if (on) await creditIfDue(id);
      });
      if (!on) return;
    }
  } finally {
    credited = null;
  }
}

// The days someone used Thingport: the first request of each (UTC) day is written, the rest of it known from here.
const seenOn = new Map<string, string>();
let prunedOn = "";

/** Notes that `userId` used Thingport today. Cheap after the first call of the day; never throws. */
export function noteActiveDay(userId: string): void {
  const today = new Date().toISOString().slice(0, 10);
  if (seenOn.get(userId) === today) return;
  seenOn.set(userId, today);
  void (async () => {
    try {
      await prisma.$executeRaw`
        INSERT INTO "UserActiveDay" ("userId", "day") VALUES (${userId}, ${today}::date) ON CONFLICT DO NOTHING`;
      if (prunedOn !== today) {
        prunedOn = today;
        await prisma.userActiveDay.deleteMany({ where: { day: { lt: new Date(Date.now() - KEEP_DAYS * DAY_MS) } } });
      }
      scheduleAchievementCheck(userId);
    } catch (err) {
      // Tried again on their next request.
      seenOn.delete(userId);
      console.error("[achievements] couldn't note an active day", err);
    }
  })();
}

/** Each of `userIds`' days in the Regular badge's window, for whether theirs still holds. */
async function activeDaysOf(userIds: string[]): Promise<Map<string, number>> {
  if (!userIds.length) return new Map();
  const rows = await prisma.userActiveDay.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, day: { gte: regularSince() } },
    _count: true,
  });
  return new Map(rows.map((row) => [row.userId, row._count]));
}

type Row = { badge: string; tier: number; earnedAt: Date; seenAt: Date | null; userId: string };

/** What the catalogue still has, highest first and secrets last, the latest first among equals. */
function ordered<T extends Row>(rows: T[]): (T & { def: BadgeDef })[] {
  return rows
    .flatMap((row) => {
      const def = badgeDef(row.badge);
      // A tier past what the badge has now (its ladder shortened) shows as its top one.
      return def ? [{ ...row, tier: Math.min(row.tier, def.thresholds.length - 1), def }] : [];
    })
    .toSorted(
      (a, b) =>
        badgeRank(b.def, b.tier) - badgeRank(a.def, a.tier) ||
        b.earnedAt.getTime() - a.earnedAt.getTime() ||
        a.badge.localeCompare(b.badge),
    );
}

function out(row: Row & { def: BadgeDef }, activeDays: number): AchievementOut {
  return {
    id: row.badge,
    tier: row.tier,
    earned_at: row.earnedAt.toISOString(),
    ...(row.def.counter.kind === "regular" ? { expired: activeDays < REGULAR_MIN_DAYS } : {}),
  };
}

/** `userIds`' badges as others see them, each user's list in order. */
export async function achievementsOf(userIds: string[]): Promise<Map<string, AchievementOut[]>> {
  const result = new Map<string, AchievementOut[]>(userIds.map((id) => [id, []]));
  if (!userIds.length) return result;
  const [rows, days] = await Promise.all([
    prisma.userAchievement.findMany({ where: { userId: { in: userIds } } }),
    activeDaysOf(userIds),
  ]);
  for (const row of ordered(rows)) result.get(row.userId)?.push(out(row, days.get(row.userId) ?? 0));
  return result;
}

/** One user's badges as they see them: with counts, the next tier, and which they've been shown. */
export async function ownAchievements(userId: string): Promise<OwnAchievementOut[]> {
  const [rows, counts] = await Promise.all([prisma.userAchievement.findMany({ where: { userId } }), countsFor(userId)]);
  const days = counts.get("regular") ?? 0;
  return ordered(rows).map((row) => {
    const secret = row.def.counter.kind === "secret";
    return {
      ...out(row, days),
      count: secret ? null : (counts.get(row.badge) ?? 0),
      next: row.def.thresholds[row.tier + 1] ?? null,
      seen: row.seenAt !== null,
    };
  });
}

/** Only what the app hasn't shown `userId` yet: cheap enough to ask now and then. */
export async function unseenAchievements(userId: string): Promise<AchievementOut[]> {
  const [rows, days] = await Promise.all([
    prisma.userAchievement.findMany({ where: { userId, seenAt: null } }),
    activeDaysOf([userId]),
  ]);
  return ordered(rows).map((row) => out(row, days.get(userId) ?? 0));
}

/** Marks these of `userId`'s badges shown, each at the tier the app showed: one raised since stays unseen, to be
 *  shown in its turn. A badge's top tier stands for any past it, as `ordered` shows those. */
export async function markAchievementsSeen(userId: string, shown: { id: string; tier: number }[]): Promise<void> {
  const seenAt = new Date();
  for (const { id, tier } of shown) {
    const def = badgeDef(id);
    if (!def) continue;
    const top = def.thresholds.length - 1;
    await prisma.userAchievement.updateMany({
      where: { userId, badge: id, seenAt: null, tier: tier >= top ? { gte: tier } : tier },
      data: { seenAt },
    });
  }
}

/** Gives `userId` a secret a widget or tool gave away: `secret` is `<its slug>/<key>`. False for one there isn't.
 *  Anyone can claim one from their browser's console; they're for fun, and earn nothing else. */
export async function claimSecret(userId: string, secret: string): Promise<boolean> {
  if (!(SECRETS as readonly string[]).includes(secret)) return false;
  const badge = `secret:${secret}`;
  if (await raise(userId, badge, 0, null)) await notifyRaised(userId, [{ badge, tier: 0 }]);
  return true;
}
