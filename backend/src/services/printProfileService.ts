// The print profiles a model was imported with, as the model page shows them: each profile's plate keeps what its
// provider said and what its own 3MF says (Plate.profile), and the page sees the two merged. A profile is read when it
// comes in, and an older import's when its owner first opens it, in the background, one model at a time.

import fs from "node:fs";
import type { Plate, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { PROFILE_FILL_AFTER_IMPORT_MS } from "../config";
import { createLogger } from "../logger";
import { isProviderId } from "../providers/index.generated";
import type { ProviderBackend } from "../providers/registry";
import { resolvePlateFilePath } from "./printCreation";
import {
  isProfileProject,
  projectFilaments,
  readProfileFile,
  type ProfileFileFacts,
  type ProfileFilePlate,
} from "./printProfileFile";
import { rounded, type ProfileFilament, type ProviderProfileFacts } from "./printProfileFacts";

/** Bumped when the 3MF reader learns something new, so stored profiles are read again. */
export const PROFILE_FILE_VERSION = 1;
/** The same for the providers' readers. */
export const PROFILE_PROVIDER_VERSION = 1;
/** How long a provider that had no answer for a profile is left alone before it's asked again. */
const PROVIDER_RETRY_MS = 24 * 60 * 60 * 1000;

const log = createLogger("profiles");

/** Plate.profile: what each source said, kept apart, so a newer reader of one keeps the other's. */
export type StoredProfile = {
  file?: ProfileFileFacts | null;
  fileVersion?: number;
  /** The file it was read from, by size and modification time: one edited since is read again. */
  fileStamp?: string | null;
  provider?: ProviderProfileFacts | null;
  providerVersion?: number;
  /** When the provider last had no answer for it (failed, or didn't know it). */
  providerTriedAt?: string | null;
};

export type ProfilePlateOut = {
  index: number;
  name: string | null;
  seconds: number | null;
  grams: number | null;
  filaments: ProfileFilament[];
  objects: number | null;
  /** The plate's picture from the 3MF; null when it has none. */
  thumb_url: string | null;
};

/** A print profile as the model page shows it. Absent facts are null or empty; the title falls back to the file's. */
export type PrintProfileOut = {
  title: string | null;
  description: string | null;
  origin: "designer" | "community" | null;
  creator: string | null;
  seconds: number | null;
  grams: number | null;
  filaments: ProfileFilament[];
  plates: ProfilePlateOut[];
  printer: string | null;
  nozzle_mm: number | null;
  layer_mm: number | null;
  infill: string | null;
  walls: number | null;
  supports: boolean | null;
};

type ProfilePlate = Pick<Plate, "id" | "sourceInstanceId" | "profile" | "updatedAt" | "storagePath" | "sourcePath">;

export function storedProfile(value: Prisma.JsonValue | null | undefined): StoredProfile | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as StoredProfile) : null;
}

/** Every value known, else null: a total only adds up when no part is missing. */
function sumOf(values: (number | null | undefined)[]): number | null {
  if (!values.length || values.some((value) => value == null)) return null;
  return rounded(
    values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    2,
  );
}

/** A sliced plate whose filament list is whole: none missing a weight, so it can stand for the plate. */
function hasAllFilaments(plate: ProfileFilePlate | undefined): boolean {
  return Boolean(plate?.filaments.length) && plate!.filamentsComplete !== false;
}

function thumbUrl(plate: Pick<Plate, "id" | "updatedAt">, index: number): string {
  return `/plate/${plate.id}/profile-plate/${index}.png?v=${plate.updatedAt.getTime()}`;
}

/**
 * The two sources as one. The 3MF is exact for the file that's here, so what it says wins: its printer and settings,
 * its plates, and its time and filament when it was uploaded sliced. The provider fills the rest -- the name, whose it
 * is, and the times and filament of its own slice of the profile, which most 3MFs don't carry.
 */
