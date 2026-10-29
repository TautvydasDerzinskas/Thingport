import fs from "node:fs/promises";
import path from "node:path";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { mapWithConcurrency } from "../utils/concurrency";
import { isProviderId } from "../providers/index.generated";
import { PROVIDERS } from "../providers/registry";
import { buildImportSourceUrl } from "./importService";

// Finding the models whose files are gone. An instance moved without its storage volume, or a deleted folder,
// leaves every row in place with nothing behind it: the library lists models that can't be opened, printed or
// pictured. The repair the owner is then offered is in modelRepairService.ts.
//
// A model counts as broken only when it has files recorded and none of them is there -- neither where Thingport
// put it nor where it was consumed from. One plate of several missing is a lesser problem with its own answer
// (the model still opens), and a model whose pictures alone are gone isn't counted at all: its files still print.

const log = createLogger("missing-files");

/** Enough at once to keep a network volume busy without opening thousands of handles. */
const STAT_CONCURRENCY = 32;
/** A scan walks every file of the library, so the answer is kept for this long. */
const CACHE_MS = 5 * 60 * 1000;
/** Below this, a lost file is one file rather than an accident worth interrupting over. */
const PROMPT_MIN_BROKEN = 3;
/** And it has to be a fair share of the library, so a handful of tidied-up models never prompts. */
const PROMPT_MIN_SHARE = 0.1;

/** How a broken model can get its files back. */
export type RepairRoute =
  /** Its provider's files download here. */
  | "server"
  /** Only Thingport Grab can fetch them, on the provider's own pages. */
  | "grab"
  /** An upload, or a model a tool brought: there is no source to fetch from. */
  | "none";

export type BrokenModel = {
  id: string;
  name: string;
  provider: string | null;
  /** The id its provider keeps it under, for fetching its files again. */
  externalId: string | null;
  sourceUrl: string | null;
  route: RepairRoute;
};

export type MissingFilesScan = {
  /** The user's models, counting only those with files recorded. */
  total: number;
  broken: BrokenModel[];
  scannedAt: string;
};

export type MissingFilesSummary = {
  total: number;
  broken: number;
  /** Of the broken ones, by how they'd be repaired. */
  server: number;
  grab: number;
  noSource: number;
  byProvider: { provider: string | null; count: number }[];
  /** A few names, to show what kind of models these are. */
  sample: { id: string; name: string }[];
  scannedAt: string;
  /** Whether this looks like an accident worth asking the owner about, rather than a model or two. */
  prompt: boolean;
};

type CacheEntry = { scan: MissingFilesScan; at: number };
const cache = new Map<string, CacheEntry>();

const exists = (absolute: string) =>
  fs.access(absolute).then(
    () => true,
    () => false,
  );

type PlateFile = { storagePath: string; sourcePath: string | null };

/** Where a plate's file would be: under storage, or the folder it was consumed from in place. */
async function plateFileThere(plate: PlateFile): Promise<boolean> {
  if (await exists(path.join(STORAGE, plate.storagePath))) return true;
  return plate.sourcePath ? exists(plate.sourcePath) : false;
}

function routeOf(print: { sourceProvider: string | null; sourceExternalId: string | null }) {
  if (!print.sourceProvider || !print.sourceExternalId || !isProviderId(print.sourceProvider)) return "none" as const;
  return PROVIDERS[print.sourceProvider].grabQueue ? ("grab" as const) : ("server" as const);
}

/** The rule the scan goes by, for one model: it has files recorded and not one of them is there. Shared with the
 *  import paths that repair a model when Thingport Grab brings its files (providers/makeronline, providers/owlcad). */
export async function modelFilesMissing(plates: PlateFile[]): Promise<boolean> {
  if (!plates.length) return false;
  for (const plate of plates) if (await plateFileThere(plate)) return false;
  return true;
}

/** Every model of the user's whose files are all missing. Reads the recorded paths rather than walking storage, so
 *  it only ever asks about files a model claims to have. */
export async function scanMissingFiles(userId: string): Promise<MissingFilesScan> {
  const started = Date.now();
  const prints = await prisma.print.findMany({
    // A tool's models are the tool's to bring back (services/toolsService.ts), not a repair's.
    where: { userId, toolId: null },
    select: {
      id: true,
      name: true,
      title: true,
      sourceProvider: true,
      sourceExternalId: true,
      plates: { select: { storagePath: true, sourcePath: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const withFiles = prints.filter((print) => print.plates.length > 0);
  const checked = await mapWithConcurrency(withFiles, STAT_CONCURRENCY, async (print) => ({
    print,
    broken: await modelFilesMissing(print.plates),
  }));

  const broken: BrokenModel[] = [];
  for (const { print, broken: isBroken } of checked) {
    if (!isBroken) continue;
    broken.push({
      id: print.id,
      name: print.title?.trim() || print.name,
      provider: print.sourceProvider,
      externalId: print.sourceExternalId,
      sourceUrl: buildImportSourceUrl(print.sourceProvider, print.sourceExternalId),
      route: routeOf(print),
    });
  }

  const scan: MissingFilesScan = {
    total: withFiles.length,
    broken,
    scannedAt: new Date().toISOString(),
  };
  log.info("scanned", { user: userId, models: withFiles.length, broken: broken.length, ms: Date.now() - started });
  return scan;
}

/** The last scan, scanning afresh when there is none, it has gone stale, or `refresh` asks for one. */
export async function missingFilesScan(userId: string, { refresh = false } = {}): Promise<MissingFilesScan> {
  const cached = cache.get(userId);
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return cached.scan;
  const scan = await scanMissingFiles(userId);
  cache.set(userId, { scan, at: Date.now() });
  return scan;
}

/** After a repair, so the next look reports what it left. */
export function forgetMissingFilesScan(userId: string): void {
  cache.delete(userId);
}

export function summarize(scan: MissingFilesScan): MissingFilesSummary {
  const counts = new Map<string | null, number>();
  for (const model of scan.broken) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  const broken = scan.broken.length;
  return {
    total: scan.total,
    broken,
    server: scan.broken.filter((model) => model.route === "server").length,
    grab: scan.broken.filter((model) => model.route === "grab").length,
    noSource: scan.broken.filter((model) => model.route === "none").length,
    byProvider: [...counts.entries()]
      .map(([provider, count]) => ({ provider, count }))
      .toSorted((a, b) => b.count - a.count || (a.provider ?? "").localeCompare(b.provider ?? "")),
    sample: scan.broken.slice(0, 5).map((model) => ({ id: model.id, name: model.name })),
    scannedAt: scan.scannedAt,
    prompt: broken >= PROMPT_MIN_BROKEN && broken >= scan.total * PROMPT_MIN_SHARE,
  };
}
