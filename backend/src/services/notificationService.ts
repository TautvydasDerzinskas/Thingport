import type { Prisma } from "@prisma/client";
import type { NotificationMessage } from "./notificationMessage";
import { prisma } from "../db";

export const NOTIFICATION_TYPES = [
  "import",
  "upload",
  "sync",
  "queue",
  "consume",
  "ai",
  "system",
  "chat",
  "federation",
  "share",
  "general",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The tabs: everything, the unread ones, or only system announcements. Opening the list marks
 *  everything read, so "unread" also takes the ones read since `since`: what was new at that moment. */
export const NOTIFICATION_FILTERS = ["all", "unread", "system"] as const;
export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

function filterWhere(filter: NotificationFilter = "all", since?: Date | null): Prisma.NotificationWhereInput {
  if (filter === "unread") return since ? { OR: [{ readAt: null }, { readAt: { gte: since } }] } : { readAt: null };
  if (filter === "system") return { type: "system" };
  return {};
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

// Read notifications go after a month; unread ones are kept longer, so nothing unseen disappears
// while someone is away.
const READ_RETENTION_DAYS = 30;
export const UNREAD_RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A system receipt per Bridge version someone has been told about (bridgeUpdateService). */
export const BRIDGE_UPDATE_RECEIPT_PREFIX = "bridge-update-";
const DAY_MS = 24 * 60 * 60 * 1000;

export async function createNotification(
  userId: string,
  data: {
    type: NotificationType;
    title: string;
    /** The same title for the app to translate. */
    message?: NotificationMessage;
    body?: string | null;
    externalUrl?: string | null;
    internalPath?: string | null;
    group?: Prisma.InputJsonValue;
  },
  db: Prisma.TransactionClient = prisma,
): Promise<void> {
  await db.notification.create({
    data: {
      userId,
      type: data.type,
      title: data.title,
      ...(data.message ? { message: data.message } : {}),
      body: data.body ?? null,
      externalUrl: data.externalUrl ?? null,
      internalPath: data.internalPath ?? null,
      ...(data.group !== undefined ? { group: data.group } : {}),
    },
  });
}

// The cursor is the last item's time and id, so deleting notifications between pages can't break it.
function encodeCursor(item: { createdAt: Date; id: string }): string {
  return `${item.createdAt.toISOString()}|${item.id}`;
}

function cursorWhere(cursor: string | null | undefined): Prisma.NotificationWhereInput {
  if (!cursor) return {};
  const [iso, id] = cursor.split("|");
  const createdAt = new Date(iso);
  if (!id || Number.isNaN(createdAt.getTime())) return {};
  return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] };
}

/** Newest first, one page at a time. `nextCursor` is null on the last page. */
export async function listNotifications(
  userId: string,
  options: { limit?: number; before?: string | null; filter?: NotificationFilter; since?: Date | null } = {},
) {
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, options.limit ?? DEFAULT_PAGE_SIZE));
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId, ...filterWhere(options.filter, options.since), ...cursorWhere(options.before) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  const items = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? encodeCursor(items[items.length - 1]) : null;
  return { items, unreadCount, nextCursor };
}

/** Returns the time stamped on them, for the "unread" tab's `since`. */
export async function markAllRead(userId: string): Promise<Date> {
  const readAt = new Date();
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt } });
  return readAt;
}

/** False when there was no such notification for this user. */
export async function deleteNotification(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.notification.deleteMany({ where: { id, userId } });
  return count > 0;
}

export async function deleteAllNotifications(
  userId: string,
  filter: NotificationFilter = "all",
  since?: Date | null,
): Promise<void> {
  await prisma.notification.deleteMany({ where: { userId, ...filterWhere(filter, since) } });
}

export async function pruneNotifications(now = new Date()): Promise<number> {
  const { count } = await prisma.notification.deleteMany({
    where: {
      OR: [
        { readAt: { not: null }, createdAt: { lt: new Date(now.getTime() - READ_RETENTION_DAYS * DAY_MS) } },
        { readAt: null, createdAt: { lt: new Date(now.getTime() - UNREAD_RETENTION_DAYS * DAY_MS) } },
      ],
    },
  });
  // System notifications older than the unread limit are never sent again, so their receipts can go too. A Bridge
  // update's would be sent again to someone still on an older Bridge, so it stays.
  await prisma.systemReceipt.deleteMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - UNREAD_RETENTION_DAYS * DAY_MS) },
      NOT: { systemId: { startsWith: BRIDGE_UPDATE_RECEIPT_PREFIX } },
    },
  });
  return count;
}

/** Prunes once at startup, then daily. */
export function startNotificationCleanup(): void {
  const run = () => pruneNotifications().catch((err) => console.error("Failed to delete old notifications:", err));
  void run();
  setInterval(run, CLEANUP_INTERVAL_MS).unref();
}