export function profileOut(plate: ProfilePlate): PrintProfileOut | null {
  if (!plate.sourceInstanceId) return null;
  const stored = storedProfile(plate.profile);
  const file = stored?.file ?? null;
  const provider = stored?.provider ?? null;
  const providerPlates = provider?.plates ?? [];
  const basePlates = file?.plates.length
    ? file.plates
    : providerPlates.map((p) => ({ index: p.index, name: null, objects: null, thumb: false }));
  const plates = basePlates.map((base): ProfilePlateOut => {
    const sliced = file?.plates.find((p) => p.index === base.index);
    const site = providerPlates.find((p) => p.index === base.index);
    return {
      index: base.index,
      name: base.name ?? site?.name ?? null,
      seconds: sliced?.seconds ?? site?.seconds ?? null,
      grams: sliced?.grams ?? site?.grams ?? null,
      filaments: hasAllFilaments(sliced) ? sliced!.filaments : (site?.filaments ?? sliced?.filaments ?? []),
      objects: base.objects,
      thumb_url: base.thumb ? thumbUrl(plate, base.index) : null,
    };
  });
  // Only a project sliced whole speaks for the whole, and each total only where every plate gave it: otherwise it's the
  // provider's.
  const filePlates = file?.plates ?? [];
  const fileTotal = (pick: (p: ProfileFilePlate) => number | null) =>
    filePlates.length && filePlates.every((p) => pick(p) != null) ? sumOf(filePlates.map(pick)) : null;
  const seconds = fileTotal((p) => p.seconds) ?? provider?.seconds ?? null;
  const grams = fileTotal((p) => p.grams) ?? provider?.grams ?? null;
  const fileFilaments = filePlates.length && filePlates.every(hasAllFilaments) ? projectFilaments(filePlates) : [];
  const filaments = fileFilaments.length ? fileFilaments : (provider?.filaments ?? []);
  return {
    title: provider?.title ?? null,
    description: provider?.description ?? null,
    origin: provider?.origin ?? null,
    creator: provider?.creator ?? null,
    seconds: seconds ?? sumOf(plates.map((p) => p.seconds)),
    grams: grams ?? sumOf(plates.map((p) => p.grams)),
    filaments: filaments.length ? filaments : projectFilaments(plates),
    plates,
    printer: file?.printer ?? provider?.printer ?? null,
    nozzle_mm: file?.nozzleMm ?? provider?.nozzleMm ?? null,
    layer_mm: file?.layerMm ?? provider?.layerMm ?? null,
    infill: file?.infill ?? provider?.infill ?? null,
    walls: file?.walls ?? provider?.walls ?? null,
    supports: file?.supports ?? provider?.supports ?? null,
  };
}

