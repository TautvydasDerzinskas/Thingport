/** Manual/on-demand entry point for the tag-casing backfill (see services/tagCasingBackfill.ts).
 * You shouldn't normally need to run this yourself -- server.ts already runs it automatically
 * once, the first time the app boots after this feature shipped, tracked via a Setting row so
 * later restarts skip it. This script is here for local dev (before that first boot) or to force
 * a fresh pass on demand; it always runs, ignoring that tracking.
 *
 * Run via `npx tsx src/scripts/normalizeTagCasing.ts` (or `npm run tags:normalize-casing`) from
 * backend/, against whatever DATABASE_URL the environment currently points at.
 */
import { prisma } from "../db";
import { normalizeAllTagCasing } from "../services/tagCasingBackfill";

normalizeAllTagCasing()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
