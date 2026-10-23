import path from "node:path";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { assetTarget, descriptionImageFile, galleryImageFile } from "./modelAssets";
import type { FileContent, StoredCopy } from "./fileReuse";

// Finds the stored copies of a new file by content, across every kind of file that's shared (see getFileReuse): the
// same bytes may be a plate's model file for one user and a supporting file or a gallery picture for another, and a
// clone doesn't care which. Each kind keeps its own rows and hash; only the bytes on disk are shared, as independent
// copies, so nothing here ever points one row at another's path.
//
// Imports only config, db and modelAssets, with the path rules of printService and printFileService repeated below:
// both of those import services that look files up here, so importing them back would be a cycle.

type Candidate = { createdAt: Date; copy: StoredCopy };

/** The legacy shared folder of print files, which isn't ours to share from. */
export const LEGACY_BUNDLES = "bundles/";

export type StoredKind = "plate" | "printFile" | "previewImage" | "descriptionImage";

// Where each kind of stored file lives, in one place: the lookup below, the backfill and anything that copies a whole
// model's files (it resolves each row's source here) all go through these. Null when the file isn't Thingport's to
// share or move: left where it was found (a plate's sourcePath), outside storage, or a picture of a model with no
// folder of its own (an old shared folder).
export type StoredRow =
  | { kind: "plate"; storagePath: string; sourcePath: string | null }
  | { kind: "printFile"; storagePath: string }
  | { kind: "previewImage"; id: string; assetsPath: string | null }
  | { kind: "descriptionImage"; id: string; mime: string; assetsPath: string | null };

export function managedPathOf(row: StoredRow): string | null {
  switch (row.kind) {
    case "plate":
    case "printFile": {
      // A plate left where it was found (sourcePath) and the legacy shared folder (LEGACY_BUNDLES) aren't ours to
      // share from, whatever the row says. A path that leaves storage isn't either (as in managedPrintFilePath).
      const ours = row.kind === "plate" ? row.sourcePath === null : !row.storagePath.startsWith(LEGACY_BUNDLES);
      return ours ? inStorage(path.join(STORAGE, row.storagePath)) : null;
    }
    case "previewImage":
      return row.assetsPath ? inStorage(assetTarget(row.assetsPath, galleryImageFile(row.id))) : null;
    case "descriptionImage":
      return row.assetsPath ? inStorage(assetTarget(row.assetsPath, descriptionImageFile(row))) : null;
  }
}

// Each kind is asked for this many, and the newest of them all are kept: a few stored copies are enough, as each is only
// tried if the ones before it couldn't be shared (see StoredCopyFinder).
const PER_KIND = 3;

/** Only files that sit in Thingport's own storage folder, whatever the row says. */
function inStorage(candidate: string): string | null {
  const root = path.resolve(STORAGE);
  const resolved = path.resolve(candidate);
  return resolved !== root && resolved.startsWith(root + path.sep) ? resolved : null;
}

type Delegate = {
  count(args: object): Promise<number>;
  findMany(args: object): Promise<any[]>;
  findUnique(args: object): Promise<any>;
  updateMany(args: object): Promise<unknown>;
};
export const delegate = (kind: StoredKind) => prisma[kind] as unknown as Delegate;

/** What a row's hash and sharing record are reset to when its file no longer matches. */
export const DROP = { contentSha256: null, reuseIno: null, reuseCtimeNs: null };

const WITH_HOME = { print: { select: { assetsPath: true } } };

/** What each kind is looked up and turned into a StoredRow by: `managed` is only what managedPathOf would accept
 *  anyway (so queries and counts don't include what can't be done), `select` what toRow needs. */
export const STORED: Record<StoredKind, { managed: object; select: object; toRow: (row: any) => StoredRow }> = {
  plate: {
    managed: { sourcePath: null },
    select: { id: true, storagePath: true, sourcePath: true },
    toRow: (row) => ({ kind: "plate", storagePath: row.storagePath, sourcePath: row.sourcePath }),
  },
  printFile: {
    // Any role: a prepared print file is as much a file of the user's as a supporting one.
    managed: { storagePath: { not: { startsWith: LEGACY_BUNDLES } } },
    select: { id: true, storagePath: true },
    toRow: (row) => ({ kind: "printFile", storagePath: row.storagePath }),
  },
  previewImage: {
    // Only a model with a folder of its own: without one the picture is in an old shared folder, not ours to share.
    managed: { print: { assetsPath: { not: null } } },
    select: { id: true, ...WITH_HOME },
    toRow: (row) => ({ kind: "previewImage", id: row.id, assetsPath: row.print?.assetsPath ?? null }),
  },
  descriptionImage: {
    managed: { print: { assetsPath: { not: null } } },
    select: { id: true, mime: true, ...WITH_HOME },
    toRow: (row) => ({
      kind: "descriptionImage",
      id: row.id,
      mime: row.mime,
      assetsPath: row.print?.assetsPath ?? null,
    }),
  },
};

// Each kind's `changed` is called when a copy no longer matches what's on disk (it was edited outside Thingport), for
// its hash to be dropped so it isn't offered again.
async function findOfKind(kind: StoredKind, { contentSha256, size }: FileContent): Promise<Candidate[]> {
  const rows = await delegate(kind).findMany({
    where: { contentSha256, size, ...STORED[kind].managed },
    select: { ...STORED[kind].select, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: PER_KIND,
  });
  return rows.flatMap((row) => {
    const managed = managedPathOf(STORED[kind].toRow(row));
    if (!managed) return [];
    const changed = async () => {
      await delegate(kind).updateMany({ where: { id: row.id, contentSha256 }, data: DROP });
    };
    return [{ createdAt: row.createdAt as Date, copy: { path: managed, changed } }];
  });
}

/** Stored files with this content, newest first, for shareStoredCopy and shareStoredBytes. One kind failing to be
 *  looked up fails them all, which only means the file is stored as usual. */
export async function findStoredCopies(content: FileContent): Promise<StoredCopy[]> {
  const found = (
    await Promise.all((Object.keys(STORED) as StoredKind[]).map((kind) => findOfKind(kind, content)))
  ).flat();
  // Newest first: the most recently stored copy is the likeliest to still be as it was hashed.
  found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return found.slice(0, PER_KIND).map((candidate) => candidate.copy);
}
