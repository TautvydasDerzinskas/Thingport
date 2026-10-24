import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PROVIDER_IDS, type ProviderId } from "../providers/_generated";
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
import { getMyminifactoryApiKey, getThingiverseAccessToken } from "./settingsService";
import { MyminifactoryAuthError, MyminifactoryRateLimitError, resolveMyminifactoryObject } from "./myminifactoryApi";
import { resolveThingiverseThing, ThingiverseAuthError, ThingiverseRateLimitError } from "./thingiverseApi";
import { resolveSnapmakerModel } from "./snapmakerApi";
import { resolveMakeronlineModel } from "./makeronlineApi";
import { resolveCrealitycloudModel } from "./crealitycloudApi";
import { resolveNexprintModel } from "../providers/nexprint/api";
import { resolveThangsModel } from "./thangsApi";
import { Cults3dAuthError, type Cults3dCredentials, Cults3dRateLimitError, resolveCults3dModel } from "./cults3dApi";
import { getUserCults3dCredentials, markCults3dApiRejected } from "./cults3dSessionService";
import { getDisabledProviders } from "./providerSettingsService";

// Links models that only know their author by name: first by name matching, then by looking the
// rest up on their site once per distinct creator. Only metadata is fetched.

export const LOOKUP_PROVIDERS = PROVIDER_IDS;
type LookupProvider = ProviderId;

export type LookupProblem =
  | "thingiverse_no_token"
  | "thingiverse_token_rejected"
  | "thingiverse_rate_limited"
  | "myminifactory_no_key"
  | "myminifactory_key_rejected"
  | "myminifactory_rate_limited"
  | "makerworld_captcha"
  | "makerworld_login_rejected"
  | "cults3d_no_key"
  | "cults3d_key_rejected"
  | "cults3d_rate_limited";

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

// One model per unmatched creator per site: the newest, as the likeliest still online. Cults3D is read only with the
// model's owner's own API key, so there it's the newest of an owner who has a usable one.
const LOOKUP_CANDIDATES = Prisma.sql`
  SELECT DISTINCT ON (p."sourceProvider", lower(trim(p.creator)))
    p.id AS "printId", p."userId", p."sourceProvider" AS provider, p."sourceExternalId" AS "externalId", p.creator
  FROM "Print" p
  JOIN "User" u ON u.id = p."userId"
  WHERE p."authorId" IS NULL AND p.creator IS NOT NULL AND trim(p.creator) <> ''
    AND p."sourceProvider" IN (${Prisma.join([...LOOKUP_PROVIDERS])}) AND p."sourceExternalId" IS NOT NULL
    AND p.id NOT IN (SELECT print_id FROM (${LINKABLE_PRINTS}) l)
  ORDER BY p."sourceProvider", lower(trim(p.creator)),
    (p."sourceProvider" = 'cults3d' AND u."cults3dNick" IS NOT NULL AND u."cults3dApiKey" IS NOT NULL
      AND u."cults3dApiRejectedAt" IS NULL) DESC,
    p."createdAt" DESC
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
  const myminifactoryKey = await getMyminifactoryApiKey();
  if (!skipped.has("myminifactory") && !myminifactoryKey) skip("myminifactory", "myminifactory_no_key");
  if (!skipped.has("makerworld") && makerworldCaptchaCooloffActive()) skip("makerworld", "makerworld_captcha");

  for (const candidate of candidates) {
    if (skipped.has(candidate.provider)) {
      run.lookedUp++;
      continue;
    }
    // Candidates prefer an owner with a key (see LOOKUP_CANDIDATES), so none here means no owner of this creator's
    // models has one: a key to set up, not an author missing.
    const cults3d = candidate.provider === "cults3d" ? await getUserCults3dCredentials(candidate.userId) : null;
    if (candidate.provider === "cults3d" && !cults3d) {
      if (!run.problems.includes("cults3d_no_key")) run.problems.push("cults3d_no_key");
      run.lookedUp++;
      continue;
    }
    let author: ImportedAuthorInfo | null = null;
    try {
      author = await lookUpAuthor(candidate, { thingiverseToken, myminifactoryKey, cults3d });
    } catch (err) {
      if (err instanceof MakerworldCaptchaError) skip("makerworld", "makerworld_captcha");
      else if (err instanceof MakerworldAuthError) skip("makerworld", "makerworld_login_rejected");
      else if (err instanceof ThingiverseAuthError) skip("thingiverse", "thingiverse_token_rejected");
      else if (err instanceof ThingiverseRateLimitError) skip("thingiverse", "thingiverse_rate_limited");
      else if (err instanceof MyminifactoryAuthError) skip("myminifactory", "myminifactory_key_rejected");
      else if (err instanceof MyminifactoryRateLimitError) skip("myminifactory", "myminifactory_rate_limited");
      // Each user's own key: one turned down only stops that user's lookups (see lookUpAuthor).
      else if (err instanceof Cults3dAuthError) {
        if (!run.problems.includes("cults3d_key_rejected")) run.problems.push("cults3d_key_rejected");
      } else if (err instanceof Cults3dRateLimitError) skip("cults3d", "cults3d_rate_limited");
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

async function lookUpAuthor(
  candidate: Candidate,
  keys: { thingiverseToken: string | null; myminifactoryKey: string | null; cults3d: Cults3dCredentials | null },
): Promise<ImportedAuthorInfo | null> {
  switch (candidate.provider) {
    case "thingiverse": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveThingiverseThing(candidate.externalId, keys.thingiverseToken!))?.meta.author ?? null;
    }
    case "myminifactory": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveMyminifactoryObject(candidate.externalId, keys.myminifactoryKey!))?.meta.author ?? null;
    }
    case "printables": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolvePrintablesModel(candidate.externalId))?.meta.author ?? null;
    }
    case "snapmaker": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveSnapmakerModel(candidate.externalId))?.meta.author ?? null;
    }
    case "makeronline": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveMakeronlineModel(candidate.externalId))?.meta.author ?? null;
    }
    case "crealitycloud": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveCrealitycloudModel(candidate.externalId))?.meta.author ?? null;
    }
    case "nexprint": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveNexprintModel(candidate.externalId))?.meta.author ?? null;
    }
    case "thangs": {
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      return (await resolveThangsModel(candidate.externalId))?.meta.author ?? null;
    }
    case "cults3d": {
      // Its API reads only with a user's own key: the model's importer's.
      await maybeSleep(IMPORT_COLLECTION_DELAY_MS);
      try {
        return (await resolveCults3dModel(candidate.externalId, keys.cults3d!))?.meta.author ?? null;
      } catch (err) {
        // Remembered, so the rest of this user's models don't ask with it again; other users' keys still work.
        if (err instanceof Cults3dAuthError) await markCults3dApiRejected(candidate.userId);
        throw err;
      }
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
