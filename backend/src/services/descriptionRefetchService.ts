import { prisma } from "../db";
import { IMPORT_COLLECTION_DELAY_MS } from "../config";
import { maybeSleep } from "../utils/concurrency";
import { createLog } from "./auditLog";
import { localizeDescriptionImages } from "./descriptionImageService";
import { fetchSourceMeta } from "./fillGapsService";
import { buildImportSourceUrl } from "./importService";
import { makerworldCaptchaCooloffActive, MakerworldAuthError, MakerworldCaptchaError } from "./makerworldCloudApi";
import { getThingiverseAccessToken } from "./settingsService";
import { ThingiverseAuthError, ThingiverseRateLimitError } from "./thingiverseApi";
import type { LookupProblem } from "./authorLinkingService";
import { getDisabledProviders } from "./providerSettingsService";

// Re-reads every imported model's description for one user from its source, replacing the stored
// one, e.g. to bring models imported as plain text up to formatted descriptions with images.

const SOURCE_PROVIDERS = ["makerworld", "thingiverse", "printables"] as const;
type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export type DescriptionRefetchRun = {
  running: boolean;
  userId: string;
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  updated: number;
  /** The source couldn't be read, or has no description; the stored one is kept. */
  failed: number;
  problems: LookupProblem[];
};

/** Per user, how many models have a source to refetch from. */
export async function refetchableCounts(): Promise<Record<string, number>> {
  const rows = await prisma.print.groupBy({
    by: ["userId"],
    where: { sourceProvider: { in: [...SOURCE_PROVIDERS] }, sourceExternalId: { not: null } },
    _count: { userId: true },
  });
  return Object.fromEntries(rows.map((row) => [row.userId, row._count.userId]));
}

let current: DescriptionRefetchRun | null = null;

export function currentDescriptionRefetch(): DescriptionRefetchRun | null {
  return current;
}

/** Null if a run is already in progress. */
export function startDescriptionRefetch(
  adminUserId: string,
  user: { id: string; email: string },
): DescriptionRefetchRun | null {
  if (current?.running) return null;
  current = {
    running: true,
    userId: user.id,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    total: 0,
    done: 0,
    updated: 0,
    failed: 0,
    problems: [],
  };
  const run = current;
  void runDescriptionRefetch(run)
    .catch((err) => console.error("Refetch descriptions failed", err))
    .finally(() => {
      run.running = false;
      run.finishedAt = new Date().toISOString();
      void createLog({
        userId: adminUserId,
        action: "descriptions_refetched",
        targetId: user.id,
        // The log row's user is the admin who ran it; this names whose library was changed.
        details: {
          email: user.email,
          total: run.total,
          updated: run.updated,
          failed: run.failed,
          problems: run.problems,
        },
      });
    });
  return run;
}

export async function runDescriptionRefetch(run: DescriptionRefetchRun): Promise<void> {
  // A provider an admin turned off is left out of the run, rather than counted as failing.
  const disabled = await getDisabledProviders();
  const prints = await prisma.print.findMany({
    where: {
      userId: run.userId,
      sourceProvider: { in: SOURCE_PROVIDERS.filter((provider) => !disabled.has(provider)) },
      sourceExternalId: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });
  run.total = prints.length;

  const skipped = new Set<SourceProvider>();
  const skip = (provider: SourceProvider, problem: LookupProblem) => {
    skipped.add(provider);
    if (!run.problems.includes(problem)) run.problems.push(problem);
  };
  // Only warned about for sites this user's models actually come from.
  const providers = new Set(prints.map((print) => print.sourceProvider));
  if (providers.has("thingiverse") && !(await getThingiverseAccessToken())) skip("thingiverse", "thingiverse_no_token");
  if (providers.has("makerworld") && makerworldCaptchaCooloffActive()) skip("makerworld", "makerworld_captcha");

  for (const print of prints) {
    const provider = print.sourceProvider as SourceProvider;
    const sourceUrl = buildImportSourceUrl(print.sourceProvider, print.sourceExternalId);
    if (skipped.has(provider) || !sourceUrl) {
      run.failed++;
      run.done++;
      continue;
    }
    try {
      // MakerWorld calls are paced inside fetchSourceMeta.
      if (provider !== "makerworld") await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      const meta = await fetchSourceMeta(run.userId, print, sourceUrl);
      if (meta.description) {
        // Re-read, so an edit the owner saved while the run was going counts against what's replaced.
        const before = await prisma.print.findUnique({ where: { id: print.id }, select: { notes: true } });
        await prisma.print.update({ where: { id: print.id }, data: { notes: meta.description } });
        // Images already stored for this model are matched by URL, so they aren't downloaded again.
        await localizeDescriptionImages(print.id);
        const after = await prisma.print.findUnique({ where: { id: print.id }, select: { notes: true } });
        if (after?.notes !== before?.notes) run.updated++;
      } else {
        run.failed++;
      }
    } catch (err) {
      run.failed++;
      if (err instanceof MakerworldCaptchaError) skip("makerworld", "makerworld_captcha");
      else if (err instanceof MakerworldAuthError) skip("makerworld", "makerworld_login_rejected");
      else if (err instanceof ThingiverseAuthError) skip("thingiverse", "thingiverse_token_rejected");
      // Cloudflare's 429 is sticky, so every further Thingiverse request would fail the same way.
      else if (err instanceof ThingiverseRateLimitError) skip("thingiverse", "thingiverse_rate_limited");
      else console.warn(`Couldn't refetch the description of model ${print.id}`, err);
    }
    run.done++;
  }
}
