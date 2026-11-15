import { licenseData } from "../services/licenseService";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, type RemoteModel } from "@prisma/client";
import { IMPORT_MAX_BYTES, RENDERABLE_MODEL_EXTS } from "../config";
import { prisma } from "../db";
import { createLog } from "../services/auditLog";
import { buildAuthorId } from "../services/authorService";
import { matchingCategoryId } from "../services/categoryService";
import { DESCRIPTION_IMAGE, DESCRIPTION_IMAGE_REF, saveDescriptionImage } from "../services/descriptionImageService";
import { canRenderModelImage } from "../services/modelPreviewCache";
import { plateAssetHome } from "../services/modelAssets";
import { isPreparedPrintFilename } from "../services/preparedPrint";
import { addPreviewImage, preferImageOverRenders } from "../services/previewImageService";
import { createPrint, discardPrint, isGeneratorScript, type NewPlateInput } from "../services/printCreation";
import { saveFileFromTemp } from "../services/printFileService";
import { PROFILE_PROVIDER_VERSION } from "../services/printProfileService";
import { plateThumbExists, plateThumbReplaceable, saveThumbFromBytes } from "../services/printService";
import { getPreviewMode } from "../services/settingsService";
import { HttpError, mimeFromContentType, sanitizeFilename } from "../utils/fileUtils";
import { activeRemoteModel, fetchRemoteFile, filesOf, type RemoteFile, type RemoteModelRow } from "./remoteFiles";
import type { RemoteModelDetails } from "./remoteIndex";
import { signedGet } from "./signedFetch";

/** A partner's model copied into a viewer's library: its files, pictures and description fetched through this instance,
 *  made into a model of the viewer's own, and marked with where it came from (`Print.remoteSource`), so it says so and
 *  the original offers it again rather than another copy. What the partner says of it (RemoteModel.details) makes it
 *  the same model as there: its tags, creator, source site, print profiles, files' roles, pictures, and the viewer's
 *  own starter category matching its. It runs in the background, file by file, and the page asks how it's going:
 *  leaving the page doesn't stop it. A copy is made only once every file is here, so one cut short leaves nothing half
 *  made. */

export type RemoteSource = {
  apId: string;
  origin: string;
  instance: string;
  ownerName: string;
  ownerHandle: string | null;
};

export type CopyFileStatus = { name: string; size: number | null; received: number; done: boolean };
export type CopyStatus = {
  state: "idle" | "copying" | "done" | "failed";
  files: CopyFileStatus[];
  copy_id: string | null;
  error: string | null;
};

const PICTURE_MAX_BYTES = 20 * 1024 * 1024;
const PICTURE_MS = 60 * 1000;
// At once, per person: each holds files on disk until it's done.
const MAX_RUNNING_PER_USER = 3;
// A finished copy's status stays a while, for a page that asks once more.
const KEEP_FINISHED_MS = 10 * 60 * 1000;

const jobs = new Map<string, CopyStatus>();
const admitting = new Map<string, Promise<CopyStatus>>();
const keyOf = (userId: string, modelId: string) => `${userId}:${modelId}`;

/** What the partner said a copy needs (remoteIndex.ts), or null from one too old to say. */
export function detailsOf(model: Pick<RemoteModel, "details">): RemoteModelDetails | null {
  const value = model.details;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as unknown as RemoteModelDetails) : null;
}

/** The viewer's own copy of a partner's model, if they made one, or the same model from the same site, if they have it:
 *  either is theirs already. */
export async function libraryCopyOfRemote(
  userId: string,
  model: Pick<RemoteModel, "apId" | "details">,
): Promise<string | null> {
  const site = detailsOf(model)?.importedFrom;
  const found = await prisma.print.findFirst({
    where: {
      userId,
      OR: [
        { remoteSource: { path: ["apId"], equals: model.apId } },
        ...(site ? [{ sourceProvider: site.provider, sourceExternalId: site.externalId }] : []),
      ],
    },
    select: { id: true },
  });
  return found?.id ?? null;
}

