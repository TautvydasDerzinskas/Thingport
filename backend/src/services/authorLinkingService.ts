import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { IMPORT_COLLECTION_DELAY_MS, IMPORT_MAKERWORLD_CALL_DELAY_MS } from "../config";
import { maybeSleep } from "../utils/concurrency";
import { LINKABLE_PRINTS, linkUnattributedPrints, upsertAuthorFromImport } from "./authorService";
import { createLog } from "./auditLog";
import { fetchMakerworldPageAuthor } from "./importService";
import type { ImportedAuthorInfo } from "./importResolvers";
import { getUserMakerworldCookie } from "./makerworldCookieService";
import {
  extractMakerworldBearerToken,
  fetchMakerworldDesignAuthor,
  makerworldCaptchaCooloffActive,
  MakerworldAuthError,
  MakerworldCaptchaError,
} from "./makerworldCloudApi";
import { resolvePrintablesModel } from "./printablesApi";
import { getThingiverseAccessToken } from "./settingsService";
import { resolveThingiverseThing, ThingiverseAuthError, ThingiverseRateLimitError } from "./thingiverseApi";
import { getDisabledProviders } from "./providerSettingsService";

// Links models that only know their author by name: first by name matching, then by looking the
// rest up on their site once per distinct creator. Only metadata is fetched.

const LOOKUP_PROVIDERS = ["makerworld", "thingiverse", "printables"] as const;
type LookupProvider = (typeof LOOKUP_PROVIDERS)[number];

export type LookupProblem =
  | "thingiverse_no_token"
  | "thingiverse_token_rejected"
  | "thingiverse_rate_limited"
  | "makerworld_captcha"
  | "makerworld_login_rejected";

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

// One model per unmatched creator per site: the newest, as the likeliest still online.
const LOOKUP_CANDIDATES = Prisma.sql`
  SELECT DISTINCT ON (p."sourceProvider", lower(trim(p.creator)))
    p.id AS "printId", p."userId", p."sourceProvider" AS provider, p."sourceExternalId" AS "externalId", p.creator
  FROM "Print" p
  WHERE p."authorId" IS NULL AND p.creator IS NOT NULL AND trim(p.creator) <> ''
    AND p."sourceProvider" IN (${Prisma.join([...LOOKUP_PROVIDERS])}) AND p."sourceExternalId" IS NOT NULL
    AND p.id NOT IN (SELECT print_id FROM (${LINKABLE_PRINTS}) l)
  ORDER BY p."sourceProvider", lower(trim(p.creator)), p."createdAt" DESC
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
  // Turned off by an admin: left alone, not reported as a problem.
  for (const provider of await getDisabledProviders()) skipped.add(provider);
  const thingiverseToken = await getThingiverseAccessToken();
  // Only for providers still on: one turned off isn't missing a token or held by a captcha.
  if (!skipped.has("thingiverse") && !thingiverseToken) skip("thingiverse", "thingiverse_no_token");
  if (!skipped.has("makerworld") && makerworldCaptchaCooloffActive()) skip("makerworld", "makerworld_captcha");

  for (const candidate of candidates) {
    if (skipped.has(candidate.provider)) {
      run.lookedUp++;
      continue;
    }
    let author: ImportedAuthorInfo | null = null;
    try {
      author = await lookUpAuthor(candidate, thingiverseToken);
    } catch (err) {
      if (err instanceof MakerworldCaptchaError) skip("makerworld", "makerworld_captcha");
      else if (err instanceof MakerworldAuthError) skip("makerworld", "makerworld_login_rejected");
      else if (err instanceof ThingiverseAuthError) skip("thingiverse", "thingiverse_token_rejected");
      else if (err instanceof ThingiverseRateLimitError) skip("thingiverse", "thingiverse_rate_limited");
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

async function lookUpAuthor(candidate: Candidate, thingiverseToken: string | null): Promise<ImportedAuthorInfo | null> {
  switch (candidate.provider) {
    case "thingiverse": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveThingiverseThing(candidate.externalId, thingiverseToken!))?.meta.author ?? null;
    }
    case "printables": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolvePrintablesModel(candidate.externalId))?.meta.author ?? null;
    }
    case "makerworld": {
      const cookie = await getUserMakerworldCookie(candidate.userId);
      const bearer = extractMakerworldBearerToken(cookie);
      return bearer
        ? fetchMakerworldDesignAuthor(candidate.externalId, bearer, IMPORT_MAKERWORLD_CALL_DELAY_MS)
        : fetchMakerworldPageAuthor(candidate.externalId, cookie, IMPORT_MAKERWORLD_CALL_DELAY_MS);
    }
  }
}
