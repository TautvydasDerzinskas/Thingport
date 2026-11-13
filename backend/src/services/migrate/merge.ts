import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { AVATARS, COVERS, ICONS, STORAGE, STUDIO_ASSETS } from "../../config";
import { prisma } from "../../db";
import { createLogger } from "../../logger";
import { seedStarterSiteIdsFor } from "../categorySiteIds";
import { normalizeCollectionName } from "../collectionService";
import {
  ASSET_SUBFOLDERS,
  ASSETS_FOLDER,
  COLOR_RENDER_FILE_TAG,
  descriptionImageFile,
  galleryImageFile,
  legacyAssetPath,
  plateRenderFile,
  plateThumbFile,
  type AssetFile,
} from "../modelAssets";
import { availableModelName, normalizeName, pruneEmptyStorageDirs, relocatePrint } from "../printService";
import { provisionEveryoneSoon } from "../toolsService";
import { ensureUsername, isUsernameFree } from "../usernames";
import { MigrateError } from "./errors";
import { MERGE_RULES, SECRET_SETTING_KEYS, SETTING_KEYS } from "./rules";
import type { SourceFiles } from "./sourceFiles";

// Merges the working copy, brought up to this instance's release, into this instance. Rows keep their ids, which are
// random, so a second run of the same migration finds what the first brought and goes on from there. Someone with an
// account here too, by email, is merged into it: their account stays as it is, and what's theirs is added to it.
// Model files are copied into a folder of the run's own first, and filed where this instance's storage structure puts
// them once everything is in, as a storage move would.

const log = createLogger("migrate");

/** Where a run keeps the files it copied until they're filed, relative to storage. */
export const MIGRATE_FOLDER = ".migrate";

export type MigrateOptions = {
  /** The old instance's people who come, by their ids there. */
  people: string[];
  collections: boolean;
  studio: boolean;
  widgets: boolean;
  tools: boolean;
  syncs: boolean;
  signIns: boolean;
  settings: boolean;
  secrets: boolean;
};

export type MergePhase = "people" | "models" | "collections" | "extras" | "filing";
export type MergeProgress = { phase: MergePhase; done: number; total: number };

export type MigrateReport = {
  people: { created: number; merged: number; earlier: number };
  models: {
    brought: number;
    /** In the library already: imported from the same page, or copied from the same original. */
    alreadyHere: number;
    /** Brought by an earlier run of this migration. */
    earlier: number;
    /** Named apart from a model of theirs with the same name in the same category. */
    renamed: number;
    /** None of their files were in the folder. */
    noFiles: number;
    /** A tool's own models, which the tool gives everyone here once it's installed. */
    toolModels: number;
    failed: number;
    /** Couldn't be filed in the storage structure, and wait in the run's folder for the next storage move. */
    unfiled: number;
  };
  files: { copied: number; missing: number };
  collections: { brought: number; merged: number };
  designs: number;
  widgets: number;
  tools: number;
  syncs: number;
  signIns: number;
  settings: number;
  secrets: number;
  /** The first of what failed, for the admin to look into. */
  failures: { kind: string; name: string; error: string }[];
};

const MAX_FAILURES = 50;
/** Errors that mean the old instance itself can't be read any more, not just one thing in it. */
const SOURCE_GONE = new Set(["online_unreachable", "online_lost", "online_token", "online_old"]);

/** Every table the merge writes: the ones MERGE_RULES says come. */
export const MERGED_TABLES = new Set<Prisma.ModelName>([
  "User",
  "Category",
  "CategorySiteId",
  "Print",
  "Plate",
  "PreviewImage",
  "DescriptionImage",
  "PrintFile",
  "Author",
  "AuthorLink",
  "Activity",
  "SystemReceipt",
  "UserPrinter",
  "UserIcon",
  "UserIdentity",
  "UserAchievement",
  "UserActiveDay",
  "Collection",
  "CollectionItem",
  "CollectionShare",
  "Bookmark",
  "CollectionSync",
  "ProviderListing",
  "ProviderConnection",
  "CustomWidget",
  "Tool",
  "ToolData",
  "StudioDesign",
  "StudioRevision",
  "StudioMessage",
  "Setting",
  "AiConnection",
  "OidcProvider",
]);

const NULLABLE_JSON = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    model.fields
      .filter((field) => field.kind === "scalar" && field.type === "Json" && !field.isRequired)
      .map((field) => field.name),
  ]),
);

/** A row read from the copy as a create takes it: a JSON field that's null written as SQL NULL. The copy is at this
 *  instance's release, so its rows have every field this one's do. */
function rowFor<T>(model: Prisma.ModelName, row: object): T {
  const out: Record<string, unknown> = { ...row };
  for (const field of NULLABLE_JSON.get(model) ?? []) if (out[field] === null) out[field] = Prisma.DbNull;
  return out as T;
}

type CategoryNode = { name: string; parentId: string | null; kind: string };

