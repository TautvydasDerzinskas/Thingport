import { parseMakerworldModelUrl } from "../providers/makerworld/api";
import {
  downloadImportToTemp,
  downloadPlainFileToTemp,
  downloadSignedFile,
  extensionProfile,
  modelFilesFromZip,
  MULTI_FILE_PLATE_EXTS,
  openImportResponse,
  saveImportResponseToTemp,
} from "./importFiles";
export {
  downloadImportToTemp,
  downloadPlainFileToTemp,
  MULTI_FILE_PLATE_EXTS,
  openImportResponse,
} from "./importFiles";
export type { OpenImportResult, PlainDownloadResult } from "./importFiles";
import fs from "node:fs/promises";
import { isProviderId, MANIFESTS, manifestOf, modelUrl, parseModelUrl } from "../providers/index.generated";
import { PROFILE_PROVIDERS, PROVIDERS } from "../providers/registry";
import type { PipelineKit, ResolvedModel, SourcedImport } from "../providers/types";
import fsSync from "node:fs";
import path from "node:path";
import { IMPORT_BROWSER_USER_AGENT, IMPORT_PREVIEW_IMAGE_DELAY_MS } from "../config";
import { HttpError, buildImportFilename, mimeFromContentType, sanitizeFilename } from "../utils/fileUtils";
import { rawFetch } from "./guardedFetch";
import { sleep } from "../utils/concurrency";
import { type ImportCookies, type ImportedPageMetadata } from "./importResolvers";
import { type MakerworldProfileRef } from "../providers/makerworld/pageData";
import { openSourceGaps, type SourceGap } from "./sourceGaps";

/** An import refused because the user's MyMiniFactory session has expired. */
export const MYMINIFACTORY_SESSION_CODE = MANIFESTS.myminifactory.errorCodes.session;
/** An import refused because the user hasn't connected Snapmaker, or their sign-in has run out. */
export const SNAPMAKER_SESSION_CODE = MANIFESTS.snapmaker.errorCodes.session;
/** An import refused because the user hasn't connected Creality Cloud, or it turned their sign-in down. */
export const CREALITYCLOUD_SESSION_CODE = MANIFESTS.crealitycloud.errorCodes.session;
/** An import refused because the user hasn't connected NexPrint, or it turned their sign-in down. */
export const NEXPRINT_SESSION_CODE = MANIFESTS.nexprint.errorCodes.session;
/** An import refused because the user hasn't connected Thangs, or it turned their sign-in down. */
export const THANGS_SESSION_CODE = MANIFESTS.thangs.errorCodes.session;
/** A Thangs import refused because the account's daily downloads are used up. */
export const THANGS_DOWNLOAD_LIMIT_CODE = MANIFESTS.thangs.errorCodes.downloadLimit;
/** A Cults3D import refused for want of the user's API key, or of the browser's sign-in, or because one was turned
 *  down. */
export const CULTS3D_SESSION_CODE = MANIFESTS.cults3d.errorCodes.session;
import { enqueueAiDescription } from "./aiDescriptionService";
import { upsertAuthorFromImport } from "./authorService";
import {
  addPlatesToPrint,
  createPrint,
  refreshAutoPreparedMetadata,
  resolvePlateFilePath,
  type NewPlateInput,
  type PrintMetaInput,
} from "./printCreation";
import { availablePlateFilename, relocatePrint, saveThumbFromBytes } from "./printService";
import { addPreviewImage, preferImageOverRenders } from "./previewImageService";
import { localizeDescriptionImages } from "./descriptionImageService";
import { plainWriteMode, sha256OfFile } from "./fileReuse";
import { DROP } from "./storedContent";
import { prisma } from "../db";
import { recordActivity } from "./activityService";
import { Prisma } from "@prisma/client";
import type { Author, Plate, PreviewImage, Print } from "@prisma/client";
import { assertUrlProviderEnabled } from "./providerSettingsService";

/** createPrint's options for an import, which checks the description itself once it's complete: importPrintFromUrl. */
const IMPORTED = { describe: false };

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export type ImportRequestBody = ImportCookies & {
  url: string;
  title?: string | null;
  notes?: string | null;
  tags?: string[];
  category_id?: string | null;
  filename?: string | null;
  /** Download URL the Thingport Grab extension already resolved in the page; skips server-side
   *  resolution. */
  resolved_download_url?: string | null;
  /** The MakerWorld profile resolved_download_url downloads, when known. */
  resolved_instance_id?: string | null;
  /** MakerOnline's files, their links signed by Thingport Grab on a makeronline.com page; `profile_id` tags a print
   *  profile's 3MF. */
  resolved_files?: { url: string; name: string; profile_id?: string | null }[] | null;
  /** The page's MakerWorld design data, so the backend needn't fetch a Cloudflare-gated page.
   *  Client-supplied -- see makerworldMetaFromExtension in importFiles.ts. */
  makerworld_design?: Record<string, unknown> | null;
  /** Internal only: per-request delay for MakerWorld collection imports. Never from the body. */
  makerworldPaceMs?: number;
};

