import fs from "node:fs/promises";
import path from "node:path";
import { STORAGE } from "../../../config";
import { prisma } from "../../../db";
import { createLogger } from "../../../logger";
import { parseModelUrl } from "../../../providers/index.generated";
import { mimeFromContentType, sanitizeFilename } from "../../../utils/fileUtils";
import { normalizeTags } from "../../../utils/tagNormalization";
import { addPrintsToCollection, normalizeCollectionName } from "../../collectionService";
import { licenseById, licenseIdFromText, type ProviderLicense } from "../../licenseCatalog";
import { licenseData } from "../../licenseService";
import { isPreparedPrintFilename } from "../../preparedPrint";
import { createPrint, discardPrint, type NewPlateInput } from "../../printCreation";
import { saveFileFromTemp } from "../../printFileService";
import { addUploadedPreviewImages } from "../../uploadService";
import { MigrateError } from "../errors";
import { MIGRATE_FOLDER, PLAIN_ID } from "../merge";
import {
  filePathOf,
  idOf,
  type ManyfoldClient,
  type ManyfoldCollection,
  type ManyfoldCreator,
  type ManyfoldFile,
  type ManyfoldModel,
} from "./api";

// Bringing Manyfold's models into Thingport's own: a model with at least one 3D file becomes a model here, with its
// 3D files as its plates in the folders they were in, its pictures as its gallery and its other files beside them. Its
// tags, licence, creator (by name), caption and notes come along; a link to a site Thingport imports from becomes its
// source. Collections, which nest there, become each person's own, named after the ones above them: "Minis / Dragons".
// Manyfold's sensitive flag, its comments, permissions and which files are presupported have nowhere to go.

const log = createLogger("migrate");

