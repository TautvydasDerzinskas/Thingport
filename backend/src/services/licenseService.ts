// A model's licence: what its source lists, kept from the import, or what its owner picked. An import from before
// licences were kept has none yet; its owner opening it reads one (POST /print/:id/license/fill), one model at a time,
// as print profiles are read. A licence the owner picked is theirs: no read from the source replaces it.

import { Prisma, type Print } from "@prisma/client";
import { LICENSE_READ_TIMEOUT_MS, PROFILE_FILL_AFTER_IMPORT_MS } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { isProviderId, MANIFESTS } from "../providers/index.generated";
import { HttpError } from "../utils/fileUtils";
import { isProviderEnabled } from "./providerSettingsService";
import {
  LICENSE_ACTIONS,
  LICENSE_MAP_VERSION,
  licenseById,
  PICKABLE_LICENSE_IDS,
  type LicenseAction,
  type LicenseFamily,
  type LicenseMark,
  type ProviderLicense,
} from "./licenseCatalog";

const log = createLogger("licenses");

/** Print.license. */
export type StoredLicense = ProviderLicense & {
  source: "provider" | "user";
  /** The provider it was read from. */
  provider?: string | null;
  /** LICENSE_MAP_VERSION it was read with. */
  v: number;
};

export type LicenseOut = {
  id: string | null;
  short: string;
  name: string;
  url: string | null;
  /** Null for a licence Thingport doesn't know: its terms are all there is to go by. */
  family: LicenseFamily | null;
  marks: LicenseMark[];
  allows: LicenseAction[];
  requires: { credit: boolean; same_license: boolean };
  terms: string | null;
  source: "provider" | "user";
  provider: string | null;
};

type LicenseFields = Pick<Print, "id" | "license" | "licenseReadAt" | "sourceProvider" | "sourceExternalId">;

export function storedLicense(value: Prisma.JsonValue | null | undefined): StoredLicense | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.source !== "provider" && row.source !== "user") return null;
  return row as unknown as StoredLicense;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export function allowsOf(license: ProviderLicense | null): LicenseAction[] {
  if (!license) return [];
  const actions = license.allows ?? licenseById(license.id)?.allows ?? [];
  return LICENSE_ACTIONS.filter((action) => actions.includes(action));
}