/** A category's names from the top of its tree down, as they're compared: a tree no deeper than 64. */
function categoryNames(row: CategoryNode, byId: Map<string, CategoryNode>): string[] {
  const names: string[] = [];
  let at: CategoryNode | undefined = row;
  for (let depth = 0; at && depth < 64; depth++) {
    names.unshift(at.name.trim().toLowerCase());
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return names;
}

/** Where a category is in its tree, as a key: the names as a list, so a name with a "/" in it isn't two. */
function categoryKey(row: CategoryNode, byId: Map<string, CategoryNode>): string {
  return JSON.stringify([row.kind, ...categoryNames(row, byId)]);
}

/** Whether two issuer URLs are the same issuer, written either way. */
function sameIssuer(a: string, b: string): boolean {
  const plain = (url: string) =>
    url
      .trim()
      .replace(/\/\.well-known\/openid-configuration\/?$/, "")
      .replace(/\/+$/, "");
  return plain(a) === plain(b);
}

/** An id a model or design came with, from either source, which names a folder here: only a plain one, as ids are. */
export const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** For a row whose own id another row here has already: which, ids being random, only a clash of one in billions
 *  could cause. */
const freshId = () => `m${crypto.randomBytes(12).toString("hex")}`;

const OWN_AVATAR = /^\/api\/avatars\/([a-f0-9]{32}\.webp)$/;
const OWN_COVER = /^\/api\/covers\/([a-f0-9]{32}\.webp)$/;

type SourcePrint = Prisma.PrintGetPayload<{
  include: { plates: true; previewImages: true; descriptionImages: true; files: true };
}>;

/** One run of the merge; `report` says what it did so far, also when it stopped part-way. */
export class Merge {
  /** The old instance's ids for each kind, to this instance's. */
  private users = new Map<string, string>();
  private created = new Set<string>();
  private categories = new Map<string, string>();
  private prints = new Map<string, string>();
  private collections = new Map<string, string>();
  private tools = new Map<string, string>();
  private oidc = new Map<string, string>();
  private authors = new Set<string>();
  /** Models brought, with the model each was copied from there, to link once both are here. */
  private copies: [string, string][] = [];
  private progress: MergeProgress = { phase: "people", done: 0, total: 0 };
  private readonly tempRoot: string;
  readonly report: MigrateReport = {
    people: { created: 0, merged: 0, earlier: 0 },
    models: { brought: 0, alreadyHere: 0, earlier: 0, renamed: 0, noFiles: 0, toolModels: 0, failed: 0, unfiled: 0 },
    files: { copied: 0, missing: 0 },
    collections: { brought: 0, merged: 0 },
    designs: 0,
    widgets: 0,
    tools: 0,
    syncs: 0,
    signIns: 0,
    settings: 0,
    secrets: 0,
    failures: [],
  };

  constructor(
    private readonly source: PrismaClient,
    private readonly files: SourceFiles,
    private readonly runId: string,
    private readonly options: MigrateOptions,
    private readonly onProgress: (progress: MergeProgress) => void,
  ) {
    this.tempRoot = path.join(MIGRATE_FOLDER, runId);
  }

  async run(): Promise<MigrateReport> {
    const people = await this.source.user.findMany({
      where: { id: { in: this.options.people } },
      orderBy: { createdAt: "asc" },
    });
    this.phase("people", people.length);
    for (const person of people) {
      await this.mergeUser(person);
      this.tick();
    }
    const sourceIds = [...this.users.keys()];
    this.phase("models", await this.source.print.count({ where: { userId: { in: sourceIds } } }));
    for (const sourceId of sourceIds) {
      await this.mergeCategories(sourceId, this.users.get(sourceId)!);
      await this.mergePrints(sourceId, this.users.get(sourceId)!);
    }
    await this.linkCopies();

    this.phase("collections", 0);
    if (this.options.collections) await this.mergeCollections(sourceIds);

    this.phase("extras", 0);
    await this.mergeLinkedAuthors(sourceIds);
    await this.mergeSmallRows(sourceIds);
    await this.mergeActivity(sourceIds);
    await this.mergeAchievements(sourceIds);
    await this.mergeIcons(sourceIds);
    if (this.options.secrets) await this.mergeSecrets();
    await this.mergeIdentities(sourceIds);
    if (this.options.syncs && this.options.collections) await this.mergeSyncs(sourceIds);
    if (this.options.signIns) await this.mergeSignIns(sourceIds);
    if (this.options.widgets) await this.mergeWidgets(sourceIds);
    if (this.options.tools) await this.mergeTools(sourceIds);
    if (this.options.studio) await this.mergeStudio(sourceIds);
    if (this.options.settings) await this.mergeSettings();

    await this.fileModels();
    await this.finish();
    return this.report;
  }

  private phase(phase: MergePhase, total: number) {
    this.progress = { phase, done: 0, total };
    this.onProgress({ ...this.progress });
  }

  private tick(count = 1) {
    this.progress.done += count;
    this.onProgress({ ...this.progress });
  }

  /** Notes what couldn't come over and goes on, unless the old instance itself is gone (online: unreachable, stopped
   *  answering, or the token turned down). Then every item after it would fail too, so the run stops as failed and
   *  keeps its working copy, to be started again once the old instance is back. */
  private fail(kind: string, name: string, err: unknown) {
    if (err instanceof MigrateError && SOURCE_GONE.has(err.code)) throw err;
    log.warn("couldn't bring something over", { kind, name, error: err });
    if (this.report.failures.length < MAX_FAILURES) {
      this.report.failures.push({ kind, name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private mapUser(sourceId: string | null | undefined): string | undefined {
    return sourceId ? this.users.get(sourceId) : undefined;
  }

  // --- People ---

  private async mergeUser(person: Prisma.UserGetPayload<object>) {
    const here = await prisma.user.findFirst({
      where: { email: { equals: person.email.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (here) {
      this.users.set(person.id, here.id);
      if (here.id === person.id) this.report.people.earlier += 1;
      else this.report.people.merged += 1;
      return;
    }
    if (await prisma.user.findUnique({ where: { id: person.id }, select: { id: true } })) {
      this.fail("person", person.email, new Error("An account here already has this person's id"));
      return;
    }
    const username = person.username && (await isUsernameFree(person.username)) ? person.username : null;
    const avatar = await this.copyPicture(person.avatarUrl, OWN_AVATAR, "avatars", AVATARS);
    const cover = await this.copyPicture(person.backgroundUrl, OWN_COVER, "covers", COVERS);
    await prisma.user.create({
      data: rowFor<Prisma.UserUncheckedCreateInput>("User", {
        ...person,
        username,
        // Never a second owner: this instance has one.
        isOwner: false,
        avatarUrl: avatar,
        backgroundUrl: cover,
        emailVerificationToken: null,
        emailVerificationExpires: null,
        pendingEmail: null,
        passwordResetTokenHash: null,
        passwordResetExpires: null,
        // An app reading the old instance with a token is set up again against this one.
        apiTokenHash: null,
        apiTokenHint: null,
        apiTokenCreatedAt: null,
        apiTokenLastUsedAt: null,
        apiTokenMcpTools: [],
        apiTokenRestScopes: [],
      }),
    });
    if (!username) await ensureUsername(person.id);
    this.users.set(person.id, person.id);
    this.created.add(person.id);
    this.report.people.created += 1;
  }

  /** An avatar or cover they uploaded there, copied over; a picture elsewhere (a linked creator's) kept as it is. */
  private async copyPicture(url: string | null, own: RegExp, folder: string, to: string): Promise<string | null> {
    if (!url) return null;
    const file = own.exec(url)?.[1];
    if (!file) return url;
    return (await this.files.copy(path.join(folder, file), path.join(to, file))) ? url : null;
  }

  // --- Categories ---

  /** Their category tree: for someone merged, a category at the same place in their tree here is the same one. */
  private async mergeCategories(sourceUserId: string, userId: string) {
    const rows = await this.source.category.findMany({ where: { userId: sourceUserId }, include: { siteIds: true } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const here = await prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, parentId: true, kind: true },
    });
    const hereById = new Map(here.map((row) => [row.id, row]));
    const herePaths = new Map(here.map((row) => [categoryKey(row, hereById), row.id]));
    const depthOf = (row: (typeof rows)[number]) => categoryNames(row, byId).length;
    for (const row of rows.toSorted((a, b) => depthOf(a) - depthOf(b))) {
      const key = categoryKey(row, byId);
      const { siteIds, ...category } = row;
      try {
        // An earlier run brought it, though it may have been renamed or moved here since.
        const earlier = await prisma.category.findUnique({ where: { id: row.id }, select: { userId: true } });
        if (earlier?.userId === userId) {
          this.categories.set(row.id, row.id);
          continue;
        }
        const same = herePaths.get(key);
        if (same) {
          this.categories.set(row.id, same);
          // The site ids it had there, for a provider it has none for here.
          const have = new Set(
            (await prisma.categorySiteId.findMany({ where: { categoryId: same }, select: { provider: true } })).map(
              (site) => site.provider,
            ),
          );
          const add = siteIds.filter((site) => !have.has(site.provider));
          if (add.length) {
            await prisma.categorySiteId.createMany({
              data: add.map((site) => ({ ...site, categoryId: same })),
              skipDuplicates: true,
            });
          }
          continue;
        }
        const id = earlier ? freshId() : row.id;
        await prisma.category.create({
          data: rowFor<Prisma.CategoryUncheckedCreateInput>("Category", {
            ...category,
            id,
            userId,
            parentId: category.parentId ? (this.categories.get(category.parentId) ?? null) : null,
          }),
        });
        if (siteIds.length) {
          await prisma.categorySiteId.createMany({
            data: siteIds.map((site) => ({ ...site, categoryId: id })),
            skipDuplicates: true,
          });
        }
        this.categories.set(row.id, id);
        herePaths.set(key, id);
      } catch (err) {
        this.fail("category", row.name, err);
      }
    }
  }

  // --- Models ---

  private async mergePrints(sourceUserId: string, userId: string) {
    let cursor: string | undefined;
    for (;;) {
      const batch: SourcePrint[] = await this.source.print.findMany({
        where: { userId: sourceUserId },
        include: { plates: true, previewImages: true, descriptionImages: true, files: true },
        orderBy: { id: "asc" },
        take: 25,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) return;
      cursor = batch.at(-1)!.id;
      for (const print of batch) {
        try {
          await this.mergePrint(print, userId);
        } catch (err) {
          this.fail("model", print.name, err);
          this.report.models.failed += 1;
        }
        this.tick();
      }
    }
  }

  private async mergePrint(print: SourcePrint, userId: string) {
    if (print.toolId) {
      this.report.models.toolModels += 1;
      return;
    }
    const earlier = await prisma.print.findUnique({ where: { id: print.id }, select: { userId: true } });
    if (earlier) {
      if (earlier.userId !== userId) throw new Error("A model here already has this model's id");
      this.prints.set(print.id, print.id);
      this.report.models.earlier += 1;
      return;
    }
    const same = await this.sameModel(print, userId);
    if (same) {
      this.prints.set(print.id, same);
      this.report.models.alreadyHere += 1;
      return;
    }

    // Its id and its files' and pictures' name the paths they're copied to, so none may climb out of the run's folder.
    if (!PLAIN_ID.test(print.id)) throw new Error("This model's id isn't one Thingport makes");
    const children = [...print.plates, ...print.files, ...print.previewImages, ...print.descriptionImages];
    if (!children.every(({ id }) => PLAIN_ID.test(id))) {
      throw new Error("An id of this model's files or pictures isn't one Thingport makes");
    }
    const temp = path.join(this.tempRoot, print.id);
    const copied = await this.copyModelFiles(print, temp);
    if (print.plates.length && !copied.plates.length) {
      await fs.rm(path.join(STORAGE, temp), { recursive: true, force: true }).catch(() => undefined);
      this.report.models.noFiles += 1;
      return;
    }
    const categoryId = print.categoryId ? (this.categories.get(print.categoryId) ?? null) : null;
    const name = await availableModelName(userId, print.name, categoryId);
    if (print.authorId) await this.ensureAuthor(print.authorId);
    const { plates: _plates, previewImages: _images, descriptionImages: _descriptions, files: _files, ...row } = print;
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.print.create({
            data: rowFor<Prisma.PrintUncheckedCreateInput>("Print", {
              ...row,
              userId,
              categoryId,
              name,
              nameNormalized: normalizeName(name),
              assetsPath: copied.assets ? path.join(temp, ASSETS_FOLDER) : null,
              // Linked once they're here.
              preparedFileId: null,
              copiedFromId: null,
              toolId: null,
              toolKey: null,
              aiSuggestion: this.suggestionHere(print.aiSuggestion),
              aiRejectedCategoryIds: print.aiRejectedCategoryIds.flatMap((id) => this.categories.get(id) ?? []),
            }),
          });
          if (copied.plates.length) {
            await tx.plate.createMany({
              data: copied.plates.map((plate, position) =>
                rowFor<Prisma.PlateCreateManyInput>("Plate", {
                  ...plate,
                  position,
                  // Read from where it was found there: here it's a copy in storage like any other.
                  sourcePath: null,
                  reuseIno: null,
                  reuseCtimeNs: null,
                }),
              ),
            });
          }
          if (copied.images.length) {
            await tx.previewImage.createMany({
              data: copied.images.map((image, position) => ({
                ...image,
                position,
                reuseIno: null,
                reuseCtimeNs: null,
              })),
            });
          }
          if (copied.descriptions.length) {
            await tx.descriptionImage.createMany({
              data: copied.descriptions.map((image) => ({ ...image, reuseIno: null, reuseCtimeNs: null })),
            });
          }
          if (copied.files.length) {
            await tx.printFile.createMany({
              data: copied.files.map((file) =>
                rowFor<Prisma.PrintFileCreateManyInput>("PrintFile", { ...file, reuseIno: null, reuseCtimeNs: null }),
              ),
            });
          }
          if (print.preparedFileId && copied.files.some((file) => file.id === print.preparedFileId)) {
            await tx.print.update({ where: { id: print.id }, data: { preparedFileId: print.preparedFileId } });
          }
        },
        { timeout: 60_000 },
      );
    } catch (err) {
      await fs.rm(path.join(STORAGE, temp), { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
    this.prints.set(print.id, print.id);
    if (print.copiedFromId) this.copies.push([print.id, print.copiedFromId]);
    this.report.models.brought += 1;
    if (name !== print.name) this.report.models.renamed += 1;
  }

  /** The model in their library already: imported from the same page, or copied from the same original. */
  private async sameModel(print: SourcePrint, userId: string): Promise<string | null> {
    if (print.sourceProvider && print.sourceExternalId) {
      const found = await prisma.print.findFirst({
        where: { userId, sourceProvider: print.sourceProvider, sourceExternalId: print.sourceExternalId },
        select: { id: true },
      });
      if (found) return found.id;
    }
    if (print.originalId) {
      const found = await prisma.print.findFirst({
        where: { userId, originalId: print.originalId },
        select: { id: true },
      });
      if (found) return found.id;
    }
    return null;
  }

  private suggestionHere(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Prisma.DbNull;
    const categoryId = (value as Record<string, unknown>).categoryId;
    const here = typeof categoryId === "string" ? this.categories.get(categoryId) : undefined;
    return here ? ({ ...value, categoryId: here } as Prisma.InputJsonValue) : Prisma.DbNull;
  }

  private async ensureAuthor(id: string) {
    if (this.authors.has(id)) return;
    this.authors.add(id);
    if (await prisma.author.findUnique({ where: { id }, select: { id: true } })) return;
    const row = await this.source.author.findUnique({ where: { id } });
    if (row) {
      await prisma.author.createMany({
        data: [rowFor<Prisma.AuthorCreateManyInput>("Author", row)],
        skipDuplicates: true,
      });
    }
  }

  /** The model's files and pictures, copied into the run's folder under `temp`; the rows to make for those found. */
  private async copyModelFiles(print: SourcePrint, temp: string) {
    const plates: SourcePrint["plates"] = [];
    for (const plate of print.plates.toSorted((a, b) => a.position - b.position)) {
      const storagePath = path.join(temp, `${plate.id}${path.extname(plate.filename)}`);
      if (await this.copyFile(plate.storagePath, storagePath)) plates.push({ ...plate, storagePath });
    }
    const files: SourcePrint["files"] = [];
    for (const file of print.files) {
      const storagePath = path.join(temp, `${file.id}${path.extname(file.filename)}`);
      if (await this.copyFile(file.storagePath, storagePath)) files.push({ ...file, storagePath });
    }
    const home = path.join(temp, ASSETS_FOLDER);
    let assets = 0;
    const images: SourcePrint["previewImages"] = [];
    for (const image of print.previewImages.toSorted((a, b) => a.position - b.position)) {
      if (await this.copyAsset(print.assetsPath, galleryImageFile(image.id), home)) {
        images.push(image);
        assets += 1;
      }
    }
    const descriptions: SourcePrint["descriptionImages"] = [];
    for (const image of print.descriptionImages) {
      if (await this.copyAsset(print.assetsPath, descriptionImageFile(image), home)) {
        descriptions.push(image);
        assets += 1;
      }
    }
    // Thumbnails and renders have no rows, and are drawn again when missing.
    for (const plate of plates) {
      for (const file of [
        plateThumbFile(plate.id),
        plateRenderFile(plate.id),
        plateRenderFile(plate.id, COLOR_RENDER_FILE_TAG),
      ]) {
        if (await this.copyAsset(print.assetsPath, file, home)) assets += 1;
      }
    }
    return { plates, files, images, descriptions, assets: assets > 0 };
  }

  private async copyFile(from: string, to: string): Promise<boolean> {
    if (await this.files.copy(from, path.join(STORAGE, to))) {
      this.report.files.copied += 1;
      return true;
    }
    this.report.files.missing += 1;
    return false;
  }

  /** A picture from the model's folder there, or from the shared folder a model from before kept it in. */
  private async copyAsset(sourceHome: string | null, file: AssetFile, home: string): Promise<boolean> {
    const to = path.join(STORAGE, home, ASSET_SUBFOLDERS[file.kind], file.name);
    if (sourceHome && (await this.files.copy(path.join(sourceHome, ASSET_SUBFOLDERS[file.kind], file.name), to))) {
      return true;
    }
    return this.files.copy(path.relative(STORAGE, legacyAssetPath(file)), to);
  }

  /** Copies of models here whose original came too. */
  private async linkCopies() {
    for (const [id, original] of this.copies) {
      const here = this.prints.get(original);
      if (here && here !== id)
        await prisma.print.update({ where: { id }, data: { copiedFromId: here } }).catch(() => undefined);
    }
  }

  // --- Collections ---

  private async mergeCollections(sourceIds: string[]) {
    const rows = await this.source.collection.findMany({
      where: { userId: { in: sourceIds }, toolId: null },
      include: { items: true, shares: true },
    });
    this.progress.total = rows.length;
    for (const row of rows) {
      const userId = this.users.get(row.userId)!;
      const { items, shares, ...collection } = row;
      try {
        let id = row.id;
        let offset = 0;
        const earlier = await prisma.collection.findUnique({ where: { id: row.id }, select: { userId: true } });
        if (earlier?.userId !== userId) {
          const nameNormalized = normalizeCollectionName(row.name);
          const same = await prisma.collection.findFirst({ where: { userId, nameNormalized }, select: { id: true } });
          if (same) {
            id = same.id;
            const last = await prisma.collectionItem.aggregate({
              where: { collectionId: id },
              _max: { position: true },
            });
            offset = (last._max.position ?? -1) + 1;
            this.report.collections.merged += 1;
          } else {
            if (earlier) id = freshId();
            await prisma.collection.create({
              data: rowFor<Prisma.CollectionUncheckedCreateInput>("Collection", {
                ...collection,
                id,
                userId,
                nameNormalized,
                toolId: null,
              }),
            });
            this.report.collections.brought += 1;
          }
        }
        this.collections.set(row.id, id);
        const kept = items.filter((item) => this.prints.has(item.printId));
        if (kept.length) {
          await prisma.collectionItem.createMany({
            data: kept.map((item) => ({
              ...item,
              collectionId: id,
              printId: this.prints.get(item.printId)!,
              position: item.position + offset,
            })),
            skipDuplicates: true,
          });
        }
        // Shared with people who came too; with people on partner instances, it's shared again from here.
        const local = shares.filter((share) => this.mapUser(share.userId));
        if (local.length) {
          await prisma.collectionShare.createMany({
            data: local.map((share) => ({
              ...share,
              collectionId: id,
              userId: this.mapUser(share.userId)!,
              remotePersonId: null,
            })),
            skipDuplicates: true,
          });
        }
      } catch (err) {
        this.fail("collection", row.name, err);
      }
      this.tick();
    }
    // Sidebar bookmarks, after their own here.
    for (const sourceId of sourceIds) {
      const userId = this.users.get(sourceId)!;
      const bookmarks = await this.source.bookmark.findMany({ where: { userId: sourceId }, orderBy: { order: "asc" } });
      const last = await prisma.bookmark.aggregate({ where: { userId }, _max: { order: true } });
      const offset = (last._max.order ?? -1) + 1;
      const data = bookmarks.flatMap((bookmark) => {
        const collectionId = bookmark.collectionId ? this.collections.get(bookmark.collectionId) : null;
        if (bookmark.collectionId && !collectionId) return [];
        return [{ ...bookmark, userId, collectionId: collectionId ?? null, order: bookmark.order + offset }];
      });
      if (data.length) await prisma.bookmark.createMany({ data, skipDuplicates: true });
    }
  }

  // --- What comes with the people ---

  /** Creators they said are them there, unless someone here says so already. */
  private async mergeLinkedAuthors(sourceIds: string[]) {
    const links = await this.source.authorLink.findMany({ where: { userId: { in: sourceIds } } });
    for (const link of links) {
      await this.ensureAuthor(link.authorId);
      await prisma.authorLink
        .createMany({ data: [{ ...link, userId: this.users.get(link.userId)! }], skipDuplicates: true })
        .catch((err) => this.fail("creator", link.authorId, err));
    }
  }

  /** Their printers, and the announcements they were already sent. */
  private async mergeSmallRows(sourceIds: string[]) {
    const printers = await this.source.userPrinter.findMany({ where: { userId: { in: sourceIds } } });
    if (printers.length) {
      await prisma.userPrinter.createMany({
        data: printers.map((printer) => ({ ...printer, userId: this.users.get(printer.userId)! })),
        skipDuplicates: true,
      });
    }
    const receipts = await this.source.systemReceipt.findMany({ where: { userId: { in: sourceIds } } });
    if (receipts.length) {
      await prisma.systemReceipt.createMany({
        data: receipts.map((receipt) => ({ ...receipt, userId: this.users.get(receipt.userId)! })),
        skipDuplicates: true,
      });
    }
  }

  /** What they did, for their activity heatmap. */
  private async mergeActivity(sourceIds: string[]) {
    let cursor: string | undefined;
    for (;;) {
      const rows = await this.source.activity.findMany({
        where: { userId: { in: sourceIds } },
        orderBy: { id: "asc" },
        take: 1000,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) return;
      cursor = rows.at(-1)!.id;
      await prisma.activity.createMany({
        data: rows.map((row) => ({
          ...row,
          userId: this.users.get(row.userId)!,
          printId: row.printId ? (this.prints.get(row.printId) ?? row.printId) : null,
        })),
        skipDuplicates: true,
      });
    }
  }

  /** Their badges, seen as they were there, at the higher tier for someone merged into an account here that has the
   *  badge too, and the days they used the old instance, for Regular. */
  private async mergeAchievements(sourceIds: string[]) {
    const badges = await this.source.userAchievement.findMany({ where: { userId: { in: sourceIds } } });
    for (const badge of badges) {
      const userId = this.users.get(badge.userId)!;
      const created = await prisma.userAchievement.createMany({ data: [{ ...badge, userId }], skipDuplicates: true });
      if (created.count) continue;
      // Only raises, as achievementService does.
      await prisma.userAchievement.updateMany({
        where: { userId, badge: badge.badge, tier: { lt: badge.tier } },
        data: { tier: badge.tier, earnedAt: badge.earnedAt, seenAt: badge.seenAt },
      });
    }
    const days = await this.source.userActiveDay.findMany({ where: { userId: { in: sourceIds } } });
    if (days.length) {
      await prisma.userActiveDay.createMany({
        data: days.map((day) => ({ ...day, userId: this.users.get(day.userId)! })),
        skipDuplicates: true,
      });
    }
  }

  /** Icons they uploaded for launcher links and widgets: their names are their files'. */
  private async mergeIcons(sourceIds: string[]) {
    const icons = await this.source.userIcon.findMany({ where: { userId: { in: sourceIds } } });
    for (const icon of icons) {
      const file = `${icon.id}.${icon.ext}`;
      if (!/^[A-Za-z0-9_-]+\.(png|svg)$/.test(file)) continue;
      if (!(await this.files.copy(path.join("icons", file), path.join(ICONS, file)))) continue;
      await prisma.userIcon.createMany({
        data: [{ ...icon, userId: this.users.get(icon.userId)! }],
        skipDuplicates: true,
      });
    }
  }

  /** This instance's sign-in provider that's the same as one there: the same name and the same issuer, as a sign-in
   *  is the issuer's word for who someone is. Undefined for none; null for one by that name with another issuer. */
  private async oidcHere(provider: { slug: string; issuerUrl: string }): Promise<string | null | undefined> {
    const here = await prisma.oidcProvider.findUnique({
      where: { slug: provider.slug },
      select: { id: true, issuerUrl: true },
    });
    if (!here) return undefined;
    return sameIssuer(here.issuerUrl, provider.issuerUrl) ? here.id : null;
  }

  /** How they sign in through a sign-in provider: to one here with the same name, or one that came with the secrets. */
  private async mergeIdentities(sourceIds: string[]) {
    const providers = await this.source.oidcProvider.findMany({ select: { id: true, slug: true, issuerUrl: true } });
    for (const provider of providers) {
      if (this.oidc.has(provider.id)) continue;
      const here = await this.oidcHere(provider);
      if (here) this.oidc.set(provider.id, here);
    }
    const identities = await this.source.userIdentity.findMany({ where: { userId: { in: sourceIds } } });
    const data = identities.flatMap((identity) => {
      const providerId = this.oidc.get(identity.providerId);
      return providerId ? [{ ...identity, providerId, userId: this.users.get(identity.userId)! }] : [];
    });
    if (data.length) await prisma.userIdentity.createMany({ data, skipDuplicates: true });
  }

  private async mergeSyncs(sourceIds: string[]) {
    const syncs = await this.source.collectionSync.findMany({ where: { userId: { in: sourceIds } } });
    for (const sync of syncs) {
      const collectionId = this.collections.get(sync.collectionId);
      const userId = this.users.get(sync.userId)!;
      if (!collectionId) continue;
      try {
        const here = await prisma.collectionSync.findUnique({
          where: { userId_provider_externalId: { userId, provider: sync.provider, externalId: sync.externalId } },
          select: { id: true },
        });
        if (here) continue;
        const id = (await prisma.collectionSync.findUnique({ where: { id: sync.id }, select: { id: true } }))
          ? freshId()
          : sync.id;
        // What it has seen comes too, so it imports only what's new since.
        await prisma.collectionSync.create({ data: { ...sync, id, userId, collectionId } });
        this.report.syncs += 1;
      } catch (err) {
        this.fail("sync", sync.title ?? sync.sourceUrl, err);
      }
    }
    // The lists Thingport Grab read for them, which some syncs follow.
    const listings = await this.source.providerListing.findMany({ where: { userId: { in: sourceIds } } });
    if (listings.length) {
      await prisma.providerListing.createMany({
        data: listings.map((listing) => ({
          ...listing,
          userId: this.users.get(listing.userId)!,
          data: listing.data as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
  }

  /** Their sign-ins on provider sites, unless they're signed in here already. */
  private async mergeSignIns(sourceIds: string[]) {
    const connections = await this.source.providerConnection.findMany({ where: { userId: { in: sourceIds } } });
    if (!connections.length) return;
    const { count } = await prisma.providerConnection.createMany({
      data: connections.map((connection) =>
        rowFor<Prisma.ProviderConnectionCreateManyInput>("ProviderConnection", {
          ...connection,
          userId: this.users.get(connection.userId)!,
        }),
      ),
      skipDuplicates: true,
    });
    this.report.signIns += count;
  }

  private async mergeWidgets(sourceIds: string[]) {
    const widgets = await this.source.customWidget.findMany({ where: { userId: { in: sourceIds } } });
    if (!widgets.length) return;
    const { count } = await prisma.customWidget.createMany({
      data: widgets.map((widget) =>
        rowFor<Prisma.CustomWidgetCreateManyInput>("CustomWidget", {
          ...widget,
          userId: this.users.get(widget.userId)!,
        }),
      ),
      skipDuplicates: true,
    });
    this.report.widgets += count;
  }

  /** Tools they made, and what tools keep for them. A repository tool's data follows it where it's installed here. */
  private async mergeTools(sourceIds: string[]) {
    const tools = await this.source.tool.findMany({
      where: { OR: [{ source: "repo" }, { source: "own", userId: { in: sourceIds } }] },
    });
    for (const tool of tools) {
      try {
        if (tool.source === "repo") {
          const here = await prisma.tool.findUnique({
            where: { scope_slug: { scope: "repo", slug: tool.slug } },
            select: { id: true },
          });
          if (here) this.tools.set(tool.id, here.id);
          continue;
        }
        const userId = this.users.get(tool.userId!)!;
        const here = await prisma.tool.findUnique({
          where: { scope_slug: { scope: userId, slug: tool.slug } },
          select: { id: true },
        });
        if (here) {
          this.tools.set(tool.id, here.id);
          continue;
        }
        const id = (await prisma.tool.findUnique({ where: { id: tool.id }, select: { id: true } }))
          ? freshId()
          : tool.id;
        await prisma.tool.create({
          data: rowFor<Prisma.ToolUncheckedCreateInput>("Tool", { ...tool, id, scope: userId, userId }),
        });
        this.tools.set(tool.id, id);
        this.report.tools += 1;
      } catch (err) {
        this.fail("tool", tool.slug, err);
      }
    }
    const data = await this.source.toolData.findMany({ where: { userId: { in: sourceIds } } });
    const kept = data.flatMap((entry) => {
      const toolId = this.tools.get(entry.toolId);
      return toolId
        ? [{ ...entry, toolId, userId: this.users.get(entry.userId)!, value: entry.value as Prisma.InputJsonValue }]
        : [];
    });
    if (kept.length) await prisma.toolData.createMany({ data: kept, skipDuplicates: true });
  }

  private async mergeStudio(sourceIds: string[]) {
    const designs = await this.source.studioDesign.findMany({ where: { userId: { in: sourceIds } } });
    for (const design of designs) {
      const userId = this.users.get(design.userId)!;
      try {
        if (!PLAIN_ID.test(design.id)) throw new Error("This design's id isn't one Thingport makes");
        const earlier = await prisma.studioDesign.findUnique({ where: { id: design.id }, select: { userId: true } });
        // Another's design with its id isn't theirs to add to. One an earlier try made gets what that try didn't.
        if (earlier && earlier.userId !== userId) throw new Error("A design here already has this design's id");
        if (!earlier) {
          await prisma.studioDesign.create({
            data: { ...design, userId, document: design.document as Prisma.InputJsonValue },
          });
        }
        for (let skip = 0; ; skip += 50) {
          const revisions = await this.source.studioRevision.findMany({
            where: { designId: design.id },
            orderBy: { position: "asc" },
            skip,
            take: 50,
          });
          if (!revisions.length) break;
          await prisma.studioRevision.createMany({
            data: revisions.map((revision) => rowFor<Prisma.StudioRevisionCreateManyInput>("StudioRevision", revision)),
            skipDuplicates: true,
          });
        }
        const messages = await this.source.studioMessage.findMany({ where: { designId: design.id } });
        if (messages.length) {
          await prisma.studioMessage.createMany({
            data: messages.map((message) => rowFor<Prisma.StudioMessageCreateManyInput>("StudioMessage", message)),
            skipDuplicates: true,
          });
        }
        // The meshes it imported and the pictures its prompts had.
        await this.files.copyFolder(
          path.join("studio", `u-${design.userId}`, design.id),
          path.join(STUDIO_ASSETS, `u-${userId}`, design.id),
        );
        if (!earlier) this.report.designs += 1;
      } catch (err) {
        this.fail("design", design.name, err);
      }
    }
  }

  /** Instance settings, which replace this instance's: the admin asked for the old instance's. */
  private async mergeSettings() {
    const rows = await this.source.setting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
    for (const row of rows) {
      const value = await this.settingHere(row.key, row.value);
      if (value === undefined) continue;
      await prisma.setting.upsert({ where: { key: row.key }, create: { key: row.key, value }, update: { value } });
      this.report.settings += 1;
    }
  }

  /** A setting's value with the people and AI services it names as they are here; undefined when it names someone
   *  who didn't come. */
  private async settingHere(key: string, value: Prisma.JsonValue): Promise<Prisma.InputJsonValue | undefined> {
    if (key === "consume_user_id") return typeof value === "string" ? this.users.get(value) : undefined;
    if (value === null) return undefined;
    if (key === "tools_access" && typeof value === "object" && !Array.isArray(value)) {
      const ids = Array.isArray(value.userIds) ? value.userIds : [];
      return { ...value, userIds: ids.flatMap((id) => (typeof id === "string" ? (this.users.get(id) ?? []) : [])) };
    }
    if (
      ["ai_categorization", "ai_descriptions", "studio_assistant"].includes(key) &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const connection = value.aiConnectionId;
      if (
        typeof connection === "string" &&
        !(await prisma.aiConnection.findUnique({ where: { id: connection }, select: { id: true } }))
      ) {
        return { ...value, aiConnectionId: null };
      }
    }
    return value as Prisma.InputJsonValue;
  }

  /** AI services, sign-in providers, provider API keys and the mail server. One here by the same name stays as it is. */
  private async mergeSecrets() {
    const keys = await this.source.setting.findMany({ where: { key: { in: [...SECRET_SETTING_KEYS] } } });
    for (const row of keys) {
      if (row.value === null) continue;
      const value = row.value as Prisma.InputJsonValue;
      await prisma.setting.upsert({ where: { key: row.key }, create: { key: row.key, value }, update: { value } });
      this.report.secrets += 1;
    }
    const hasDefault = (await prisma.aiConnection.count({ where: { isDefault: true } })) > 0;
    for (const connection of await this.source.aiConnection.findMany()) {
      if (await prisma.aiConnection.findUnique({ where: { id: connection.id }, select: { id: true } })) continue;
      await prisma.aiConnection.create({ data: { ...connection, isDefault: connection.isDefault && !hasDefault } });
      this.report.secrets += 1;
    }
    for (const provider of await this.source.oidcProvider.findMany()) {
      const here = await this.oidcHere(provider);
      // One by that name with another issuer stays as it is here, and their sign-ins through the old one don't come.
      if (here !== undefined) {
        if (here) this.oidc.set(provider.id, here);
        continue;
      }
      const id = (await prisma.oidcProvider.findUnique({ where: { id: provider.id }, select: { id: true } }))
        ? freshId()
        : provider.id;
      await prisma.oidcProvider.create({ data: { ...provider, id } });
      this.oidc.set(provider.id, id);
      this.report.secrets += 1;
    }
  }

  // --- Filing ---

  private async fileModels() {
    const { unfiled } = await fileRunModels(
      this.runId,
      (done, total) => {
        if (done === 0) this.phase("filing", total);
        else this.tick();
      },
      (name, err) => this.fail("filing", name, err),
    );
    this.report.models.unfiled += unfiled;
  }

  private async finish() {
    // The starter categories' ids for the providers added since the old instance's release.
    const created = [...this.created];
    if (created.length)
      await seedStarterSiteIdsFor(created).catch((err) => log.warn("couldn't seed category ids", { error: err }));
    // A tool installed here gives its models to the people who came.
    provisionEveryoneSoon();
  }
}

/** Moves the files run `runId` copied to where this instance's storage structure puts them, now that their models'
 *  collections are in too: models an earlier, unfinished try of it brought as well. A model that can't be filed keeps
 *  its files in the run's folder, where its rows find them, until a storage move files it. */
export async function fileRunModels(
  runId: string,
  onProgress: (done: number, total: number) => void = () => undefined,
  onFailure: (name: string, err: unknown) => void = () => undefined,
): Promise<{ filed: number; unfiled: number }> {
  const prefix = `${path.join(MIGRATE_FOLDER, runId)}${path.sep}`;
  const where: Prisma.PrintWhereInput = {
    OR: [
      { assetsPath: { startsWith: prefix } },
      { plates: { some: { storagePath: { startsWith: prefix } } } },
      { files: { some: { storagePath: { startsWith: prefix } } } },
    ],
  };
  const prints = await prisma.print.findMany({ where, include: { plates: true } });
  onProgress(0, prints.length);
  let filed = 0;
  let unfiled = 0;
  for (const print of prints) {
    try {
      await relocatePrint(print, print.plates);
      filed += 1;
    } catch (err) {
      unfiled += 1;
      log.warn("couldn't file a migrated model", { printId: print.id, error: err });
      onFailure(print.name, err);
    }
    onProgress(filed + unfiled, prints.length);
  }
  if (!(await prisma.print.count({ where }))) {
    await fs.rm(path.join(STORAGE, MIGRATE_FOLDER, runId), { recursive: true, force: true }).catch(() => undefined);
  }
  await pruneEmptyStorageDirs(path.join(STORAGE, MIGRATE_FOLDER));
  return { filed, unfiled };
}

/** Rules that bring a table, for the check that MERGED_TABLES matches them. */
export function tablesThatCome(): Prisma.ModelName[] {
  return (Object.entries(MERGE_RULES) as [Prisma.ModelName, { part?: string }][])
    .filter(([, rule]) => "part" in rule)
    .map(([table]) => table);
}