/** How copying the model is going for `userId`: under way, done (their copy's id), failed, or not started. */
export async function remoteCopyStatus(userId: string, modelId: string): Promise<CopyStatus> {
  const job = jobs.get(keyOf(userId, modelId));
  if (job && job.state !== "done") return job;
  const model = await activeRemoteModel(modelId, userId);
  const copyId = await libraryCopyOfRemote(userId, model);
  if (copyId) return { state: "done", files: job?.files ?? [], copy_id: copyId, error: null };
  return { state: "idle", files: [], copy_id: null, error: null };
}

/** Starts copying the model into `userId`'s library, unless it's under way or they have a copy already. Asked twice at
 *  once, the second hears the first's answer rather than starting another. */
export function startRemoteCopy(userId: string, modelId: string): Promise<CopyStatus> {
  const key = keyOf(userId, modelId);
  const pending = admitting.get(key);
  if (pending) return pending;
  const admission = admit(userId, modelId, key).finally(() => admitting.delete(key));
  admitting.set(key, admission);
  return admission;
}

async function admit(userId: string, modelId: string, key: string): Promise<CopyStatus> {
  const running = jobs.get(key);
  if (running?.state === "copying") return running;
  const model = await activeRemoteModel(modelId, userId);
  const copyId = await libraryCopyOfRemote(userId, model);
  if (copyId) return { state: "done", files: [], copy_id: copyId, error: null };
  const listed = filesOf(model, model.peer.origin);
  if (!listed.some((file) => file.url)) throw new HttpError(409, "That model has no files to copy", "no_files");
  // A copy is the whole model or nothing: one of its files that can't be had isn't left out.
  if (listed.some((file) => !file.url)) {
    throw new HttpError(409, "Not every file of that model can be fetched from its instance", "files_missing");
  }
  // All of it no bigger than one import, as a ZIP of it: each file is held on disk until the copy is made.
  if (listed.reduce((sum, file) => sum + (file.size ?? 0), 0) > IMPORT_MAX_BYTES) {
    throw new HttpError(413, "Too big to copy here: it's more than this instance takes in one import", "copy_too_big");
  }
  const files = listed.map((file, index) => ({ file, index }));
  const mine = [...jobs.entries()].filter(([k, job]) => k.startsWith(`${userId}:`) && job.state === "copying");
  if (mine.length >= MAX_RUNNING_PER_USER) {
    throw new HttpError(429, "Wait for the copies under way to finish", "copy_limit");
  }
  const job: CopyStatus = {
    state: "copying",
    files: files.map(({ file }) => ({ name: file.name, size: file.size, received: 0, done: false })),
    copy_id: null,
    error: null,
  };
  jobs.set(key, job);
  void run(userId, model, files, job).finally(() => {
    setTimeout(() => {
      if (jobs.get(key) === job) jobs.delete(key);
    }, KEEP_FINISHED_MS).unref();
  });
  return job;
}

/** Its images made links to them: shown in the copy, they'd have a viewer's browser fetch them from wherever they are,
 *  which a partner's things never do (MarkdownDescription `remote`). */