const PLATE_EXTS = new Set([".stl", ".3mf", ".step", ".stp", ".obj", ".glb", ".f3d", ".lbrn", ".lbrn2"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MAX_FAILURES = 50;
const STOPS = new Set(["manyfold_lost", "manyfold_unreachable", "manyfold_key", "manyfold_slow_down"]);

export type ManyfoldOptions = {
  /** Manyfold usernames, and the person here each one's models go to. Everyone else's go to the admin. */
  owners: { username: string; userId: string }[];
  collections: boolean;
};

export type ManyfoldReport = {
  models: {
    brought: number;
    /** An earlier run of this or another migration from the same Manyfold brought it. */
    earlier: number;
    /** It has no 3D file Thingport takes. */
    noFiles: number;
    /** In its owner's library already, imported from the page it links to. */
    alreadyHere: number;
    failed: number;
  };
  files: { copied: number; missing: number };
  collections: { brought: number; merged: number };
  failures: { kind: string; name: string; error: string }[];
};

export type ManyfoldProgress = { phase: "owners" | "models" | "collections"; done: number; total: number };

/** A licence by its SPDX id, as Manyfold names it; one Thingport doesn't know is kept as it's named. */
export function manyfoldLicense(spdx: string | undefined): ProviderLicense | null {
  const raw = spdx?.trim();
  if (!raw) return null;
  const id =
    licenseById(raw)?.id ??
    licenseById(raw.replace(/-(only|or-later)$/, ""))?.id ??
    licenseIdFromText(raw.replace(/-/g, " ")) ??
    null;
  return id ? { id, raw } : { id: null, raw, label: raw.replace(/^LicenseRef-/, "") };
}

/** Tags as Thingport keeps them, without the "!new" Manyfold puts on everything it finds. */
export function manyfoldTags(keywords: string[] | undefined): string[] {
  return normalizeTags((keywords ?? []).filter((tag) => tag && !tag.startsWith("!")));
}

/** The model's notes: its caption, its description and the links that aren't its source. */
export function manyfoldNotes(model: ManyfoldModel, sourceLink: string | null): string | null {
  const parts: string[] = [];
  if (model.caption?.trim()) parts.push(`*${model.caption.trim()}*`);
  if (model.description?.trim()) parts.push(model.description.trim());
  const links = (model.links ?? []).filter((link) => link.url && link.url !== sourceLink);
  if (links.length) parts.push(links.map((link) => `- [${link.text?.trim() || link.url}](${link.url})`).join("\n"));
  return parts.length ? parts.join("\n\n") : null;
}

export class ManyfoldImport {
  readonly report: ManyfoldReport = {
    models: { brought: 0, earlier: 0, noFiles: 0, alreadyHere: 0, failed: 0 },
    files: { copied: 0, missing: 0 },
    collections: { brought: 0, merged: 0 },
    failures: [],
  };
  private owner = new Map<string, string>();
  private collectionNames = new Map<string, string>();
  private creators = new Map<string, string | null>();
  /** Each person's collections here by name, made or found. */
  private collectionsHere = new Map<string, string>();

  constructor(
    private readonly client: ManyfoldClient,
    private readonly runId: string,
    private readonly options: ManyfoldOptions,
    private readonly adminId: string,
    /** Manyfold model ids brought before; each one brought now is added. */
    readonly done: Set<string>,
    private readonly onProgress: (progress: ManyfoldProgress) => void,
    /** Keeps `done` after each model that came, so a run the server stopped doesn't bring it twice. */
    private readonly onBrought: () => Promise<void> = async () => undefined,
  ) {}

  private fail(kind: string, name: string, err: unknown) {
    log.warn("couldn't bring a Manyfold model over", { kind, name, error: err });
    if (this.report.failures.length < MAX_FAILURES) {
      this.report.failures.push({ kind, name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async run(): Promise<ManyfoldReport> {
    this.onProgress({ phase: "owners", done: 0, total: this.options.owners.length });
    for (const [index, { username, userId }] of this.options.owners.entries()) {
      const { refs } = await this.client.modelRefs(username);
      for (const ref of refs) if (!this.owner.has(idOf(ref))) this.owner.set(idOf(ref), userId);
      this.onProgress({ phase: "owners", done: index + 1, total: this.options.owners.length });
    }
    if (this.options.collections) await this.readCollections();
    const { refs } = await this.client.modelRefs();
    for (const [index, ref] of refs.entries()) {
      const id = idOf(ref);
      if (this.done.has(id)) this.report.models.earlier += 1;
      else {
        try {
          await this.bring(ref["@id"], id);
        } catch (err) {
          // Manyfold gone, or the key revoked: every model after would fail the same way.
          if (err instanceof MigrateError && STOPS.has(err.code)) throw err;
          this.report.models.failed += 1;
          this.fail("model", ref.name ?? id, err);
        }
      }
      this.onProgress({ phase: "models", done: index + 1, total: refs.length });
    }
    await fs
      .rm(path.join(STORAGE, MIGRATE_FOLDER, this.runId), { recursive: true, force: true })
      .catch(() => undefined);
    return this.report;
  }

  /** Every collection's name, with the names of the ones it's in before it. */
  private async readCollections() {
    const refs = await this.client.collections();
    this.onProgress({ phase: "collections", done: 0, total: refs.length });
    const byId = new Map<string, ManyfoldCollection>();
    for (const [index, ref] of refs.entries()) {
      byId.set(idOf(ref), await this.client.json<ManyfoldCollection>(ref["@id"]));
      this.onProgress({ phase: "collections", done: index + 1, total: refs.length });
    }
    for (const [id, collection] of byId) {
      const names: string[] = [];
      let at: ManyfoldCollection | undefined = collection;
      for (let depth = 0; at && depth < 16; depth++) {
        names.unshift(at.name?.trim() || idOf(at));
        at = at.isPartOf ? byId.get(idOf(at.isPartOf)) : undefined;
      }
      this.collectionNames.set(id, names.join(" / ").slice(0, 200));
    }
  }

  private async creatorName(ref: ManyfoldModel["creator"]): Promise<string | null> {
    if (!ref?.["@id"]) return null;
    const id = idOf(ref);
    if (!this.creators.has(id)) {
      const creator = await this.client.json<ManyfoldCreator>(ref["@id"]).catch(() => null);
      this.creators.set(id, creator?.name?.trim() || null);
    }
    return this.creators.get(id) ?? null;
  }

  /** One model, with its files, into its owner's library. */
  private async bring(link: string, id: string) {
    // It names the model's folder while its files come, so ".." would be the folder above.
    if (!PLAIN_ID.test(id)) throw new Error("This model's id isn't one Manyfold makes");
    const model = await this.client.json<ManyfoldModel>(link);
    const userId = this.owner.get(id) ?? this.adminId;
    const sourceLink = (model.links ?? []).find((item) => item.url && parseModelUrl(item.url))?.url ?? null;
    const source = sourceLink ? parseModelUrl(sourceLink) : null;
    if (source) {
      const here = await prisma.print.findFirst({
        where: { userId, sourceProvider: source.provider, sourceExternalId: source.externalId },
        select: { id: true },
      });
      if (here) {
        this.done.add(id);
        this.report.models.alreadyHere += 1;
        return;
      }
    }
    const temp = path.join(STORAGE, MIGRATE_FOLDER, this.runId, id);
    try {
      const plates: NewPlateInput[] = [];
      const images: { file: string; preview: boolean }[] = [];
      const others: { file: string; name: string; mime: string; folder: string | null }[] = [];
      for (const [index, part] of (model.hasPart ?? []).entries()) {
        const file = await this.client.json<ManyfoldFile>(part["@id"]);
        const relative = filePathOf(file.contentUrl);
        if (!relative || !file.contentUrl) {
          this.report.files.missing += 1;
          continue;
        }
        const name = sanitizeFilename(path.posix.basename(relative));
        const folder = path.posix.dirname(relative) === "." ? null : path.posix.dirname(relative);
        const local = path.join(temp, `${index}-${name}`);
        if (!(await this.client.download(file.contentUrl, local))) {
          this.report.files.missing += 1;
          continue;
        }
        this.report.files.copied += 1;
        const ext = path.extname(name).toLowerCase();
        const mime = mimeFromContentType(file.encodingFormat, name);
        if (PLATE_EXTS.has(ext)) plates.push({ filename: name, mime, tempFilePath: local, folder });
        else if (IMAGE_EXTS.has(ext)) images.push({ file: local, preview: idOf(part) === idOf(model.preview_file) });
        else others.push({ file: local, name, mime, folder });
      }
      if (!plates.length) {
        this.report.models.noFiles += 1;
        return;
      }
      const license = manyfoldLicense(model["spdx:license"]?.licenseId);
      const { print } = await createPrint(
        userId,
        {
          notes: manyfoldNotes(model, sourceLink),
          tags: manyfoldTags(model.keywords),
          creator: await this.creatorName(model.creator),
          sourceProvider: source ? source.provider : null,
          sourceExternalId: source ? source.externalId : null,
          licenseColumns: license ? licenseData(license, "user", null) : undefined,
        },
        model.name?.trim() || id,
        plates,
        { describe: false, classify: false },
      );
      try {
        // A model has one prepared print, which a second would replace: any more are kept beside it.
        let prepared = false;
        for (const other of others) {
          const role: "PREPARED" | "SUPPORTING" =
            !prepared && isPreparedPrintFilename(other.name) ? "PREPARED" : "SUPPORTING";
          prepared ||= role === "PREPARED";
          await saveFileFromTemp(userId, print.id, other.file, other.name, other.mime, { role, folder: other.folder });
        }
        // Its preview first, as it was there.
        const ordered = images.toSorted((a, b) => Number(b.preview) - Number(a.preview));
        if (ordered.length)
          await addUploadedPreviewImages(print.id, await Promise.all(ordered.map((image) => fs.readFile(image.file))));
        // Here too, so a model left out of its collection isn't kept to be brought again by the next run.
        if (this.options.collections) await this.addToCollections(userId, print.id, model);
      } catch (err) {
        await discardPrint(print.id);
        throw err;
      }
      this.done.add(id);
      this.report.models.brought += 1;
      await this.onBrought();
    } finally {
      await fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async addToCollections(userId: string, printId: string, model: ManyfoldModel) {
    for (const ref of model.isPartOf ?? []) {
      const name = this.collectionNames.get(idOf(ref));
      if (!name) continue;
      const key = `${userId}\u0000${name}`;
      let collectionId = this.collectionsHere.get(key);
      if (!collectionId) {
        const nameNormalized = normalizeCollectionName(name);
        const here = await prisma.collection.findFirst({ where: { userId, nameNormalized }, select: { id: true } });
        if (here) {
          collectionId = here.id;
          this.report.collections.merged += 1;
        } else {
          collectionId = (await prisma.collection.create({ data: { userId, name, nameNormalized } })).id;
          this.report.collections.brought += 1;
        }
        this.collectionsHere.set(key, collectionId);
      }
      await addPrintsToCollection(collectionId, [printId]);
    }
  }
}
