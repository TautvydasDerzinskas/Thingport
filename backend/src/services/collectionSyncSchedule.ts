// When synced collections are checked, kept apart from the runner so the DTOs can say so without
// importing it. Each collection has its own interval; the scheduler wakes every SYNC_TICK_MS and
// checks the ones that are due.

import { COLLECTION_SYNC_ENABLED } from "../config";

/** The intervals a collection can pick, in hours. New syncs get 24 (see CollectionSync.intervalHours). */
export const SYNC_INTERVAL_HOURS = [1, 6, 24] as const;
export type SyncIntervalHours = (typeof SYNC_INTERVAL_HOURS)[number];

const HOUR_MS = 60 * 60 * 1000;
// How often the scheduler looks for due collections, so a sync starts at most this late.
export const SYNC_TICK_MS = 5 * 60 * 1000;
// Lets the server settle after a start before the first provider calls.
export const SYNC_STARTUP_DELAY_MS = 2 * 60 * 1000;
// "Sync now" waits this long after a collection's last check, so it can't hammer a provider.
export const SYNC_NOW_COOLDOWN_MS = 5 * 60 * 1000;

let firstTickAt: number | null = null;

export function syncSchedulerEnabled(): boolean {
  return COLLECTION_SYNC_ENABLED;
}

export function markSchedulerStarted(now = Date.now()): void {
  firstTickAt = now + SYNC_STARTUP_DELAY_MS;
}

/** The scheduler's next wake-up at or after `at`. */
function nextTick(at: number): number {
  if (firstTickAt === null) return at;
  if (at <= firstTickAt) return firstTickAt;
  return firstTickAt + Math.ceil((at - firstTickAt) / SYNC_TICK_MS) * SYNC_TICK_MS;
}

/** When a collection is next due: its interval after its last check, or now if never checked. */
export function syncDueAt(sync: { lastCheckedAt: Date | null; intervalHours: number }, now = Date.now()): number {
  return sync.lastCheckedAt ? sync.lastCheckedAt.getTime() + sync.intervalHours * HOUR_MS : now;
}

export function isSyncDue(sync: { lastCheckedAt: Date | null; intervalHours: number }, now = Date.now()): boolean {
  return syncDueAt(sync, now) <= now;
}

/** Roughly when the scheduler gets to this collection next, or null with scheduled sync off.
 *  Collections are checked one at a time, and give way to an import from the same provider, so it
 *  can start a little after this. */
export function nextSyncAt(sync: { lastCheckedAt: Date | null; intervalHours: number }, now = Date.now()): Date | null {
  if (firstTickAt === null) return null;
  return new Date(nextTick(Math.max(syncDueAt(sync, now), now)));
}

export function syncNowAvailableAt(lastCheckedAt: Date | null): Date | null {
  return lastCheckedAt ? new Date(lastCheckedAt.getTime() + SYNC_NOW_COOLDOWN_MS) : null;
}