/** What tells a model's print profiles apart, by profile id: their names, for files that come named alike, and their
 *  own pictures, for their files' thumbnails. */
export type ProfileDetails = { titles?: Record<string, string>; covers?: Record<string, string> };

/** `names: false` for a provider whose profile files are already named after their profiles. */
function profileDetailsOf(
  profiles: { id: string; title: string; coverUrl?: string | null }[],
  { names = true } = {},
): ProfileDetails {
  return {
    titles: names ? Object.fromEntries(profiles.map((p) => [p.id, p.title])) : undefined,
    covers: Object.fromEntries(profiles.flatMap((p) => (p.coverUrl ? [[p.id, p.coverUrl]] : []))),
  };
}

function makerworldProfileDetails(profile: MakerworldProfileRef | null | undefined): ProfileDetails {
  const { instanceId, coverUrl, titles } = profile ?? {};
  return { titles, covers: instanceId && coverUrl ? { [instanceId]: coverUrl } : undefined };
}

/** A profile's file named after the profile: "Phoenix - Multi-colour.3mf". */
function profileFilename(filename: string, profileTitle: string): string {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  // A title that already holds the file's name ("vase_2_1plates" for "vase_2") says it all on its own.
  return sanitizeFilename(
    looseName(profileTitle).includes(looseName(stem)) ? `${profileTitle}${ext}` : `${stem} - ${profileTitle}${ext}`,
  );
}

/** For comparing names: case, spaces, dashes and underscores aside. */
function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/** Sites often give every profile's file the same name, so the files on a model can't be told apart. A new profile
 *  whose file shares an earlier profile's name is named after its profile instead; so is each earlier one it clashes
 *  with, which is renamed (and moved on disk) once the new one is in. */
function profilePlateNaming(
  plates: Plate[],
  filename: string,
  instanceId: string,
  titles: Record<string, string> | undefined,
): { filename: string; renames: { plate: Plate; filename: string }[] } {
  const title = titles?.[instanceId];
  if (!title) return { filename, renames: [] };
  const name = sanitizeFilename(filename).toLowerCase();
  const ext = path.extname(name);
  // Earlier profiles of the file that were already named apart count as the same name.
  const namedApart = `${path.basename(name, ext)} - `;
  const clashing = plates.filter((plate) => {
    const other = plate.filename.toLowerCase();
    return other === name || (plate.sourceInstanceId != null && other.startsWith(namedApart) && other.endsWith(ext));
  });
  if (!clashing.length) return { filename, renames: [] };
  // Profiles named alike can't be told apart by their names either: the site's own name, suffixed, will do.
  const sameTitle = clashing.some((plate) => {
    const otherTitle = plate.sourceInstanceId ? titles?.[plate.sourceInstanceId] : undefined;
    return otherTitle !== undefined && looseName(otherTitle) === looseName(title);
  });
  if (sameTitle) return { filename, renames: [] };
  const renames = clashing.flatMap((plate) => {
    const otherTitle = plate.sourceInstanceId ? titles?.[plate.sourceInstanceId] : undefined;
    return otherTitle && plate.filename.toLowerCase() === name
      ? [{ plate, filename: profileFilename(filename, otherTitle) }]
      : [];
  });
  return { filename: profileFilename(filename, title), renames };
}

/** The same for profiles that come in together, before any is on the model. */
function nameInputsApart(inputs: NewPlateInput[], titles: Record<string, string> | undefined): NewPlateInput[] {
  if (!titles) return inputs;
  const titleOf = (input: NewPlateInput) => (input.sourceInstanceId ? titles[input.sourceInstanceId] : undefined);
  const key = (input: NewPlateInput) => sanitizeFilename(input.filename).toLowerCase();
  // Per file name, how many profiles have it, and how many of those share each title.
  const counts = new Map<string, number>();
  for (const input of inputs) {
    if (!input.sourceInstanceId) continue;
    counts.set(key(input), (counts.get(key(input)) ?? 0) + 1);
    const title = titleOf(input);
    if (title)
      counts.set(`${key(input)}\0${looseName(title)}`, (counts.get(`${key(input)}\0${looseName(title)}`) ?? 0) + 1);
  }
  return inputs.map((input) => {
    const title = titleOf(input);
    // Only a title that tells this one apart from the others with its name.
    const apart = title && (counts.get(`${key(input)}\0${looseName(title)}`) ?? 0) === 1;
    return apart && (counts.get(key(input)) ?? 0) > 1
      ? { ...input, filename: profileFilename(input.filename, title) }
      : input;
  });
}

