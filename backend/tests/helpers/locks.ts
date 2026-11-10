import type { Prisma } from "@prisma/client";
import { expect, vi } from "vitest";
import { prisma } from "../../src/db";

/** The database session `tx` runs in. */
export async function sessionOf(tx: Prisma.TransactionClient): Promise<number> {
  const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  return pid;
}

/** Until `count` sessions wait on a lock session `pid` holds, or on one waiting for it (a second waiter for a row
 *  queues behind the first): the race a test set up has reached it, whatever the machine's pace. */
export function blockedBy(pid: number, count = 1): Promise<void> {
  return vi.waitFor(
    async () => {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
        WITH RECURSIVE chain(pid) AS (
          SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
          UNION
          SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
        )
        SELECT COUNT(*)::int AS waiting FROM chain`;
      expect(waiting).toBeGreaterThanOrEqual(count);
    },
    { timeout: 10_000, interval: 25 },
  );
}
