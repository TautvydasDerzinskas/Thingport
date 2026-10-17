import { z } from "zod";
import { prisma } from "../db";
import { SYSTEM_NOTIFICATIONS_URL } from "../config";
import { UNREAD_RETENTION_DAYS } from "./notificationService";
import { createKeyedLock } from "../utils/concurrency";
import { getBackendVersion } from "./versionService";

const FETCH_TIMEOUT_MS = 15_000;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const entrySchema = z.object({
  // Never reuse an id: it's what stops an entry from being sent twice.
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(2000).nullish(),
  // https only: an announcement's link goes in front of every admin of every instance.
  url: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"))
    .nullish(),
  // An in-app page opened on click, e.g. "/admin"; "//" would leave the app.
  path: z
    .string()
    .trim()
    .regex(/^\/(?!\/)\S*$/)
    .max(200)
    .nullish(),
  published_at: z.coerce.date(),
  // Admins by default: most announcements are about running the instance.
  audience: z.enum(["admins", "all"]).default("admins"),
  // Which app versions get it: "1.0.0", "<1.0.0", "<=1.0.0", ">1.0.0" or ">=1.0.0"; omitted for all.
  version: z
    .string()
    .trim()
    .regex(/^(<=|>=|<|>|=)?\s*\d+\.\d+\.\d+$/)
    .nullish(),
});
export type SystemNotificationEntry = z.infer<typeof entrySchema>;

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** An entry aimed at certain versions is held back while this instance's version is unknown. */
export function matchesVersion(range: string | null | undefined, version: string | null): boolean {
  if (!range) return true;
  const own = version?.match(/^\d+\.\d+\.\d+/)?.[0];
  if (!own) return false;
  const [, op = "=", target] = range.match(/^(<=|>=|<|>|=)?\s*(.+)$/)!;
  const diff = compareVersions(own, target);
  switch (op) {
    case "<":
      return diff < 0;
    case "<=":
      return diff <= 0;
    case ">":
      return diff > 0;
    case ">=":
      return diff >= 0;
    default:
      return diff === 0;
  }
}

/** One bad entry is skipped rather than hiding the rest. Versions before 1.0.0 read only `notifications`
 *  and ignore `version`, so entries they mustn't get live in `entries`. */
export function parseSystemNotifications(data: unknown): SystemNotificationEntry[] {
  const file = data as { notifications?: unknown; entries?: unknown } | null;
  const list = [file?.notifications, file?.entries].flatMap((l) => (Array.isArray(l) ? l : []));
  return list.flatMap((raw) => {
    const parsed = entrySchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

async function fetchSystemNotifications(url: string): Promise<SystemNotificationEntry[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseSystemNotifications(await res.json());
  } catch {
    return null;
  }
}

const WRITE_BATCH = 1000;
// Runs never overlap: the receipts read up front are what keeps an entry from being sent twice.
const withDeliveryLock = createKeyedLock();

/** Sends each user every entry meant for them they haven't had yet, as an ordinary notification dated
 *  when it was posted. Future entries wait for their date; ones past the unread retention aren't sent. */
export function deliverSystemNotifications(
  entries: SystemNotificationEntry[],
  now = new Date(),
  version = getBackendVersion(),
): Promise<number> {
  return withDeliveryLock("system", async () => {
    const oldest = now.getTime() - UNREAD_RETENTION_DAYS * DAY_MS;
    // No receipt for a version mismatch, so an entry still reaches an instance that updates into its range.
    const due = entries.filter(
      (e) =>
        e.published_at.getTime() <= now.getTime() &&
        e.published_at.getTime() >= oldest &&
        matchesVersion(e.version, version),
    );
    if (!due.length) return 0;
    const [users, receipts] = await Promise.all([
      prisma.user.findMany({ select: { id: true, role: true } }),
      prisma.systemReceipt.findMany({
        where: { systemId: { in: due.map((e) => e.id) } },
        select: { userId: true, systemId: true },
      }),
    ]);
    const seen = new Set(receipts.map((r) => `${r.userId}\n${r.systemId}`));
    const toSend = users.flatMap((user) =>
      due
        .filter((e) => (e.audience === "all" || user.role === "ADMIN") && !seen.has(`${user.id}\n${e.id}`))
        .map((entry) => ({ userId: user.id, entry })),
    );
    for (let i = 0; i < toSend.length; i += WRITE_BATCH) {
      const batch = toSend.slice(i, i + WRITE_BATCH);
      await prisma.$transaction([
        prisma.systemReceipt.createMany({
          data: batch.map(({ userId, entry }) => ({ userId, systemId: entry.id })),
          skipDuplicates: true,
        }),
        prisma.notification.createMany({
          data: batch.map(({ userId, entry }) => ({
            userId,
            type: "system",
            title: entry.title,
            body: entry.body ?? null,
            externalUrl: entry.url ?? null,
            internalPath: entry.path ?? null,
            createdAt: entry.published_at,
          })),
        }),
      ]);
    }
    return toSend.length;
  });
}

export async function syncSystemNotifications(url = SYSTEM_NOTIFICATIONS_URL): Promise<void> {
  if (!url) return;
  const entries = await fetchSystemNotifications(url);
  if (entries) await deliverSystemNotifications(entries);
}

/** Once at startup, then every few hours. */
export function startSystemNotificationSync(): void {
  const run = () =>
    syncSystemNotifications().catch((err) => console.error("Failed to sync system notifications:", err));
  void run();
  setInterval(run, SYNC_INTERVAL_MS).unref();
}