async function renameProfilePlates(printId: string, renames: { plate: Plate; filename: string }[]): Promise<void> {
  if (!renames.length) return;
  const print = await prisma.print.findUnique({ where: { id: printId } });
  if (!print) return;
  for (const { plate, filename } of renames) {
    const next = await availablePlateFilename(printId, filename, plate.id);
    await prisma.plate.update({ where: { id: plate.id }, data: { filename: next } });
    await relocatePrint(print, [{ ...plate, filename: next }]);
    if (plate.position === 0) await refreshAutoPreparedMetadata(printId);
  }
}

/** Puts each profile's own picture on its plate, in place of the 3MF's embedded thumbnail: designers often ship every
 *  profile with the same one, so the profiles would all look alike. Only `instanceIds` when given. Best-effort; never
 *  throws. */
async function applyProfileCovers(
  printId: string,
  covers: Record<string, string> | undefined,
  instanceIds?: string[],
): Promise<void> {
  const wanted = Object.keys(covers ?? {}).filter((id) => !instanceIds || instanceIds.includes(id));
  if (!covers || !wanted.length) return;
  try {
    const plates = await prisma.plate.findMany({
      where: { printId, sourceInstanceId: { in: wanted } },
      select: { id: true, sourceInstanceId: true },
    });
    for (const plate of plates) {
      const buf = await fetchImageBytes(covers[plate.sourceInstanceId!]);
      if (buf) await saveThumbFromBytes(plate.id, buf);
    }
  } catch {
    // The embedded thumbnails stay.
  }
}

/** addProfilePlate, with the new profile told apart from the others by its name and picture. */
async function addProfilePlateWithDetails(
  existing: ExistingImportedPrint,
  file: NewPlateInput,
  instanceId: string,
  details: ProfileDetails,
): Promise<ExistingImportedPrint & { alreadyImported: boolean; profileAdded?: boolean }> {
  const naming = profilePlateNaming(existing.plates, file.filename, instanceId, details.titles);
  // The earlier profiles first, so the new file is placed under its own name once and never moved while its preview
  // renders. Only profiles' own plates are renamed, so the content match addProfilePlate makes on untagged ones holds.
  // Best-effort: a failed move leaves the file where its plate says it is, and the profile comes in either way.
  await renameProfilePlates(existing.print.id, naming.renames).catch(() => undefined);
  const result = await addProfilePlate(existing, { ...file, filename: naming.filename }, instanceId);
  if (!result.profileAdded) return result;
  await applyProfileCovers(existing.print.id, details.covers, [instanceId]);
  return { ...result, plates: await platesOf(existing.print.id) };
}

/** Inspects a link without downloading the file body: returns the filename/mime/is_zip/title it
 * would resolve to. */
export async function inspectImportLink(
  url: string,
  body: ImportRequestBody,
): Promise<{ filename: string; mime: string; is_zip: boolean; title: string | null }> {
  const { response, finalUrl, meta } = await openImportResponse(url, body);
  await response.body?.cancel().catch(() => undefined);
  const filename = buildImportFilename(finalUrl, response.headers, body.filename ?? meta.filename);
  const mime = mimeFromContentType(response.headers.get("content-type"), filename);
  const isZip = path.extname(filename).toLowerCase() === ".zip";
  return { filename, mime, is_zip: isZip, title: meta.title };
}

const PREVIEW_IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const PREVIEW_IMAGE_MAX_COUNT = 20;

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await rawFetch(url, { "User-Agent": IMPORT_BROWSER_USER_AGENT, Accept: "image/*" });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > PREVIEW_IMAGE_MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > PREVIEW_IMAGE_MAX_BYTES ? null : buf;
  } catch {
    return null;
  }
}

/** Best-effort: stores the page's cover (at position 0) and gallery as preview images, and seeds
 * the plate thumbnail from the cover when nothing better exists. A 3D render the app made while
 * the import ran (the model is browsable from creation) gives way to them. Never throws. */
export async function attachImportedPreviewImages(
  printId: string | undefined,
  plateId: string | undefined,
  coverImageUrl: string | null | undefined,
  galleryImages: { url: string; filename: string }[],
  paceMs?: number,
): Promise<void> {
  if (!printId) return;
  const seen = new Set<string>();
  const orderedUrls: string[] = [];
  if (coverImageUrl) {
    orderedUrls.push(coverImageUrl);
    seen.add(coverImageUrl);
  }
  for (const image of galleryImages) {
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    orderedUrls.push(image.url);
  }

  let firstAdded = false;
  const urls = orderedUrls.slice(0, PREVIEW_IMAGE_MAX_COUNT);
  const delayMs = paceMs ?? IMPORT_PREVIEW_IMAGE_DELAY_MS;
  for (let i = 0; i < urls.length; i++) {
    await sleep(delayMs);
    const buf = await fetchImageBytes(urls[i]);
    if (!buf) continue;
    const added = await addPreviewImage(printId, buf);
    if (added && !firstAdded) {
      firstAdded = true;
      await preferImageOverRenders(printId, plateId, buf);
    }
  }
}