/** The columns for a licence, read from `provider` or picked by the owner. */
export function licenseData(
  license: ProviderLicense | null,
  source: StoredLicense["source"],
  provider: string | null,
): Pick<Prisma.PrintUncheckedCreateInput, "license" | "licenseAllows" | "licenseReadAt"> {
  const stored: StoredLicense | null = license
    ? {
        id: license.id,
        raw: license.raw,
        ...(text(license.label) ? { label: text(license.label) } : {}),
        ...(text(license.url) ? { url: text(license.url) } : {}),
        ...(text(license.terms) ? { terms: text(license.terms) } : {}),
        ...(license.allows ? { allows: allowsOf(license) } : {}),
        ...(license.requires ? { requires: license.requires } : {}),
        source,
        provider,
        v: LICENSE_MAP_VERSION,
      }
    : null;
  return {
    license: stored ? (stored as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    licenseAllows: allowsOf(stored),
    licenseReadAt: new Date(),
  };
}

/** For a new model: what its import read, or nothing when it didn't look (then its owner opening it reads it). */
export function importedLicenseData(
  provider: string | null | undefined,
  license: ProviderLicense | null | undefined,
): Partial<Pick<Prisma.PrintUncheckedCreateInput, "license" | "licenseAllows" | "licenseReadAt">> {
  if (!provider || license === undefined) return {};
  return licenseData(license, "provider", provider);
}

export function licenseOut(print: Pick<Print, "license">): LicenseOut | null {
  const stored = storedLicense(print.license);
  if (!stored) return null;
  const def = licenseById(stored.id);
  const label = text(stored.label);
  return {
    id: def?.id ?? null,
    short: def ? (label && def.family === "site" ? label : def.short) : (label ?? stored.raw),
    name: def ? (label ?? def.name) : (label ?? stored.raw),
    url: text(stored.url) ?? def?.url ?? null,
    family: def?.family ?? null,
    marks: def?.marks ?? [],
    allows: allowsOf(stored),
    requires: {
      credit: stored.requires?.credit ?? def?.requires.credit ?? false,
      same_license: stored.requires?.sameLicense ?? def?.requires.sameLicense ?? false,
    },
    terms: text(stored.terms) ?? def?.text ?? null,
    source: stored.source,
    provider: stored.provider ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading an older import's licence

// A source that couldn't be read is asked again only after this, after a restart, or when its owner retries.
const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const triedAt = new Map<string, number>();
// Of those, the ones that failed, rather than had a site that couldn't say: their page offers to try again.
const failed = new Set<string>();

function markTried(printId: string, didFail: boolean): void {
  triedAt.set(printId, Date.now());
  if (didFail) failed.add(printId);
  else failed.delete(printId);
}

function forgetTries(printId: string): void {
  triedAt.delete(printId);
  failed.delete(printId);
}

/** The last read of its source failed, and it hasn't been read since. */
export function licenseReadFailed(printId: string): boolean {
  return failed.has(printId);
}

/** Reading the source now would find something: an import never read, or read before its provider's mapping changed.
 *  Never one whose owner picked the licence. */
export function licensePending(print: LicenseFields, now = Date.now()): boolean {
  if (!isProviderId(print.sourceProvider) || !print.sourceExternalId) return false;
  const stored = storedLicense(print.license);
  if (stored?.source === "user") return false;
  if (print.licenseReadAt && (!stored || stored.v >= LICENSE_MAP_VERSION)) return false;
  const tried = triedAt.get(print.id);
  return tried === undefined || now - tried >= RETRY_AFTER_MS;
}

async function readSourceLicense(
  userId: string,
  provider: string,
  externalId: string,
  notes: string | null,
): Promise<ProviderLicense | null | undefined> {
  if (!isProviderId(provider)) return undefined;
  const { PROVIDERS } = await import("../providers/registry");
  const backend = PROVIDERS[provider];
  if (backend.license) return backend.license(userId, externalId, { notes });
  const meta = await backend.details.read(userId, externalId);
  // The provider doesn't know the model any more: nothing will say.
  if (!meta) return null;
  return meta.license;
}

/** One read of a model's licence. `late` once it has been given up on: what it finds after that is dropped, as its
 *  model has moved on, counted as failed or read again. */
type Attempt = { late: boolean };

async function fillLicense(printId: string, attempt: Attempt = { late: false }): Promise<void> {
  const print = await prisma.print.findUnique({
    where: { id: printId },
    select: {
      id: true,
      userId: true,
      notes: true,
      license: true,
      licenseReadAt: true,
      sourceProvider: true,
      sourceExternalId: true,
    },
  });
  if (!print || !licensePending(print)) return;
  // An admin turned its site off: it's left alone, as by every other background job.
  if (!(await isProviderEnabled(print.sourceProvider!))) {
    if (!attempt.late) markTried(print.id, true);
    return;
  }
  let license: ProviderLicense | null | undefined;
  try {
    license = await readSourceLicense(print.userId, print.sourceProvider!, print.sourceExternalId!, print.notes);
  } catch (err) {
    if (attempt.late) return;
    markTried(print.id, true);
    log.warn("couldn't read the model's licence", { print: print.id, provider: print.sourceProvider, err });
    return;
  }
  if (attempt.late) return;
  if (license === undefined) {
    markTried(print.id, false);
    return;
  }
  forgetTries(print.id);
  // The owner may have picked one while it was read.
  const updated = await prisma.print.updateMany({
    where: {
      id: print.id,
      OR: [{ license: { equals: Prisma.DbNull } }, { license: { path: ["source"], equals: "provider" } }],
    },
    data: licenseData(license, "provider", print.sourceProvider),
  });
  if (updated.count) await afterLicenseChange(print.id);
}

// One model at a time, so a page full of older imports doesn't ask every site at once.
let queue: Promise<void> = Promise.resolve();
const waiting = new Set<string>();
const running = new Set<string>();
const settling = new Map<string, NodeJS.Timeout>();
// Retries asked for while a read of the model runs: it's read again once that one is done.
const retryAfter = new Set<string>();

/** Reads the model's licence in the background, once however often it's asked while it waits or runs. */
export function startLicenseFill(printId: string): void {
  if (waiting.has(printId) || running.has(printId)) return;
  waiting.add(printId);
  queue = queue
    .then(async () => {
      waiting.delete(printId);
      running.add(printId);
      await withinTime((attempt) => fillLicense(printId, attempt), LICENSE_READ_TIMEOUT_MS);
    })
    .catch((err) => {
      // Failed before it could say so: its page offers to try again, rather than read it as none stated.
      markTried(printId, true);
      log.warn("reading a licence failed", { print: printId, err });
    })
    .finally(() => {
      running.delete(printId);
      if (retryAfter.delete(printId)) {
        forgetTries(printId);
        startLicenseFill(printId);
      }
    });
}

/** `work`, or a failure once `ms` have passed. It's told it's late then, and left to finish on its own. */
function withinTime(work: (attempt: Attempt) => Promise<void>, ms: number): Promise<void> {
  const attempt: Attempt = { late: false };
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      attempt.late = true;
      reject(new Error(`no answer after ${ms} ms`));
    }, ms);
    timer.unref?.();
  });
  return Promise.race([work(attempt), late]).finally(() => clearTimeout(timer));
}

