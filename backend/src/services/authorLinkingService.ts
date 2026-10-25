import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PROVIDER_IDS, type ProviderId } from "../providers/index.generated";
import { IMPORT_COLLECTION_DELAY_MS } from "../config";
import { maybeSleep } from "../utils/concurrency";
import { LINKABLE_PRINTS, linkUnattributedPrints, upsertAuthorFromImport } from "./authorService";
import { createLog } from "./auditLog";
import type { ImportedAuthorInfo } from "./importResolvers";
import { getDisabledProviders } from "./providerSettingsService";
import { PROVIDERS } from "../providers/registry";
import type { LookupProblem } from "../providers/types";

// Links models that only know their author by name: first by name matching, then by looking the
// rest up on their site once per distinct creator. Only metadata is fetched.

export const LOOKUP_PROVIDERS = PROVIDER_IDS;
type LookupProvider = ProviderId;

export type AuthorLinkingRun = {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  toLookUp: number;
  lookedUp: number;
  linked: number;
  notFound: number;
  problems: LookupProblem[];
};

type Candidate = { printId: string; userId: string; provider: LookupProvider; externalId: string; creator: string };

// Whether the model's owner has a key its provider reads with, for a provider read with each user's own.
const READABLE_BY = PROVIDER_IDS.flatMap((id) => {
  const readableBy = PROVIDERS[id].details.readableBy;
  return readableBy ? [Prisma.sql`WHEN ${id} THEN (${readableBy})`] : [];
});
const READABLE_FIRST = READABLE_BY.length
  ? Prisma.sql`(CASE p."sourceProvider" ${Prisma.join(READABLE_BY, " ")} ELSE false END)`
  : Prisma.sql`false`;

// One model per unmatched creator per site: the newest, as the likeliest still online. A provider read only with the
// model's owner's own key, it's the newest of an owner who has a usable one.
const LOOKUP_CANDIDATES = Prisma.sql`
  SELECT DISTINCT ON (p."sourceProvider", lower(trim(p.creator)))
    p.id AS "printId", p."userId", p."sourceProvider" AS provider, p."sourceExternalId" AS "externalId", p.creator
  FROM "Print" p
  JOIN "User" u ON u.id = p."userId"
  WHERE p."authorId" IS NULL AND p.creator IS NOT NULL AND trim(p.creator) <> ''
    AND p."sourceProvider" IN (${Prisma.join([...LOOKUP_PROVIDERS])}) AND p."sourceExternalId" IS NOT NULL
    AND p.id NOT IN (SELECT print_id FROM (${LINKABLE_PRINTS}) l)
  ORDER BY p."sourceProvider", lower(trim(p.creator)), ${READABLE_FIRST} DESC, p."createdAt" DESC
`;

export async function authorLinkingSummary(): Promise<{ linkable: number; lookup: number }> {
  const [row] = await prisma.$queryRaw<{ linkable: number; lookup: number }[]>`
    SELECT
      (SELECT count(*)::int FROM (${LINKABLE_PRINTS}) l) AS linkable,
      (SELECT count(*)::int FROM "Print" p
        WHERE p."authorId" IS NULL AND p.creator IS NOT NULL AND trim(p.creator) <> ''
          AND p."sourceProvider" IN (${Prisma.join([...LOOKUP_PROVIDERS])}) AND p."sourceExternalId" IS NOT NULL
          AND p.id NOT IN (SELECT print_id FROM (${LINKABLE_PRINTS}) l2)) AS lookup
  `;
  return { linkable: row?.linkable ?? 0, lookup: row?.lookup ?? 0 };
}

let current: AuthorLinkingRun | null = null;

export function currentAuthorLinkingRun(): AuthorLinkingRun | null {
  return current;
}

/** Null if a run is already in progress. */
export function startAuthorLinking(adminUserId: string): AuthorLinkingRun | null {
  if (current?.running) return null;
  current = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    toLookUp: 0,
    lookedUp: 0,
    linked: 0,
    notFound: 0,
    problems: [],
  };
  const run = current;
  void runAuthorLinking(run)
    .catch((err) => console.error("Link missing authors failed", err))
    .finally(() => {
      run.running = false;
      run.finishedAt = new Date().toISOString();
      void createLog({
        userId: adminUserId,
        action: "authors_linked",
        details: { linked: run.linked, lookedUp: run.lookedUp, notFound: run.notFound, problems: run.problems },
      });
    });
  return run;
}

async function countUnlinked(): Promise<number> {
  return prisma.print.count({ where: { authorId: null, creator: { not: null } } });
}

export async function runAuthorLinking(run: AuthorLinkingRun): Promise<void> {
  const unlinkedAtStart = await countUnlinked();
  const updateLinked = async () => {
    run.linked = unlinkedAtStart - (await countUnlinked());
  };
  await linkUnattributedPrints();
  await updateLinked();

  const candidates = await prisma.$queryRaw<Candidate[]>`${LOOKUP_CANDIDATES}`;
  run.toLookUp = candidates.length;
  const skipped = new Set<LookupProvider>();
  const skip = (provider: LookupProvider, problem: LookupProblem) => {
    skipped.add(provider);
    if (!run.problems.includes(problem)) run.problems.push(problem);
  };
  const report = (problem: LookupProblem) => {
    if (!run.problems.includes(problem)) run.problems.push(problem);
  };
  // Turned off by an admin: left alone, not reported as a problem.
  for (const provider of await getDisabledProviders()) skipped.add(provider);
  // Only for providers still on with models to look up: one turned off isn't missing a token or held by a captcha.
  for (const provider of new Set(candidates.map((candidate) => candidate.provider))) {
    const unavailable = PROVIDERS[provider].details.unavailable;
    if (skipped.has(provider) || !unavailable || unavailable.perUser) continue;
    const problem = await unavailable.check();
    if (problem) skip(provider, problem);
  }

  for (const candidate of candidates) {
    if (skipped.has(candidate.provider)) {
      run.lookedUp++;
      continue;
    }
    const { details } = PROVIDERS[candidate.provider];
    // Candidates prefer an owner with a key (see LOOKUP_CANDIDATES), so none here means no owner of this creator's
    // models has one: a key to set up, not an author missing.
    const unusable = details.unavailable?.perUser ? await details.unavailable.check(candidate.userId) : null;
    if (unusable) {
      report(unusable);
      run.lookedUp++;
      continue;
    }
    let author: ImportedAuthorInfo | null = null;
    try {
      if (!details.pacesItself) await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      author = details.author
        ? await details.author(candidate.userId, candidate.externalId)
        : ((await details.read(candidate.userId, candidate.externalId))?.author ?? null);
    } catch (err) {
      const found = details.problemOf?.(err);
      // One user's own key turned down only stops that user's lookups.
      if (found?.perUser) report(found.problem);
      else if (found) skip(candidate.provider, found.problem);
      else console.warn(`Couldn't look up the author of model ${candidate.printId}`, err);
    }
    const saved = author ? await upsertAuthorFromImport(author) : null;
    if (saved) {
      // Also covers the looked-up model when its stored name differs from the author's (nickname vs.
      // display name).
      await prisma.$executeRaw`
        UPDATE "Print" SET "authorId" = ${saved.id}
        WHERE "authorId" IS NULL AND "sourceProvider" = ${candidate.provider}
          AND lower(trim(creator)) = lower(trim(${candidate.creator}))
      `;
      await updateLinked();
    } else {
      run.notFound++;
    }
    run.lookedUp++;
  }
}