export function imagesAsLinks(markdown: string | null): string | null {
  return markdown ? markdown.replace(/(?<!\\)!\[/g, "[") : markdown;
}

// A private-use character, which nothing in a description means, marks an image held aside.
const HELD = "\uE000";
const HELD_IMAGE = new RegExp(`${HELD}(\\d+)${HELD}`, "g");

/** A partner's description as its copy's: its own images (`/description-image/<id>` there) pointed at the copy's,
 *  `renamed` from theirs, one that didn't come left out, and any other image made a link (imagesAsLinks). */
export function describedLocally(markdown: string | null, renamed: ReadonlyMap<string, string>): string | null {
  if (!markdown) return markdown;
  // Each kept image held aside while the others become links, the mark taken out of the text first.
  const kept: string[] = [];
  const held = markdown
    .replaceAll(HELD, "")
    .replace(DESCRIPTION_IMAGE, (_, alt: string, id: string) => {
      const next = renamed.get(id);
      if (!next) return "";
      kept.push(`![${alt}](/description-image/${next})`);
      return `${HELD}${kept.length - 1}${HELD}`;
    })
    .replace(DESCRIPTION_IMAGE_REF, (_, id: string) => {
      const next = renamed.get(id);
      return next ? `/description-image/${next}` : "";
    });
  return imagesAsLinks(held)!.replace(HELD_IMAGE, (_, index: string) => kept[Number(index)]);
}

async function run(
  userId: string,
  model: RemoteModelRow,
  files: { index: number; file: RemoteFile }[],
  job: CopyStatus,
): Promise<void> {
  let dir: string | null = null;
  try {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "thingport-remote-copy-"));
    const fetched: Fetched[] = [];
    // What the partner says of their sizes isn't taken on trust: what came so far counts against the rest.
    let total = 0;
    for (const [position, { index, file }] of files.entries()) {
      const dest = path.join(dir, `${position}-${sanitizeFilename(file.name) || "file"}`);
      await fetchRemoteFile(model, index, dest, {
        maxBytes: IMPORT_MAX_BYTES - total,
        onProgress: (received) => {
          job.files[position].received = received;
        },
      });
      total += (await fsp.stat(dest)).size;
      job.files[position].done = true;
      fetched.push({ file, path: dest });
    }
    const made = await makeCopy(userId, model, fetched);
    job.state = "done";
    job.copy_id = made.id;
    if (!made.copied) return;
    void createLog({
      userId,
      action: "model_copied",
      targetId: made.id,
      details: { name: model.title, from: model.apId, instance: model.peer.origin },
    });
  } catch (err) {
    job.state = "failed";
    job.error = (err as Error).message || "Couldn't copy it";
    console.warn(`[federation] Couldn't copy ${model.apId}:`, job.error);
  } finally {
    if (dir) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

type Fetched = { file: RemoteFile; path: string };

/** The model made from its fetched files, with where it came from in the same write: never a copy that doesn't say so,
 *  which another try would copy again. `copied` is false when the same model from the same site reached their library
 *  meanwhile, which comes back instead. */
async function makeCopy(
  userId: string,
  model: RemoteModelRow,
  fetched: Fetched[],
): Promise<{ id: string; copied: boolean }> {
  const details = detailsOf(model);
  const site = details?.importedFrom ?? null;
  const { plates, supporting } = splitFiles(fetched);
  const profiles = new Set<string>();
  const plateInputs: NewPlateInput[] = plates.map(({ file, path: tempFilePath }) => {
    const filename = sanitizeFilename(file.name) || "file";
    // One plate to a profile, as the partner's own model has it.
    const profileId = file.profileId && !profiles.has(file.profileId) ? file.profileId : null;
    if (profileId) profiles.add(profileId);
    return {
      filename,
      folder: file.folder,
      mime: mimeFromContentType(file.mediaType, filename),
      tempFilePath,
      sourceInstanceId: profileId,
      profile: profileId ? copiedProfile(file.profile) : null,
    };
  });
  const categoryId = await matchingCategoryId(userId, details?.category).catch(() => null);
  // Only an author this instance knows already: what a partner says of one isn't made everyone's here. Without one,
  // the copy's source fills it in (Fetch missing details).
  const author = details?.author
    ? await prisma.author.findUnique({
        where: { id: buildAuthorId(details.author.provider, details.author.externalId) },
        select: { id: true },
      })
    : null;
  const source: RemoteSource = {
    apId: model.apId,
    origin: model.peer.origin,
    instance: model.peer.name ?? new URL(model.peer.origin).host,
    ownerName: model.person.displayName,
    ownerHandle: model.person.username ? `${model.person.username}@${new URL(model.peer.origin).host}` : null,
  };

  let created: Awaited<ReturnType<typeof createPrint>>;
  try {
    created = await createPrint(
      userId,
      {
        title: model.title,
        // Its images come once they're here (copyDescriptionImages); until then, and if they don't, none of theirs.
        notes: describedLocally(model.description, new Map()),
        tags: details?.tags ?? [],
        // From a partner too old to say who made it, whoever shared it.
        creator: details ? details.creator : model.person.displayName,
        authorId: author?.id ?? null,
        sourceProvider: site?.provider ?? null,
        sourceExternalId: site?.externalId ?? null,
        unfillableGaps: site ? details?.unfillableGaps : [],
        generatorScriptWithheld: details?.generatorScriptWithheld ?? false,
        // As its owner's library had it, none included; from a partner too old to say, or one that hasn't read it
        // yet, read from the source like any older import.
        licenseColumns:
          details?.license !== undefined
            ? licenseData(
                details.license,
                details.license?.source ?? "provider",
                details.license?.provider ?? site?.provider ?? null,
              )
            : undefined,
        categoryId,
        categorySource: categoryId ? "RULE" : null,
        remoteSource: source as unknown as Prisma.InputJsonValue,
      },
      path.parse(plateInputs[0].filename).name,
      plateInputs,
      // Its description is rewritten once its images are here, which a check started now would miss.
      { describe: false },
    );
  } catch (err) {
    if (site && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const theirs = await libraryCopyOfRemote(userId, model);
      if (theirs) return { id: theirs, copied: false };
    }
    throw err;
  }
  const printId = created.print.id;

  // Supporting files and the prepared print: what the model is, so a copy without them would be a different one. A
  // model has one prepared print, so any more a partner lists are kept beside it rather than each taking its place.
  try {
    let prepared = false;
    for (const { file, path: tempPath } of supporting) {
      const said = file.role ?? (isPreparedPrintFilename(sanitizeFilename(file.name)) ? "PREPARED" : "SUPPORTING");
      const role: typeof said = said === "PREPARED" && prepared ? "SUPPORTING" : said;
      prepared ||= role === "PREPARED";
      await saveFileFromTemp(userId, printId, tempPath, file.name, file.mediaType, { role, folder: file.folder });
    }
  } catch (err) {
    await discardPrint(printId);
    throw err;
  }

  // Its pictures only make it look the same: one that doesn't come is left out, not the copy.
  const didNot = (step: string) => (err: unknown) =>
    console.warn(`[federation] Couldn't ${step} of ${model.apId}:`, (err as Error).message);
  // Plates in the order made, the scripts among them kept as files instead.
  const madePlates = plates.filter(({ file }) => !isGeneratorScript(sanitizeFilename(file.name) || "file"));
  await copyPlateThumbs(model, madePlates, created.plates).catch(didNot("copy its plates' pictures"));
  await copyPictures(model, details, printId, created.plates[0]?.id).catch(didNot("copy its pictures"));
  await copyDescriptionImages(model, details, printId).catch(didNot("copy its description's images"));
  return { id: printId, copied: true };
}

/** Which files are the copy's plates and which are kept beside them: as the partner says, or for one too old to say,
 *  the 3D files plates and a sliced print beside them its prepared print, as files added to a model are
 *  (addUploadedFiles); every file a plate when none is a 3D file. */
function splitFiles(fetched: Fetched[]): { plates: Fetched[]; supporting: Fetched[] } {
  const said = fetched.filter(({ file }) => file.kind !== "file");
  if (fetched.some(({ file }) => file.kind) && said.length) {
    return { plates: said, supporting: fetched.filter(({ file }) => file.kind === "file") };
  }
  const renderable = fetched.filter(({ file }) => RENDERABLE_MODEL_EXTS.has(path.extname(file.name).toLowerCase()));
  const geometry = renderable.filter(({ file }) => !isPreparedPrintFilename(file.name));
  const plates = geometry.length ? geometry : renderable;
  if (!plates.length) return { plates: fetched, supporting: [] };
  return { plates, supporting: fetched.filter((item) => !plates.includes(item)) };
}

/** A plate's print profile as the partner's site described it, kept as this instance's provider reader would keep it
 *  (printProfileService StoredProfile), so the copy's page shows it at once. One read by an older reader than this
 *  instance's is kept only until the site is asked again; the profile's 3MF is read here either way. */
function copiedProfile(profile: RemoteFile["profile"]): Prisma.JsonValue | null {
  if (!profile) return null;
  return (
    profile.version >= PROFILE_PROVIDER_VERSION
      ? { provider: profile.facts, providerVersion: PROFILE_PROVIDER_VERSION }
      : { provider: profile.facts }
  ) as Prisma.JsonValue;
}

/** Each plate's picture where the partner has a real one (not its render) and the copy has only its own render, or
 *  the partner's render where the copy has no picture and won't render one (Model Previews), as one made before is. */
async function copyPlateThumbs(model: RemoteModelRow, plates: Fetched[], made: { id: string }[]): Promise<void> {
  const rendering = (await getPreviewMode()) === "automatic";
  for (const [index, { file }] of plates.entries()) {
    const plate = made[index];
    if (!plate || !file.thumb) continue;
    const wanted = file.thumbGenerated
      ? !(rendering && canRenderModelImage(sanitizeFilename(file.name))) &&
        !plateThumbExists(plate.id, await plateAssetHome(plate.id))
      : await plateThumbReplaceable(plate.id);
    if (!wanted) continue;
    const picture = await fetchPicture(model, file.thumb).catch(() => null);
    if (!picture || !(await saveThumbFromBytes(plate.id, picture))) continue;
    // Still a render, which a picture added later takes the place of.
    if (file.thumbGenerated) await prisma.plate.update({ where: { id: plate.id }, data: { thumbGenerated: true } });
  }
}

/** The gallery's real pictures, leading as an added picture does (preferImageOverRenders). The partner's renders and
 *  its plates' pictures standing in for none are left: the copy makes its own renders and has its plates' pictures,
 *  as for a model made here, unless the partner had nothing but renders to show. */
async function copyPictures(
  model: RemoteModelRow,
  details: RemoteModelDetails | null,
  printId: string,
  firstPlateId: string | undefined,
): Promise<void> {
  const renders = new Set(details?.renders ?? []);
  const standIns = new Set(details?.platePictures ?? []);
  let first: Buffer | null = null;
  for (const url of model.images.filter((image) => !renders.has(image) && !standIns.has(image))) {
    const picture = await fetchPicture(model, url).catch(() => null);
    if (picture && (await addPreviewImage(printId, picture).catch(() => null))) first ??= picture;
  }
  if (first) {
    await preferImageOverRenders(printId, firstPlateId, first);
    return;
  }
  if (await prisma.previewImage.count({ where: { printId } })) return;
  for (const url of model.images.filter((image) => renders.has(image) && !standIns.has(image))) {
    const picture = await fetchPicture(model, url).catch(() => null);
    if (picture) await addPreviewImage(printId, picture, { generated: true }).catch(() => null);
  }
}

/** The images its description shows, each kept as the copy's own and the description pointed at them. */
async function copyDescriptionImages(
  model: RemoteModelRow,
  details: RemoteModelDetails | null,
  printId: string,
): Promise<void> {
  const renamed = new Map<string, string>();
  for (const image of details?.descriptionImages ?? []) {
    const picture = await fetchPicture(model, image.url).catch(() => null);
    // Where it came from before the partner isn't known here, so nothing points back past it. One that isn't saved is
    // left out, not the ones before it.
    const saved = picture && (await saveDescriptionImage(printId, picture, null).catch(() => null));
    if (saved) renamed.set(image.id, saved.id);
  }
  if (!renamed.size) return;
  await prisma.print.update({ where: { id: printId }, data: { notes: describedLocally(model.description, renamed) } });
}

/** A picture of the model, read no further than PICTURE_MAX_BYTES whatever the partner says its size is. */
async function fetchPicture(model: RemoteModelRow, url: string): Promise<Buffer | null> {
  const response = await signedGet(url, model.peer.origin, {
    accept: "image/*",
    signal: AbortSignal.timeout(PICTURE_MS),
  });
  const reader = response.body?.getReader();
  if (!response.ok || !reader || Number(response.headers.get("content-length") ?? 0) > PICTURE_MAX_BYTES) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > PICTURE_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