export function licenseFillRunning(printId: string): boolean {
  return waiting.has(printId) || running.has(printId) || settling.has(printId);
}

/** For an import that didn't read the licence (Grab's cut-down MakerWorld design): reads it once the import settles. */
export function scheduleLicenseFill(printId: string): void {
  if (PROFILE_FILL_AFTER_IMPORT_MS < 0) return;
  clearTimeout(settling.get(printId));
  const timer = setTimeout(() => {
    settling.delete(printId);
    startLicenseFill(printId);
  }, PROFILE_FILL_AFTER_IMPORT_MS);
  timer.unref?.();
  settling.set(printId, timer);
}

/** For its owner's Retry: reads it now, however recently a read failed. */
export function retryLicenseFill(print: LicenseFields): void {
  // One running now may be about to record a failure: read again after it, rather than forget now what it records.
  if (running.has(print.id)) {
    retryAfter.add(print.id);
    return;
  }
  forgetTries(print.id);
  if (licensePending(print)) startLicenseFill(print.id);
}

export type PrintLicenseState = { license: LicenseOut | null; pending: boolean; filling: boolean; failed: boolean };

export function printLicenseState(print: LicenseFields & Pick<Print, "license">): PrintLicenseState {
  const filling = licenseFillRunning(print.id);
  return {
    license: licenseOut(print),
    pending: licensePending(print),
    filling,
    failed: !filling && licenseReadFailed(print.id),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The owner's pick

/** "source": what the model's source lists, read again. */
export const SOURCE_LICENSE = "source";

/** Refuses a pick that can't be set on this model, before anything else of an edit is saved. */
export function assertLicenseChoice(print: Pick<Print, "sourceProvider">, choice: string | null): void {
  if (choice === SOURCE_LICENSE) {
    if (!print.sourceProvider) throw new HttpError(400, "This model has no source to take a licence from");
    return;
  }
  if (choice === null) {
    if (print.sourceProvider) throw new HttpError(400, "Pick a licence, or the one its source lists");
    return;
  }
  const def = licenseById(choice);
  if (!def || !PICKABLE_LICENSE_IDS.includes(def.id)) throw new HttpError(400, "Unknown licence");
}

/** Sets the licence its owner picked: a catalogue id, SOURCE_LICENSE, or null for none (a model with no source). */
export async function setOwnerLicense(
  print: Pick<Print, "id" | "sourceProvider">,
  choice: string | null,
): Promise<void> {
  assertLicenseChoice(print, choice);
  if (choice === SOURCE_LICENSE) {
    await prisma.print.update({
      where: { id: print.id },
      data: { license: Prisma.DbNull, licenseAllows: [], licenseReadAt: null },
    });
    forgetTries(print.id);
    await afterLicenseChange(print.id);
    startLicenseFill(print.id);
    return;
  }
  if (choice === null) {
    await prisma.print.update({ where: { id: print.id }, data: { license: Prisma.DbNull, licenseAllows: [] } });
    await afterLicenseChange(print.id);
    return;
  }
  const def = licenseById(choice)!;
  await prisma.print.update({
    where: { id: print.id },
    data: licenseData({ id: def.id, raw: def.id }, "user", null),
  });
  await afterLicenseChange(print.id);
}

/** What changes with the licence: the LICENSE.txt beside the files. Never throws. */
export async function afterLicenseChange(printId: string): Promise<void> {
  const { syncLicenseFile } = await import("./licenseFile");
  await syncLicenseFile(printId).catch((err) => log.warn("couldn't write LICENSE.txt", { print: printId, err }));
}

/** The provider's name for a sentence. */
export function providerName(provider: string | null | undefined): string | null {
  return provider && isProviderId(provider) ? MANIFESTS[provider].name : null;
}