/** Auto-categorizes an import when a category's ids for this site (CategorySiteId) overlap the model's own category
 * ids. Those come most specific first (a model's own category, then its parent), and the category matching the
 * earliest one wins, so a subcategory beats the category its parent maps to. Best-effort. */
export async function resolveCategoryIdByCategory(
  userId: string,
  categorySite: ImportedPageMetadata["categorySite"],
  siteCategoryIds: (number | string)[],
): Promise<string | null> {
  if (!categorySite || !siteCategoryIds.length) return null;
  const wanted = siteCategoryIds.map(String);
  const candidates = await prisma.category.findMany({
    // Folders are the user's own tree; only categories take imports by site category id.
    where: { userId, kind: "category", siteIds: { some: { provider: categorySite, siteId: { in: wanted } } } },
    orderBy: { position: "asc" },
    select: { id: true, siteIds: { where: { provider: categorySite }, select: { siteId: true } } },
  });
  const rank = (category: (typeof candidates)[number]) => {
    const ids = new Set(category.siteIds.map((row) => row.siteId));
    const index = wanted.findIndex((id) => ids.has(id));
    return index === -1 ? wanted.length : index;
  };
  // Stable, so equally specific matches keep their position order.
  return candidates.toSorted((a, b) => rank(a) - rank(b))[0]?.id ?? null;
}

/** Provider + stable external id for a model URL, used to dedupe imports. Null if unknown. */
export function identifySourceModel(url: string): { provider: string; externalId: string } | null {
  const model = parseModelUrl(url);
  return model && { provider: model.provider, externalId: model.externalId };
}

/** The print profile a MakerWorld, Snapmaker, MakerOnline, Creality Cloud or NexPrint link names, if any. */
function requestedProfileOf(provider: string, url: string): string | null {
  const model = parseModelUrl(url);
  return model?.provider === provider ? model.requestedProfileId : null;
}

/** `state` refines already_imported for a MakerWorld URL naming a profile: "profile_missing"
 *  when every plate is a different profile, "profile_unknown" when some plates predate profile
 *  tracking. already_imported stays for older extension versions. `gaps` is what "Fetch
 *  missing details" could fill on the library's model. */
export type ImportStatus = {
  recognized: boolean;
  already_imported: boolean;
  print_id: string | null;
  state: "not_imported" | "imported" | "profile_missing" | "profile_unknown";
  gaps: SourceGap[];
};

/** Never fetches the provider's page, so it's cheap enough for the extension to call on every
 * page load. */
export async function checkImportStatus(userId: string, url: string): Promise<ImportStatus> {
  const source = identifySourceModel(url);
  if (!source) return { recognized: false, already_imported: false, print_id: null, state: "not_imported", gaps: [] };
  const include = {
    plates: { select: { sourceInstanceId: true } },
    previewImages: { select: { generated: true } },
  } as const;
  let print = await prisma.print.findFirst({
    where: { userId, sourceProvider: source.provider, sourceExternalId: source.externalId },
    include,
  });
  // An import may keep a model under another id than its link names it by.
  const keptId = isProviderId(source.provider) ? PROVIDERS[source.provider].keptId : undefined;
  if (!print && keptId) {
    const alias = await keptId(source.externalId);
    if (alias !== source.externalId) {
      print = await prisma.print.findFirst({
        where: { userId, sourceProvider: source.provider, sourceExternalId: alias },
        include,
      });
    }
  }
  if (!print) return { recognized: true, already_imported: false, print_id: null, state: "not_imported", gaps: [] };
  const gaps = openSourceGaps(print, print.previewImages);
  // Without a profile in the URL, any imported profile counts; asking MakerWorld on every page
  // view isn't worth it.
  const requestedInstanceId = requestedProfileOf(source.provider, url);
  if (requestedInstanceId && !print.plates.some((plate) => plate.sourceInstanceId === requestedInstanceId)) {
    const state = print.plates.some((plate) => plate.sourceInstanceId == null) ? "profile_unknown" : "profile_missing";
    return { recognized: true, already_imported: false, print_id: print.id, state, gaps };
  }
  return { recognized: true, already_imported: true, print_id: print.id, state: "imported", gaps };
}

/** Inverse of identifySourceModel, for the "Open in {Provider}" link. */
export function buildImportSourceUrl(provider: string | null, externalId: string | null): string | null {
  return provider && externalId ? modelUrl(provider, externalId) : null;
}

async function findExistingImportedPrint(
  userId: string,
  source: { provider: string; externalId: string },
): Promise<{ print: Print; plates: Plate[]; author: Author | null; previewImages: PreviewImage[] } | null> {
  const print = await prisma.print.findFirst({
    where: { userId, sourceProvider: source.provider, sourceExternalId: source.externalId },
    include: { author: true },
  });
  if (!print) return null;
  const [plates, previewImages] = await Promise.all([
    prisma.plate.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } }),
    prisma.previewImage.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } }),
  ]);
  return { print, plates, author: print.author, previewImages };
}