/** The file a profile plate has now, by size and modification time; null while it's missing. */
function fileStampOf(plate: Pick<Plate, "storagePath" | "sourcePath">): string | null {
  const filePath = resolvePlateFilePath(plate);
  if (!filePath) return null;
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

/** Never read by this reader, or read from a file that has changed since. A missing file is read once it's back. */
function needsFile(stored: StoredProfile | null, stamp: string | null): boolean {
  if ((stored?.fileVersion ?? 0) < PROFILE_FILE_VERSION) return true;
  return stamp !== null && stored?.fileStamp !== stamp;
}

function needsProvider(stored: StoredProfile | null, now: number): boolean {
  if ((stored?.providerVersion ?? 0) >= PROFILE_PROVIDER_VERSION) return false;
  const tried = stored?.providerTriedAt ? Date.parse(stored.providerTriedAt) : NaN;
  return !Number.isFinite(tried) || now - tried >= PROVIDER_RETRY_MS;
}

/** Whether a fill would read anything for these plates now. `providerReads` says whether the model's provider has
 *  profile facts to read at all. */
export function profilesPending(
  plates: Pick<Plate, "sourceInstanceId" | "profile" | "storagePath" | "sourcePath">[],
  providerReads: boolean,
): boolean {
  const now = Date.now();
  return plates.some((plate) => {
    if (!plate.sourceInstanceId) return false;
    const stored = storedProfile(plate.profile);
    return needsFile(stored, fileStampOf(plate)) || (providerReads && needsProvider(stored, now));
  });
}

/** Whether the provider reads profile facts. Loaded when asked: the registry reaches the import pipeline, which reaches
 *  this. */
async function providerFactsReader(provider: string | null): Promise<ProviderBackend["profileFacts"] | null> {
  if (!isProviderId(provider)) return null;
  const { PROVIDERS } = await import("../providers/registry");
  return PROVIDERS[provider].profileFacts ?? null;
}

export async function providerReadsProfiles(provider: string | null): Promise<boolean> {
  return Boolean(await providerFactsReader(provider));
}

/** Reads what's missing of a model's profiles and stores it. Never throws: whatever can't be read now is read later. */
async function fillProfiles(printId: string): Promise<void> {
  const print = await prisma.print.findUnique({
    where: { id: printId },
    select: {
      userId: true,
      sourceProvider: true,
      sourceExternalId: true,
      plates: {
        where: { sourceInstanceId: { not: null } },
        select: {
          id: true,
          sourceInstanceId: true,
          profile: true,
          filename: true,
          storagePath: true,
          sourcePath: true,
        },
      },
    },
  });
  if (!print?.plates.length) return;
  const now = Date.now();
  const next = new Map(print.plates.map((plate) => [plate.id, { ...storedProfile(plate.profile) }]));

  for (const plate of print.plates) {
    const stored = next.get(plate.id)!;
    const stamp = fileStampOf(plate);
    // A missing file is read once it's back, rather than remembered as saying nothing.
    if (!needsFile(stored, stamp) || stamp === null) continue;
    try {
      stored.file = isProfileProject(plate.filename) ? await readProfileFile(resolvePlateFilePath(plate)!) : null;
    } catch (err) {
      // The disk failed it: tried again on a later fill.
      log.warn("couldn't read a print profile's file", { print: printId, plate: plate.id, err });
      continue;
    }
    stored.fileVersion = PROFILE_FILE_VERSION;
    stored.fileStamp = stamp;
  }

  const read = await providerFactsReader(print.sourceProvider);
  const wanted = read ? print.plates.filter((plate) => needsProvider(next.get(plate.id)!, now)) : [];
  if (read && wanted.length && print.sourceExternalId) {
    let facts: Awaited<ReturnType<typeof read>> = null;
    try {
      facts = await read(
        print.userId,
        print.sourceExternalId,
        wanted.map((plate) => plate.sourceInstanceId!),
      );
    } catch (err) {
      log.warn("couldn't read the model's print profiles", { print: printId, provider: print.sourceProvider, err });
    }
    for (const plate of wanted) {
      const stored = next.get(plate.id)!;
      const found = facts?.[plate.sourceInstanceId!];
      if (found) {
        const { partial, ...said } = found;
        stored.provider = said;
        // What came is kept either way; a profile read only in part is asked for again later.
        if (partial) {
          stored.providerTriedAt = new Date(now).toISOString();
        } else {
          stored.providerVersion = PROFILE_PROVIDER_VERSION;
          stored.providerTriedAt = null;
        }
      } else {
        stored.providerTriedAt = new Date(now).toISOString();
      }
    }
  }

  for (const plate of print.plates) {
    const stored = next.get(plate.id)!;
    if (JSON.stringify(stored) === JSON.stringify(storedProfile(plate.profile) ?? {})) continue;
    // The plate may have gone while this ran.
    await prisma.plate
      .update({ where: { id: plate.id }, data: { profile: stored as Prisma.InputJsonValue } })
      .catch(() => undefined);
  }
}

// One model at a time, so a page full of older imports doesn't fire every provider request at once.
let queue: Promise<void> = Promise.resolve();
const waiting = new Set<string>();
const running = new Set<string>();
// Asked for while running: it read the model before what's new arrived, so another pass follows.
const again = new Set<string>();
const settling = new Map<string, NodeJS.Timeout>();

/** Fills a model's profiles in the background: once however often it's asked while it waits, and once more when asked
 *  while it runs. */
export function startProfileFill(printId: string): void {
  if (waiting.has(printId)) return;
  if (running.has(printId)) {
    again.add(printId);
    return;
  }
  waiting.add(printId);
  queue = queue
    .then(async () => {
      waiting.delete(printId);
      running.add(printId);
      await fillProfiles(printId);
    })
    .catch((err) => log.warn("reading print profiles failed", { print: printId, err }))
    .finally(() => {
      running.delete(printId);
      if (again.delete(printId)) startProfileFill(printId);
    });
}

/** Whether a fill of the model is waiting or running. */
export function profileFillRunning(printId: string): boolean {
  return waiting.has(printId) || running.has(printId) || settling.has(printId);
}

/** For an import that just added a profile: fills the model once its import has settled. */
export function scheduleProfileFill(printId: string): void {
  if (PROFILE_FILL_AFTER_IMPORT_MS < 0) return;
  clearTimeout(settling.get(printId));
  const timer = setTimeout(() => {
    settling.delete(printId);
    startProfileFill(printId);
  }, PROFILE_FILL_AFTER_IMPORT_MS);
  timer.unref?.();
  settling.set(printId, timer);
}

export type PrintProfilesOut = {
  /** A fill would read something now: the model page starts one for its owner. */
  pending: boolean;
  /** One is waiting or running. */
  filling: boolean;
  /** By plate id, for the model's profile plates. */
  profiles: Record<string, PrintProfileOut>;
};

/** The model's profiles as they stand. `filling` is whether a fill was waiting or running when `plates` were read
 *  (profileFillRunning, taken before reading them): taken after, a fill finishing in between would say it's done while
 *  what was read is from before it, and a page following along would stop there, showing that. */
export async function printProfilesOut(
  print: { id: string; sourceProvider: string | null },
  plates: ProfilePlate[],
  filling: boolean,
): Promise<PrintProfilesOut> {
  const profilePlates = plates.filter((plate) => plate.sourceInstanceId);
  const profiles: Record<string, PrintProfileOut> = {};
  for (const plate of profilePlates) {
    const out = profileOut(plate);
    if (out) profiles[plate.id] = out;
  }
  return {
    pending: profilesPending(profilePlates, await providerReadsProfiles(print.sourceProvider)),
    filling,
    profiles,
  };
}
