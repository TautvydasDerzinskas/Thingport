import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type Plate, type PreviewImage, type Print } from "@prisma/client";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { HttpError } from "../utils/fileUtils";
import { withStorageLock } from "../utils/storageLock";
import { normalizeTags } from "../utils/tagNormalization";
import { forgetAiDescription } from "./aiDescriptionService";
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
 *  commit, whatever stops the process in between. The originals are for the caller to remove once it stands. */
function withPicturesCopied(copies: [string, string][], save: () => Promise<unknown>): Promise<void> {
  // Under the storage lock, as moveAllStored: nothing moves or swaps these between the listing and the commit.
  return withStorageLock(async () => {
    const made: string[] = [];
    try {
      for (const [from, to] of copies) {
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
        made.push(to);
      }
      await save();
    } catch (err) {
      for (const to of made) {
        await fs.rm(to, { force: true }).catch(() => undefined);
        await pruneEmptyStorageDirs(path.dirname(to));
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

  const notes = mergedNotes(primary, others);
  // A model whose first plate is a sliced print already has what a prepared file would be.
  const adoptedPrepared =
    primary.preparedFileId || primary.preparedMetadata !== null
      ? null
      : (others.find((other) => other.preparedFileId)?.preparedFileId ?? null);
  // Stable: each model's own order stays within the real pictures, and within the renders.
  const gallery = everyone
    .flatMap((print) => print.previewImages)
    .toSorted((a, b) => Number(a.generated) - Number(b.generated));

  await withPicturesCopied(pictureCopies, () =>
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
        if (added) throw new HttpError(409, "These models changed while they were being merged. Please try again.");

        await tx.print.updateMany({ where: { id: { in: otherIds } }, data: { preparedFileId: null } });

        let position = (primary.plates.at(-1)?.position ?? -1) + 1;
        const names = new Set(primary.plates.map((plate) => plate.filename.toLowerCase()));
        const instances = new Set(primary.plates.flatMap((plate) => plate.sourceInstanceId ?? []));
        for (const plate of others.flatMap((other) => other.plates)) {
          const filename = freePlateFilename(plate.filename, names);
          names.add(filename.toLowerCase());
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
        const demoted = others.flatMap((other) =>
          other.preparedFileId && other.preparedFileId !== adoptedPrepared ? [other.preparedFileId] : [],
        );
        await tx.printFile.updateMany({ where: { id: { in: demoted } }, data: { role: "SUPPORTING" } });

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

        const viewed = everyone.flatMap((print) => print.lastViewedAt ?? []);
        await tx.print.update({
          where: { id: primary.id },
          data: {
            notes,
            tags: normalizeTags(everyone.flatMap((print) => print.tags)),
            creator: everyone.find((print) => print.creator)?.creator ?? null,
            favoritedAt: everyone.find((print) => print.favoritedAt)?.favoritedAt ?? null,
            lastViewedAt: viewed.length ? new Date(Math.max(...viewed.map((date) => date.getTime()))) : null,
            viewCount: everyone.reduce((sum, print) => sum + print.viewCount, 0),
            printCount: everyone.reduce((sum, print) => sum + print.printCount, 0),
            ...(adoptedPrepared ? { preparedFileId: adoptedPrepared } : {}),
          },
        });
        await tx.print.deleteMany({ where: { id: { in: otherIds } } });
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
    // Before anything else can move the pictures it reads.
    await leadWithAdoptedCover(primary, home, kept.plates[0], gallery[0]).catch(didNot("take on its new cover"));
    await relocatePrint(kept, kept.plates).catch(didNot("move its files where the storage structure puts them"));
  }
  if (notes !== primary.notes) await forgetAiDescription(primary.id).catch(didNot("forget its AI description"));
  await pruneDescriptionImages(primary.id).catch(didNot("remove description images nothing uses"));
  await pruneWhatModelsLeft(userId, others).catch(didNot("tidy what the merged models left"));
  return { primary, merged: others };
}