export type ExistingImportedPrint = NonNullable<Awaited<ReturnType<typeof findExistingImportedPrint>>>;

/** Size of the plate's file on disk now, or null when it can't be found. */
async function plateFileSize(plate: Plate): Promise<number | null> {
  const filePath = resolvePlateFilePath(plate);
  if (!filePath) return null;
  return fs.stat(filePath).then(
    (stat) => stat.size,
    () => null,
  );
}

/** SHA-256 of the plate's file as it is on disk now, or null when the file is missing. Always read, never taken from
 *  the hash on record: the storage folder may be mounted and the file edited outside Thingport since it was hashed.
 *  The record is brought up to date when it differs, unless something else changed it meanwhile. */
export async function plateContentSha256(plate: Plate): Promise<string | null> {
  const filePath = resolvePlateFilePath(plate);
  if (!filePath) return null;
  let sha: string;
  try {
    sha = await sha256OfFile(filePath);
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  if (sha !== plate.contentSha256)
    await prisma.plate.updateMany({
      where: { id: plate.id, contentSha256: plate.contentSha256 },
      data: { ...DROP, contentSha256: sha },
    });
  return sha;
}

/** Re-import of a MakerWorld design: each profile's 3MF has its own settings, so a new profile is
 * added as another plate. Untagged plates are compared by SHA-256 first so a match is tagged
 * instead of duplicated. */
async function addMakerworldProfileToPrint(
  existing: ExistingImportedPrint,
  url: string,
  body: ImportRequestBody,
): Promise<ExistingImportedPrint & { alreadyImported: boolean; profileAdded?: boolean }> {
  const alreadyImported = { ...existing, alreadyImported: true };
  const hasProfile = (instanceId: string) => existing.plates.some((plate) => plate.sourceInstanceId === instanceId);

  // Checked before any MakerWorld request: resolving the default profile would cost one
  // CAPTCHA-prone lookup per design on a collection re-import.
  const wanted = body.resolved_instance_id ?? parseMakerworldModelUrl(url)?.requestedInstanceId ?? null;
  if (!wanted || hasProfile(wanted)) return alreadyImported;

  // Fetch the extension-resolved download as is: another page request per profile risks the CAPTCHA.
  const presolved = Boolean(body.resolved_download_url && body.resolved_instance_id);
  const opened = presolved
    ? await openImportResponse(body.resolved_download_url!, { ...body, resolved_download_url: null }, url)
    : await openImportResponse(url, body);
  // The presolved download is fetched bare, so its profile's details come from the design the extension sent.
  const profile = presolved ? extensionProfile(url, body) : opened.meta.makerworldProfile;
  const instanceId = profile?.instanceId ?? null;
  // Unknown profile, or the resolver fell back to one already on the print.
  if (!instanceId || hasProfile(instanceId)) {
    await opened.response.body?.cancel().catch(() => undefined);
    return alreadyImported;
  }

  const { tempPath, filename, mime } = await saveImportResponseToTemp(opened, body);
  return addProfilePlateWithDetails(
    existing,
    { filename, mime, tempFilePath: tempPath },
    instanceId,
    makerworldProfileDetails(profile),
  );
}

/** Adds a downloaded profile's file to an imported print as another plate, or, when an untagged plate has the same
 *  content, tags that one with the profile instead. Removes the temp file either way. */
async function addProfilePlate(
  existing: ExistingImportedPrint,
  file: NewPlateInput,
  instanceId: string,
): Promise<ExistingImportedPrint & { alreadyImported: boolean; profileAdded?: boolean }> {
  const alreadyImported = { ...existing, alreadyImported: true };
  const tempPath = file.tempFilePath!;
  try {
    const untagged = existing.plates.filter((plate) => plate.sourceInstanceId == null);
    if (untagged.length) {
      const downloadedSha = await sha256OfFile(tempPath);
      const downloadedSize = (await fs.stat(tempPath)).size;
      for (const plate of untagged) {
        // Cheap first: a file of another size can't match, so it isn't read (and hashed on record) for nothing.
        if ((await plateFileSize(plate)) !== downloadedSize) continue;
        if ((await plateContentSha256(plate)) !== downloadedSha) continue;
        try {
          await prisma.plate.update({ where: { id: plate.id }, data: { sourceInstanceId: instanceId } });
        } catch (err) {
          // Race guard: a concurrent import of this same profile won.
          if (!isUniqueConstraintError(err)) throw err;
        }
        return { ...alreadyImported, plates: await platesOf(existing.print.id) };
      }
    }

    try {
      await addPlatesToPrint(existing.print.userId, existing.print.id, [{ ...file, sourceInstanceId: instanceId }]);
    } catch (err) {
      // Race guard: a concurrent import of this same profile won.
      if (isUniqueConstraintError(err)) return alreadyImported;
      throw err;
    }
    return { ...existing, plates: await platesOf(existing.print.id), alreadyImported: false, profileAdded: true };
  } finally {
    if (fsSync.existsSync(tempPath)) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function platesOf(printId: string): Promise<Plate[]> {
  return prisma.plate.findMany({ where: { printId }, orderBy: { position: "asc" } });
}

/** Bulk version of the dedup lookup, for flagging already-imported entries in a listing. */
export async function findImportedExternalIds(
  userId: string,
  provider: string,
  externalIds: string[],
): Promise<Set<string>> {
  if (!externalIds.length) return new Set();
  const prints = await prisma.print.findMany({
    where: { userId, sourceProvider: provider, sourceExternalId: { in: externalIds } },
    select: { sourceExternalId: true },
  });
  return new Set(prints.map((p) => p.sourceExternalId).filter((id): id is string => id !== null));
}

/** A new print from a provider model whose files are downloaded: its metadata, author, category and gallery. Removes
 *  the temp files either way. */
async function createSourcedPrint(
  userId: string,
  source: { provider: string; externalId: string },
  body: ImportRequestBody,
  resolved: { meta: Partial<ImportedPageMetadata>; galleryImages: { url: string; filename: string }[] },
  downloaded: NewPlateInput[],
  nameHint: string,
  profiles: ProfileDetails = {},
): Promise<ImportResult> {
  const { meta, galleryImages } = resolved;
  try {
    const author = await upsertAuthorFromImport(meta.author ?? null);
    const categoryId =
      body.category_id ??
      (await resolveCategoryIdByCategory(userId, meta.categorySite ?? null, meta.siteCategoryIds ?? []));
    const printMeta: PrintMetaInput = {
      title: body.title ?? meta.title ?? null,
      notes: body.notes ?? meta.description ?? null,
      tags: body.tags && body.tags.length ? body.tags : (meta.tags ?? []),
      categoryId,
      categorySource: body.category_id ? "MANUAL" : categoryId ? "RULE" : null,
      creator: meta.creator ?? null,
      authorId: author?.id ?? null,
      sourceProvider: source.provider,
      sourceExternalId: source.externalId,
    };
    let created: { print: Print; plates: Plate[] };
    try {
      created = await createPrint(
        userId,
        printMeta,
        meta.title || nameHint,
        nameInputsApart(downloaded, profiles.titles),
        IMPORTED,
      );
    } catch (err) {
      // Race guard: a concurrent import of the same source model won.
      if (isUniqueConstraintError(err)) {
        const existing = await findExistingImportedPrint(userId, source);
        if (existing) return { ...existing, alreadyImported: true };
      }
      throw err;
    }
    await attachImportedPreviewImages(
      created.print.id,
      created.plates[0]?.id,
      meta.previewImageUrl ?? null,
      galleryImages,
    );
    await applyProfileCovers(created.print.id, profiles.covers);
    await localizeDescriptionImages(created.print.id);
    const previewImages = await prisma.previewImage.findMany({
      where: { printId: created.print.id },
      orderBy: { position: "asc" },
    });
    return { ...created, author, previewImages, alreadyImported: false };
  } finally {
    for (const input of downloaded) {
      if (input.tempFilePath && fsSync.existsSync(input.tempFilePath)) {
        await fs.rm(input.tempFilePath, { force: true }).catch(() => undefined);
      }
    }
  }
}

const IMPORT_KIT: PipelineKit = {
  downloadSignedFile,
  downloadFile: downloadPlainFileToTemp,
  isModelFile: (name) => MULTI_FILE_PLATE_EXTS.has(path.extname(name).toLowerCase()),
  createPrint: (userId, source, body, resolved, downloaded, details) =>
    createSourcedPrint(userId, source, body, resolved, downloaded, `${source.provider}-${source.externalId}`, details),
  async addProfiles(existing, inputs, details) {
    let current: ExistingImportedPrint = existing;
    let profileAdded = false;
    try {
      for (const input of inputs) {
        const result = await addProfilePlateWithDetails(current, input, input.sourceInstanceId!, details);
        profileAdded ||= Boolean(result.profileAdded);
        current = result;
      }
    } finally {
      for (const input of inputs) {
        if (input.tempFilePath && fsSync.existsSync(input.tempFilePath)) {
          await fs.rm(input.tempFilePath, { force: true }).catch(() => undefined);
        }
      }
    }
    return profileAdded ? { ...current, alreadyImported: false, profileAdded } : { ...current, alreadyImported: true };
  },
  profileDetails: profileDetailsOf,
};

/** A new print from a provider on the shared pipeline: its sign-in, the model, the profile the link names (or the
 *  provider's pick) or else the model's files, then the print. A model kept under another id than its link's goes
 *  onto the print already there under that one. */
async function importSourced(
  userId: string,
  linked: { provider: string; externalId: string },
  url: string,
  body: ImportRequestBody,
  impl: SourcedImport,
): Promise<ImportResult> {
  const auth = await impl.requireAuth(userId);
  let resolved: ResolvedModel | null;
  try {
    resolved = await impl.resolveModel(linked.externalId, auth);
  } catch (err) {
    throw await impl.mapError(userId, err);
  }
  if (!resolved) throw new HttpError(404, impl.missingMessage);
  const source = { provider: linked.provider, externalId: impl.canonicalId?.(resolved) ?? linked.externalId };
  if (source.externalId !== linked.externalId) {
    const existing = await findExistingImportedPrint(userId, source);
    if (existing) return addSourcedProfile(existing, url, body, impl, resolved);
  }
  const requested = body.resolved_instance_id ?? requestedProfileOf(source.provider, url);
  let downloaded: NewPlateInput[];
  try {
    downloaded = await impl.downloadModel(
      { userId, externalId: source.externalId },
      resolved,
      auth,
      requested,
      IMPORT_KIT,
    );
  } catch (err) {
    throw await impl.mapError(userId, err);
  }
  if (!downloaded.length) throw new HttpError(400, impl.noFilesMessage);
  return createSourcedPrint(
    userId,
    source,
    body,
    resolved,
    downloaded,
    impl.nameHint?.(source.externalId) ?? `${source.provider}-${source.externalId}`,
    profileDetailsOf(resolved.profiles ?? [], { names: impl.profiles?.namedAlike ?? true }),
  );
}

/** Re-import of a model naming a profile it doesn't have yet: that profile's file becomes another plate. A link
 *  without a profile, or with one already there, or from a provider without profiles, needs no download. */
async function addSourcedProfile(
  existing: ExistingImportedPrint,
  url: string,
  body: ImportRequestBody,
  impl: SourcedImport,
  resolved: ResolvedModel | null = null,
): Promise<ImportResult> {
  const wanted = body.resolved_instance_id ?? requestedProfileOf(existing.print.sourceProvider!, url);
  const profiles = impl.profiles;
  if (!profiles || !wanted || existing.plates.some((plate) => plate.sourceInstanceId === wanted)) {
    return { ...existing, alreadyImported: true };
  }
  const userId = existing.print.userId;
  const externalId = existing.print.sourceExternalId!;
  const auth = await impl.requireAuth(userId);
  let profile: NewPlateInput | null;
  let model: ResolvedModel | null = resolved;
  try {
    if (!profiles.downloadsWithoutModel) {
      model ??= await impl.resolveModel(externalId, auth);
      if (!model) throw new HttpError(404, impl.missingMessage);
    }
    profile = await profiles.download({ userId, externalId }, model, wanted, auth, IMPORT_KIT);
  } catch (err) {
    throw await impl.mapError(userId, err);
  }
  if (!profile) throw new HttpError(404, profiles.missingMessage);
  // Without its details the profile still comes in, only not named or pictured apart.
  model ??= await impl.resolveModel(externalId, auth).catch(() => null);
  const details = model ? profileDetailsOf(model.profiles ?? [], { names: profiles.namedAlike }) : {};
  return addProfilePlateWithDetails(existing, profile, wanted, details);
}

export type ImportResult = {
  print: Print;
  plates: Plate[];
  author: Author | null;
  previewImages: PreviewImage[];
  alreadyImported: boolean;
  /** Set when an existing MakerWorld or Snapmaker print gained another profile's file. */
  profileAdded?: boolean;
};

/** Returns the existing print with `alreadyImported: true` instead of re-downloading a model
 * this user already imported. Every import path comes through here, so each new model is recorded
 * as one activity, whether it came alone or in a job. `keepGrabImports`: the caller clears what
 * waits for Grab itself, once it's done with it. */
export async function importPrintFromUrl(
  userId: string,
  url: string,
  body: ImportRequestBody,
  { keepGrabImports = false } = {},
): Promise<ImportResult> {
  const result = await importNewOrExisting(userId, url, body);
  // However it came in, nothing need wait for Grab to bring it.
  const provider = result.print.sourceProvider;
  const grabQueue = isProviderId(provider) ? PROVIDERS[provider].grabQueue : undefined;
  if (!keepGrabImports && grabQueue && result.print.sourceExternalId) {
    await grabQueue.clear(userId, result.print.sourceExternalId).catch(() => undefined);
  }
  if (!result.alreadyImported && !result.profileAdded) {
    void recordActivity(userId, "import", result.print.id, result.print.name);
    // Only now: the pictures it may write from are attached, and its description's images stored locally.
    enqueueAiDescription(userId, result.print.id);
  }
  return result;
}

/** Refuses a link from a provider an admin turned off, unless it's a model the user already has (MakerWorld, Snapmaker,
 *  MakerOnline, Creality Cloud and NexPrint add a profile, so fetch). */
export async function assertCanImportUrl(userId: string, url: string): Promise<void> {
  const source = identifySourceModel(url);
  if (source && !PROFILE_PROVIDERS.has(source.provider) && (await findExistingImportedPrint(userId, source))) return;
  await assertUrlProviderEnabled(url);
}

async function importNewOrExisting(userId: string, url: string, body: ImportRequestBody): Promise<ImportResult> {
  const source = identifySourceModel(url);
  const existing = source ? await findExistingImportedPrint(userId, source) : null;
  // A model already in the library is still reported as such; anything that fetches from the provider is refused,
  // also for imports queued, or started by Grab, before it was turned off.
  if (existing && !PROFILE_PROVIDERS.has(source!.provider)) return { ...existing, alreadyImported: true };
  await assertUrlProviderEnabled(url);
  const sourced = source && isProviderId(source.provider) ? PROVIDERS[source.provider].sourcedImport : undefined;
  if (existing && sourced) return addSourcedProfile(existing, url, body, sourced);
  if (sourced) return importSourced(userId, source!, url, body, sourced);
  const custom = source && isProviderId(source.provider) ? PROVIDERS[source.provider].customImport : undefined;
  if (existing && custom) return custom.addToExisting(existing, body, IMPORT_KIT);
  if (custom) return custom.importModel(userId, source!, body, IMPORT_KIT);
  // MakerWorld still imports here: its pages are what the link import below reads.
  if (existing) return addMakerworldProfileToPrint(existing, url, body);
  return importLinkedFile(userId, url, source, body);
}

/** A link to a page or a file, imported as what it downloads to: a MakerWorld model page (its 3MF, or a zip of its
 *  model files), or any other site's file. */
async function importLinkedFile(
  userId: string,
  url: string,
  source: { provider: string; externalId: string } | null,
  body: ImportRequestBody,
): Promise<ImportResult> {
  const { tempPath, filename, mime, meta } = await downloadImportToTemp(url, body);
  let plates: NewPlateInput[] = [];
  try {
    plates = await rawFilesZipPlates(source, tempPath, filename);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw err;
  }
  if (!plates.length) {
    plates = [
      {
        filename,
        mime,
        tempFilePath: tempPath,
        storageMode: plainWriteMode(),
        sourceInstanceId: meta.makerworldProfile?.instanceId ?? null,
      },
    ];
  }
  const author = await upsertAuthorFromImport(meta.author);
  const categoryId =
    body.category_id ?? (await resolveCategoryIdByCategory(userId, meta.categorySite, meta.siteCategoryIds));
  const printMeta: PrintMetaInput = {
    title: body.title ?? meta.title ?? null,
    notes: body.notes ?? meta.description ?? null,
    tags: body.tags && body.tags.length ? body.tags : meta.tags,
    categoryId,
    categorySource: body.category_id ? "MANUAL" : categoryId ? "RULE" : null,
    creator: meta.creator ?? null,
    authorId: author?.id ?? null,
    sourceProvider: source?.provider ?? null,
    sourceExternalId: source?.externalId ?? null,
  };

  try {
    let result: { print: Print; plates: Plate[] };
    try {
      result = await createPrint(userId, printMeta, path.parse(filename).name, plates, IMPORTED);
    } catch (err) {
      // Race guard: a concurrent import of the same source model won.
      if (source && isUniqueConstraintError(err)) {
        const winner = await findExistingImportedPrint(userId, source);
        if (winner) return { ...winner, alreadyImported: true };
      }
      throw err;
    }
    await attachImportedPreviewImages(
      result.print.id,
      result.plates[0]?.id,
      meta.previewImageUrl,
      meta.galleryImages,
      body.makerworldPaceMs,
    );
    await applyProfileCovers(result.print.id, makerworldProfileDetails(meta.makerworldProfile).covers);
    await localizeDescriptionImages(result.print.id);
    const previewImages = await prisma.previewImage.findMany({
      where: { printId: result.print.id },
      orderBy: { position: "asc" },
    });
    return { ...result, author, previewImages, alreadyImported: false };
  } finally {
    for (const file of [tempPath, ...plates.map((plate) => plate.tempFilePath)]) {
      if (file && fsSync.existsSync(file)) await fs.rm(file, { force: true }).catch(() => undefined);
    }
  }
}

/** A zip of a model's raw files, from a provider whose links download them so (MakerWorld's, for a model with no print
 *  profiles), as its model files, one plate each, the zip itself removed. Empty for anything else, or a zip with no
 *  model file in it, which is kept as it came. */
async function rawFilesZipPlates(
  source: { provider: string } | null,
  tempPath: string,
  filename: string,
): Promise<NewPlateInput[]> {
  const zipOfFiles = source && isProviderId(source.provider) && manifestOf(source.provider).capabilities.rawFilesZip;
  if (!zipOfFiles || path.extname(filename).toLowerCase() !== ".zip") return [];
  const plates = await modelFilesFromZip(tempPath);
  if (plates.length) await fs.rm(tempPath, { force: true }).catch(() => undefined);
  return plates;
}
