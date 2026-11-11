import { afterLicenseChange } from "./licenseService";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type Plate, type PreviewImage, type Print } from "@prisma/client";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { HttpError } from "../utils/fileUtils";
import { withStorageLock } from "../utils/storageLock";
import { normalizeTags } from "../utils/tagNormalization";
import { FORGOTTEN_AI_DESCRIPTION } from "./aiDescriptionService";
import { pruneDescriptionImages } from "./descriptionImageService";
import { assetKindOf, assetPath, galleryImageFile, ownedAssetFiles, plateThumbFile, removeAsset } from "./modelAssets";
import { pruneWhatModelsLeft } from "./printEditService";
import {
  ensureAssetHome,
  freePlateFilename,
  isOwnUpload,
  plateThumbReplaceable,
  pruneEmptyStorageDirs,
  relocatePrint,
  removeAssetHome,
  saveThumbFromBytes,
} from "./printService";

// Merging models into one, for a model whose parts each arrived as a model of their own. Only the user's own uploads:
// an imported model is tied to its source, which knows nothing of the others' files.

const log = createLogger("model-merge");

/** The models in the order given, first the one kept; refuses all of them if any can't be merged. */
async function mergeableModels(userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await prisma.print.findMany({
    where: { id: { in: unique }, userId },
    include: {
      plates: { orderBy: { position: "asc" } },
      previewImages: { orderBy: { position: "asc" } },
      descriptionImages: { select: { id: true } },
    },
  });
  if (rows.length !== unique.length) throw new HttpError(404, "Print not found");
  const refused = rows.find((row) => !isOwnUpload(row));
  if (refused) {
    throw new HttpError(
      409,
      `"${refused.title || refused.name}" was imported or belongs to a tool, so it can't be merged`,
    );
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return unique.map((id) => byId.get(id)!);
}

type Described = Pick<Print, "name" | "title" | "notes">;

/** The kept model's description, then each other's under its name. Text they share appears once. The heading tells
 *  apart what would otherwise run together, so a description that ends up alone doesn't get one. */
function mergedNotes(primary: Described, others: Described[]): string | null {
  const seen = new Set<string>();
  const fresh = (notes: string | null) => {
    const text = notes?.trim();
    if (!text || seen.has(text)) return null;
    seen.add(text);
    return text;
  };
  const own = fresh(primary.notes);
  const added = others.flatMap((other) => {
    const text = fresh(other.notes);
    return text ? [{ name: other.title || other.name, text }] : [];
  });
  if (!added.length) return primary.notes;
  if (!own && added.length === 1) return added[0].text;
  return [...(own ? [own] : []), ...added.map(({ name, text }) => `## ${name}\n\n${text}`)].join("\n\n");
}

/** A real picture taking over the cover from another model takes over the card too, which reads the first plate's
 *  thumbnail: as with a picture added to a model that had only our render (preferImageOverRenders). */
async function leadWithAdoptedCover(primary: Pick<Print, "id">, home: string, plate?: Plate, cover?: PreviewImage) {
  if (!plate || !cover || cover.generated || cover.printId === primary.id) return;
  if (!(await plateThumbReplaceable(plate.id))) return;
  await saveThumbFromBytes(plate.id, await fs.readFile(assetPath(home, galleryImageFile(cover.id))));
}

/** Copies the pictures to where they're going around `save`, removing the copies if it fails. `Print.assetsPath` is the
 *  only thing that finds a picture, so copying rather than moving keeps every one of them findable on either side of the
 *  commit, whatever stops the process in between. The originals are for the caller to remove once it stands.
 *
 *  A commit whose answer was lost rejects too, and the rows then find only the copies, so they go only if `notSaved` is
 *  sure: one left behind is just a stray file. */
function withPicturesCopied<T>(
  copies: [string, string][],
  notSaved: () => Promise<boolean>,
  save: () => Promise<T>,
): Promise<T> {
  // Under the storage lock, as moveAllStored: nothing moves or swaps these between the listing and the commit.
  return withStorageLock(async () => {
    const made: string[] = [];
    try {
      for (const [from, to] of copies) {
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
        made.push(to);
      }
      return await save();
    } catch (err) {
      if (await notSaved().catch(() => false)) {
        for (const to of made) {
          await fs.rm(to, { force: true }).catch(() => undefined);
          await pruneEmptyStorageDirs(path.dirname(to));
        }
      }
      throw err;
    }
  });
}

/**
 * Moves everything of `ids` into `primaryId` and deletes them: files after its files, pictures after its pictures with
 * our own renders behind every real one, and descriptions, tags and collections combined. It keeps its name and its
 * category or folder. The merged models' plate thumbnails go rather than move; a file list draws a new one if asked.
 *
 * The pictures are in place before the rows change (withPicturesCopied). Plates and supporting files are found by their
 * own stored paths, so they can follow afterwards, and a move that fails then leaves them working where they were.
 */
export async function mergeModels(
  userId: string,
  primaryId: string,
  ids: string[],
): Promise<{ primary: Print; merged: Print[] }> {
  const [primary, ...others] = await mergeableModels(userId, [primaryId, ...ids]);
  if (!others.length) throw new HttpError(400, "Pick at least one other model to merge");
  const otherIds = others.map((other) => other.id);
  const home = await ensureAssetHome(primary.id);

  const everyone = [primary, ...others];
  const everyoneIds = everyone.map((print) => print.id);
  const ownerIds = (print: (typeof everyone)[number]) =>
    [...print.plates, ...print.previewImages, ...print.descriptionImages].map((row) => row.id);
  const pictureCopies: [string, string][] = [];
  for (const other of others) {
    if (!other.assetsPath) continue;
    const pictures = await ownedAssetFiles(other.assetsPath, ownerIds(other));
    for (const file of pictures.filter((picture) => assetKindOf(picture) !== "thumb")) {
      pictureCopies.push([path.join(STORAGE, other.assetsPath, file), path.join(STORAGE, home, file)]);
    }
  }

  // The commit deletes them.
  const notMerged = async () => (await prisma.print.count({ where: { id: { in: otherIds } } })) > 0;
  const cover = await withPicturesCopied(pictureCopies, notMerged, () =>
    prisma.$transaction(
      async (tx) => {
        // Locked, nothing more can be added to them: a row referring to one waits, and fails once it's gone. What came
        // before the lock has files nothing copied, and would otherwise be deleted with its model.
        await tx.$queryRaw`SELECT id FROM "Print" WHERE id IN (${Prisma.join(everyoneIds)}) ORDER BY id FOR UPDATE`;
        const unread = { printId: { in: everyoneIds }, id: { notIn: everyone.flatMap(ownerIds) } };
        const added =
          (await tx.plate.count({ where: unread })) +
          (await tx.previewImage.count({ where: unread })) +
          (await tx.descriptionImage.count({ where: unread }));
        // Read again, as what's written below would overwrite any change since. A model that's no longer an upload
        // can't be merged, and one whose pictures moved has them somewhere other than where they were copied.
        const rows = await tx.print.findMany({ where: { id: { in: everyoneIds } } });
        const current = everyone.flatMap((print) => rows.find((row) => row.id === print.id) ?? []);
        const changed =
          current.length !== everyone.length ||
          current.some(
            (row, index) => !isOwnUpload(row) || row.assetsPath !== (index ? everyone[index].assetsPath : home),
          );
        if (added || changed) {
          throw new HttpError(409, "These models changed while they were being merged. Please try again.");
        }
        const [keptNow, ...othersNow] = current;
        const notes = mergedNotes(keptNow, othersNow);
        // A model whose first plate is a sliced print already has what a prepared file would be.
        const adoptedPrepared =
          keptNow.preparedFileId || keptNow.preparedMetadata !== null
            ? null
            : (othersNow.find((other) => other.preparedFileId)?.preparedFileId ?? null);

        await tx.print.updateMany({ where: { id: { in: otherIds } }, data: { preparedFileId: null } });

        // Locked and read again too: renaming a file doesn't touch its model's row, and would otherwise be overwritten.
        await tx.$queryRaw`SELECT id FROM "Plate" WHERE "printId" IN (${Prisma.join(everyoneIds)}) ORDER BY id FOR UPDATE`;
        const plates = await tx.plate.findMany({
          where: { printId: { in: everyoneIds } },
          orderBy: { position: "asc" },
        });
        const platesOf = (printId: string) => plates.filter((plate) => plate.printId === printId);

        const keptPlates = platesOf(primary.id);
        let position = (keptPlates.at(-1)?.position ?? -1) + 1;
        // Names are unique within a folder, and each plate keeps its own.
        const names = new Map<string, Set<string>>();
        const namesIn = (folder: string | null) => {
          const taken = names.get(folder ?? "") ?? new Set<string>();
          names.set(folder ?? "", taken);
          return taken;
        };
        for (const plate of keptPlates) namesIn(plate.folder).add(plate.filename.toLowerCase());
        const instances = new Set(keptPlates.flatMap((plate) => plate.sourceInstanceId ?? []));
        for (const plate of otherIds.flatMap((id) => platesOf(id))) {
          const filename = freePlateFilename(plate.filename, namesIn(plate.folder));
          namesIn(plate.folder).add(filename.toLowerCase());
          const instance =
            plate.sourceInstanceId && !instances.has(plate.sourceInstanceId) ? plate.sourceInstanceId : null;
          if (instance) instances.add(instance);
          await tx.plate.update({
            where: { id: plate.id },
            data: {
              printId: primary.id,
              position: position++,
              filename,
              sourceInstanceId: instance,
              thumbGenerated: false,
            },
          });
        }

        await tx.printFile.updateMany({ where: { printId: { in: otherIds } }, data: { printId: primary.id } });
        const demoted = othersNow.flatMap((other) =>
          other.preparedFileId && other.preparedFileId !== adoptedPrepared ? [other.preparedFileId] : [],
        );
        await tx.printFile.updateMany({ where: { id: { in: demoted } }, data: { role: "SUPPORTING" } });

        // Locked and read again as the plates are, for a change of order. Stable: each model's own order stays within the
        // real pictures, and within the renders.
        await tx.$queryRaw`SELECT id FROM "PreviewImage" WHERE "printId" IN (${Prisma.join(everyoneIds)}) ORDER BY id FOR UPDATE`;
        const images = await tx.previewImage.findMany({
          where: { printId: { in: everyoneIds } },
          orderBy: { position: "asc" },
        });
        const gallery = everyoneIds
          .flatMap((id) => images.filter((image) => image.printId === id))
          .toSorted((a, b) => Number(a.generated) - Number(b.generated));

        // Two phases, as in previewImageService, to avoid (printId, position) collisions.
        for (const [index, image] of gallery.entries()) {
          await tx.previewImage.update({
            where: { id: image.id },
            data: { printId: primary.id, position: -(index + 1) },
          });
        }
        for (const [index, image] of gallery.entries()) {
          await tx.previewImage.update({ where: { id: image.id }, data: { position: index } });
        }

        await tx.descriptionImage.updateMany({ where: { printId: { in: otherIds } }, data: { printId: primary.id } });

        const memberships = await tx.collectionItem.findMany({
          where: { printId: { in: otherIds } },
          orderBy: { position: "asc" },
        });
        await tx.collectionItem.createMany({
          data: memberships.map(({ collectionId, position: at }) => ({
            collectionId,
            printId: primary.id,
            position: at,
          })),
          skipDuplicates: true,
        });

        const viewed = current.flatMap((print) => print.lastViewedAt ?? []);
        await tx.print.update({
          where: { id: primary.id },
          data: {
            notes,
            tags: normalizeTags(current.flatMap((print) => print.tags)),
            creator: current.find((print) => print.creator)?.creator ?? null,
            favoritedAt: current.find((print) => print.favoritedAt)?.favoritedAt ?? null,
            lastViewedAt: viewed.length ? new Date(Math.max(...viewed.map((date) => date.getTime()))) : null,
            viewCount: current.reduce((sum, print) => sum + print.viewCount, 0),
            printCount: current.reduce((sum, print) => sum + print.printCount, 0),
            ...(adoptedPrepared ? { preparedFileId: adoptedPrepared } : {}),
            // With the change itself, so a suggestion written from the old description can't outlive it.
            ...(notes === keptNow.notes ? {} : FORGOTTEN_AI_DESCRIPTION),
          },
        });
        await tx.print.deleteMany({ where: { id: { in: otherIds } } });
        return gallery.at(0);
      },
      // Sequential writes, per plate and picture of every model.
      { timeout: 60_000 },
    ),
  );

  // The merge stands from here on, so nothing below fails it.
  const didNot = (step: string) => (error: unknown) => log.warn(`couldn't ${step}`, { print: primary.id, error });
  for (const other of others) {
    for (const plate of other.plates) await removeAsset(other.assetsPath, plateThumbFile(plate.id));
    await removeAssetHome(other.assetsPath, ownerIds(other)).catch(didNot("clear a merged model's pictures"));
  }
  const kept = await prisma.print
    .findUnique({ where: { id: primary.id }, include: { plates: { orderBy: { position: "asc" } } } })
    .catch(didNot("read it back"));
  if (kept) {
    // Before the move below takes the pictures it reads.
    await leadWithAdoptedCover(primary, home, kept.plates[0], cover).catch(didNot("take on its new cover"));
    await relocatePrint(kept, kept.plates).catch(didNot("move its files where the storage structure puts them"));
  }
  // The merged models' LICENSE.txt files came along with their other files: only the kept model's licence stays.
  await afterLicenseChange(primary.id);
  await pruneDescriptionImages(primary.id).catch(didNot("remove description images nothing uses"));
  await pruneWhatModelsLeft(userId, others).catch(didNot("tidy what the merged models left"));
  return { primary, merged: others };
}
