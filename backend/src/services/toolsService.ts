// Tools: small apps that open in a window from the Tools page. An admin installs one from the repository's tools
// folder for the whole instance, as dashboard widgets come from the community-widgets folder; a user may make their
// own when an admin allows it. A tool's script runs in its user's page with their access, like a widget's, so a
// repository tool is kept exactly as installed until an admin takes its update.
//
// A repository tool may bring models it needs (a planner's parts): its own files, or model pages Thingport imports
// from, fetched once when it's installed, as the admin installing it, into the instance's tools folder. Every user who
// can use tools gets a copy of each in a collection of its own, "Tool: <name>", that they can open, search, download
// and print but not edit or delete: it goes, with its models, when the admin uninstalls the tool.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { Prisma, Role, Tool } from "@prisma/client";
import { z } from "zod";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { HttpError, sanitizeFilename } from "../utils/fileUtils";
import { importQuietly } from "../utils/quietImport";
import { readCapped } from "../utils/readCapped";
import { TtlCache } from "../utils/ttlCache";
import { createLog } from "./auditLog";
import { addPrintsToCollection, normalizeCollectionName } from "./collectionService";
import { declaredHostFetch, widgetFetchSchema } from "./customWidgetsService";
import { importPrintFromUrl } from "./importService";
import { printAssetHome } from "./modelAssets";
import { createPrint, resolvePlateFilePath } from "./printCreation";
import { deletePrint } from "./printEditService";
import { previewImagePath } from "./previewImageService";
import { getToolsAccess } from "./settingsService";
import { prepareSingleImport } from "./singleImport";
import {
  parseToolManifest,
  SLUG,
  TOOL_FILE_MAX_BYTES,
  TOOL_FILES_MAX_BYTES,
  TOOL_LOCALE_MAX_BYTES,
  TOOL_LOCALES_MAX_BYTES,
  TOOL_SCREENSHOT_EXTS,
  TOOL_SCREENSHOT_MAX_BYTES,
  toolLocaleFile,
  toolLocalesSchema,
  toolManifestSchema,
  toolModelFiles,
  validateCode,
  validateToolLocale,
  type ToolLocales,
  type ToolManifest,
  type ToolModelSpec,
} from "./toolFormat";
import { addUploadedPreviewImages } from "./uploadService";
import { GITHUB_REPO, releaseBranch } from "./versionService";

export { parseToolManifest, type ToolManifest } from "./toolFormat";

// --- Who may use them -----------------------------------------------------------------------------------------------

export type ToolUser = { id: string; role: Role };
export type ToolAccessOut = { canUse: boolean; canCreate: boolean };

export async function toolAccessOf(user: ToolUser): Promise<ToolAccessOut> {
  const access = await getToolsAccess();
  const canUse =
    user.role === "ADMIN" ||
    access.audience === "everyone" ||
    (access.audience === "selected" && access.userIds.includes(user.id));
  return { canUse, canCreate: canUse && access.userTools };
}

export async function assertCanUseTools(user: ToolUser): Promise<ToolAccessOut> {
  const access = await toolAccessOf(user);
  if (!access.canUse) throw new HttpError(403, "Tools aren't available to you on this Thingport", "TOOLS_OFF");
  return access;
}

/** Everyone who can use tools now. */
async function toolUsers(): Promise<string[]> {
  const access = await getToolsAccess();
  const where: Prisma.UserWhereInput =
    access.audience === "everyone"
      ? {}
      : { OR: [{ role: "ADMIN" }, ...(access.audience === "selected" ? [{ id: { in: access.userIds } }] : [])] };
  return (await prisma.user.findMany({ where, select: { id: true } })).map((user) => user.id);
}

// --- What the frontend gets -----------------------------------------------------------------------------------------

// The labels are part of it: a tool whose words changed has changed, and the window runs it again.
const shaOf = (manifest: ToolManifest, script: string, html: string | null, locales: ToolLocales = {}) =>
  createHash("sha256")
    .update(JSON.stringify(manifest))
    .update("\0")
    .update(script)
    .update("\0")
    .update(html ?? "")
    .update("\0")
    .update(
      JSON.stringify(
        Object.keys(locales)
          .toSorted()
          .map((code) => [code, locales[code]]),
      ),
    )
    .digest("hex");

/** Of the models a tool brings: the same spec is the same models, so an update that leaves it alone keeps them. */
const modelsShaOf = (manifest: ToolManifest) =>
  manifest.collection ? createHash("sha256").update(JSON.stringify(manifest.collection)).digest("hex") : null;

export type ToolOut = {
  id: string;
  source: "repo" | "own";
  slug: string;
  manifest: ToolManifest;
  script: string;
  html: string | null;
  /** Its labels by language; `{}` for a tool that ships none. */
  locales: ToolLocales;
  sha: string;
  updatedAt: string;
  /** This user's collection of the models the tool brings, once it has one. */
  collectionId: string | null;
};

/** The stored labels, ignoring anything that no longer fits the shape rather than refusing the whole tool. */
function localesOf(tool: Pick<Tool, "locales">): ToolLocales {
  if (!tool.locales) return {};
  const parsed = toolLocalesSchema.safeParse(tool.locales);
  return parsed.success ? parsed.data : {};
}

function manifestOf(tool: Pick<Tool, "manifest">): ToolManifest | null {
  const parsed = toolManifestSchema.safeParse(tool.manifest);
  return parsed.success ? parsed.data : null;
}

function out(tool: Tool, collectionId: string | null = null): ToolOut | null {
  const manifest = manifestOf(tool);
  if (!manifest) return null;
  return {
    id: tool.id,
    source: tool.source === "own" ? "own" : "repo",
    slug: tool.slug,
    manifest,
    script: tool.script,
    html: tool.html,
    locales: localesOf(tool),
    sha: tool.sha,
    updatedAt: tool.updatedAt.toISOString(),
    collectionId,
  };
}

/** The tools the user may open: the installed ones, then their own when making them is allowed. */
export async function listTools(user: ToolUser): Promise<{ access: ToolAccessOut; tools: ToolOut[] }> {
  const access = await toolAccessOf(user);
  if (!access.canUse) return { access, tools: [] };
  const [tools, collections] = await Promise.all([
    prisma.tool.findMany({
      where: { OR: [{ source: "repo" }, ...(access.canCreate ? [{ source: "own", userId: user.id }] : [])] },
      orderBy: [{ source: "desc" }, { createdAt: "asc" }],
    }),
    prisma.collection.findMany({
      where: { userId: user.id, toolId: { not: null } },
      select: { id: true, toolId: true },
    }),
  ]);
  const collectionOf = new Map(collections.map((c) => [c.toolId!, c.id]));
  return { access, tools: tools.flatMap((tool) => out(tool, collectionOf.get(tool.id) ?? null) ?? []) };
}

/** A tool the user may run, for its calls back to Thingport: an installed one, or one of their own while that's on. */
export async function usableTool(user: ToolUser, toolId: string): Promise<Tool & { parsed: ToolManifest }> {
  const access = await assertCanUseTools(user);
  const tool = await prisma.tool.findUnique({ where: { id: toolId } });
  const mine = tool?.source === "own" && tool.userId === user.id;
  const parsed = tool && manifestOf(tool);
  if (!tool || !parsed || (tool.source === "own" && !mine)) throw new HttpError(404, "No such tool");
  if (mine && !access.canCreate)
    throw new HttpError(403, "Users' own tools are turned off on this Thingport", "USER_TOOLS_OFF");
  return { ...tool, parsed };
}

// --- Users' own tools -----------------------------------------------------------------------------------------------

export async function saveOwnTool(
  user: ToolUser,
  input: { slug: string; manifest: ToolManifest; script: string; html?: string | null; locales?: ToolLocales },
): Promise<ToolOut> {
  const access = await assertCanUseTools(user);
  if (!access.canCreate)
    throw new HttpError(403, "Users' own tools are turned off on this Thingport", "USER_TOOLS_OFF");
  if (!SLUG.test(input.slug))
    throw new HttpError(400, "The slug is 2-40 lowercase letters, digits and dashes, starting with a letter or digit");
  if (input.manifest.collection)
    throw new HttpError(400, "Only a tool from the repository brings models: save yours to a collection instead");
  const html = input.html?.trim() ? input.html : null;
  validateCode(input.script, html);
  const manifest = input.manifest.author
    ? input.manifest
    : {
        ...input.manifest,
        author: (await prisma.user.findUnique({ where: { id: user.id } }))?.displayName.slice(0, 60),
      };
  const locales = ownLocales(input.locales);
  const data = {
    manifest: { ...manifest, locales: Object.keys(locales) },
    script: input.script,
    html,
    locales: locales as Prisma.InputJsonValue,
    sha: shaOf(manifest, input.script, html, locales),
  };
  const tool = await prisma.tool.upsert({
    where: { scope_slug: { scope: user.id, slug: input.slug } },
    create: { source: "own", scope: user.id, userId: user.id, slug: input.slug, ...data },
    update: data,
  });
  return out(tool)!;
}

/** A user's own labels, checked the way a repository tool's files are, and held to the same total size. */
function ownLocales(raw: ToolLocales | undefined): ToolLocales {
  if (!raw) return {};
  const parsed = toolLocalesSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "Those labels aren't right");
  const size = JSON.stringify(parsed.data).length;
  if (size > TOOL_LOCALES_MAX_BYTES) {
    throw new HttpError(400, `The labels are larger than ${Math.round(TOOL_LOCALES_MAX_BYTES / 1024)} KB`);
  }
  for (const [code, words] of Object.entries(parsed.data)) {
    if (JSON.stringify(words).length > TOOL_LOCALE_MAX_BYTES) {
      throw new HttpError(400, `The ${code} labels are larger than ${Math.round(TOOL_LOCALE_MAX_BYTES / 1024)} KB`);
    }
  }
  return parsed.data;
}

export async function deleteOwnTool(userId: string, id: string): Promise<void> {
  const { count } = await prisma.tool.deleteMany({ where: { id, source: "own", userId } });
  if (!count) throw new HttpError(404, "No such tool");
}

// --- The repository -------------------------------------------------------------------------------------------------

// Where tools come from. A Thingport run from a checkout of the repository (npm run dev, or the local
// docker-compose.yml, which mounts it as TOOLS_DIR) reads the checkout's own tools folder, so a tool being worked on
// is what's offered. A published image has none and reads the repository's as GitHub serves it, on develop for the
// :dev image; TOOLS_URL points it at a fork's, and TOOLS_DIR at any folder on disk.
const REPO_URL =
  process.env.TOOLS_URL?.replace(/\/+$/, "") ??
  `https://raw.githubusercontent.com/${GITHUB_REPO}/${releaseBranch()}/tools`;
// backend/src/services here, backend/dist/services built: the checkout's root is three up either way.
const CHECKOUT_TOOLS = path.resolve(__dirname, "../../../tools");

function defaultRepoDir(): string | null {
  if (process.env.TOOLS_DIR) return path.resolve(process.env.TOOLS_DIR);
  if (process.env.TOOLS_URL) return null;
  return fsSync.existsSync(path.join(CHECKOUT_TOOLS, "index.json")) ? CHECKOUT_TOOLS : null;
}

let repoDir: string | null = defaultRepoDir();
const REPO_TTL_MS = 60 * 60 * 1000;

/** Where the tools offered come from, for the admin page to say. */
export function toolsSource(): { kind: "folder" | "repository"; location: string } {
  return repoDir ? { kind: "folder", location: repoDir } : { kind: "repository", location: REPO_URL };
}
const TEXT_MAX_BYTES = 1024 * 1024;

type RepoTool = {
  slug: string;
  manifest: ToolManifest;
  script: string;
  html: string | null;
  locales: ToolLocales;
  sha: string;
};
const repoCache = new TtlCache<RepoTool[] | RepoTool>(REPO_TTL_MS);

let fetchImpl: typeof fetch = (...args) => fetch(...args);
/** Lets tests stand in for the repository, as a folder on disk or as GitHub's answers. */
export function setToolsRepoForTest(source?: { dir?: string; fetch?: typeof fetch }): void {
  repoDir = source?.dir ?? defaultRepoDir();
  fetchImpl = source?.fetch ?? ((...args) => fetch(...args));
  repoCache.clear();
  screenshotCache.clear();
}

/** A file of the repository's tools folder; null when it has none. */
async function repoFile(file: string, maxBytes: number): Promise<Buffer | null> {
  if (repoDir) {
    const full = path.resolve(repoDir, file);
    if (!full.startsWith(repoDir + path.sep)) return null;
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) return null;
    if (stat.size > maxBytes) throw new HttpError(502, `${file} is larger than ${Math.round(maxBytes / 1048576)} MB`);
    return fs.readFile(full);
  }
  const url = `${REPO_URL}/${file.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(502, `The tools repository answered HTTP ${res.status}`);
  const { buffer, truncated } = await readCapped(res, maxBytes);
  if (truncated) throw new HttpError(502, `${file} is larger than ${Math.round(maxBytes / 1048576)} MB`);
  return buffer;
}

const repoText = async (file: string) => (await repoFile(file, TEXT_MAX_BYTES))?.toString("utf8") ?? null;

/**
 * The label files a tool's metadata declares, read as its other files are. One that is missing or malformed is
 * left out with a note rather than failing the whole tool, so a half-translated tool still installs in the
 * languages it does have.
 */
async function fetchRepoLocales(slug: string, manifest: ToolManifest): Promise<ToolLocales> {
  const locales: ToolLocales = {};
  let total = 0;
  for (const code of manifest.locales) {
    const file = toolLocaleFile(code);
    const buffer = await repoFile(`${slug}/${file}`, TOOL_LOCALE_MAX_BYTES).catch(() => null);
    if (!buffer) continue;
    total += buffer.byteLength;
    if (total > TOOL_LOCALES_MAX_BYTES) {
      throw new HttpError(502, `${slug}'s labels are larger than ${Math.round(TOOL_LOCALES_MAX_BYTES / 1024)} KB`);
    }
    try {
      locales[code] = validateToolLocale(code, JSON.parse(buffer.toString("utf8")));
    } catch {
      // A language that won't read is simply one the tool doesn't have.
    }
  }
  return locales;
}

/** `fresh` for an install, which takes the repository's files as they are now, not as they were an hour ago. */
async function fetchRepoTool(slug: string, fresh = false): Promise<RepoTool> {
  // A folder on disk is read afresh each time, so a tool being worked on shows its changes at once.
  const cached = fresh || repoDir ? undefined : repoCache.get(`tool:${slug}`);
  if (cached && !Array.isArray(cached)) return cached;
  const metadata = (await repoText(`${slug}/tool.json`)) ?? (await repoText(`${slug}/tool.yml`));
  const script = await repoText(`${slug}/tool.js`);
  if (!metadata || !script) throw new HttpError(404, `The tools repository has no tool "${slug}"`);
  const html = await repoText(`${slug}/tool.html`);
  const manifest = parseToolManifest(metadata);
  validateCode(script, html);
  const locales = await fetchRepoLocales(slug, manifest);
  const tool = { slug, manifest, script, html, locales, sha: shaOf(manifest, script, html, locales) };
  repoCache.set(`tool:${slug}`, tool);
  return tool;
}

/** The repository's tools, from its index.json; one that doesn't load is left out rather than hiding the rest. */
async function repoCatalog(): Promise<RepoTool[]> {
  const cached = repoDir ? undefined : repoCache.get("index");
  if (Array.isArray(cached)) return cached;
  const indexText = await repoText("index.json");
  let slugs: string[] = [];
  if (indexText) {
    try {
      const index = JSON.parse(indexText) as { tools?: unknown };
      slugs = Array.isArray(index.tools)
        ? index.tools.filter((s): s is string => typeof s === "string" && SLUG.test(s))
        : [];
    } catch {
      throw new HttpError(502, "The tools repository's index.json isn't valid JSON");
    }
  }
  const results = await Promise.allSettled(slugs.map((slug) => fetchRepoTool(slug)));
  const tools = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  repoCache.set("index", tools);
  return tools;
}

// Screenshots are looked at again and again while an admin browses, and change only with the tool.
const screenshotCache = new TtlCache<{ body: Buffer; type: string }>(REPO_TTL_MS);

/** One of a repository tool's screenshots, by its place in the metadata, for an admin deciding whether to install it.
 *  Read from the repository (or TOOLS_DIR) as its other files are, so the browser asks nothing of GitHub. */
export async function repoToolScreenshot(slug: string, index: number): Promise<{ body: Buffer; type: string }> {
  if (!SLUG.test(slug)) throw new HttpError(400, "Not a tool name");
  const tool = await fetchRepoTool(slug);
  const shot = tool.manifest.screenshots[index];
  if (!shot) throw new HttpError(404, "No such screenshot");
  const key = `${slug}/${tool.sha}/${shot.file}`;
  const cached = repoDir ? undefined : screenshotCache.get(key);
  if (cached) return cached;
  const body = await repoFile(`${slug}/${shot.file}`, TOOL_SCREENSHOT_MAX_BYTES);
  if (!body) throw new HttpError(404, "The tools repository has no such screenshot");
  const image = { body, type: TOOL_SCREENSHOT_EXTS.get(path.extname(shot.file).toLowerCase())! };
  screenshotCache.set(key, image);
  return image;
}

// --- Installing, for admins -----------------------------------------------------------------------------------------

/** Where an installed tool's models are kept, the files each copy is made from. Per spec, so an update that changes
 *  them starts afresh beside the old ones. */
const TOOLS_STORAGE = path.join(STORAGE, "tools");
const modelsDir = (tool: Pick<Tool, "slug" | "modelsSha">) =>
  path.join(TOOLS_STORAGE, tool.slug, (tool.modelsSha ?? "none").slice(0, 16));

type FetchedModel = { title: string | null; notes: string | null; files: string[]; images: string[] };
const MODEL_INFO = "model.json";

async function fetchedModel(dir: string, key: string): Promise<FetchedModel | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, key, MODEL_INFO), "utf8")) as FetchedModel;
  } catch {
    return null;
  }
}

export type ToolModelsState = {
  total: number;
  ready: number;
  /** Models that didn't come at the last try, with why. */
  failed: { key: string; name: string; reason: string }[];
  fetching: boolean;
};

export type AdminTool = {
  slug: string;
  /** The repository's metadata, or the installed copy's for a tool the repository no longer has. */
  manifest: ToolManifest;
  inRepo: boolean;
  installed: {
    id: string;
    version: string;
    installedAt: string;
    updatedAt: string;
    updateAvailable: boolean;
    models: ToolModelsState | null;
  } | null;
};

// The fetch running for each tool, by id: one at a time, and how far it's got.
const fetches = new Map<string, Promise<void>>();

async function modelsState(tool: Tool, manifest: ToolManifest): Promise<ToolModelsState | null> {
  const models = manifest.collection?.models;
  if (!models) return null;
  const dir = modelsDir(tool);
  const ready = (
    await Promise.all(
      models.map((model) =>
        fs.access(path.join(dir, model.key, MODEL_INFO)).then(
          () => 1,
          () => 0,
        ),
      ),
    )
  ).reduce<number>((sum, n) => sum + n, 0);
  const failed = (tool.modelsFailed ?? {}) as Record<string, string>;
  return {
    total: models.length,
    ready,
    failed: models.filter((m) => failed[m.key]).map((m) => ({ key: m.key, name: m.name, reason: failed[m.key] })),
    fetching: fetches.has(tool.id),
  };
}

/** The repository's tools with what's installed of each, and installed ones the repository no longer lists. */
export async function adminToolCatalog(): Promise<{
  tools: AdminTool[];
  repoError: string | null;
  source: ReturnType<typeof toolsSource>;
}> {
  const installed = await prisma.tool.findMany({ where: { source: "repo" }, orderBy: { createdAt: "asc" } });
  let catalog: RepoTool[] = [];
  let repoError: string | null = null;
  try {
    catalog = await repoCatalog();
  } catch (err) {
    repoError = err instanceof Error ? err.message : String(err);
  }
  const installedOut = async (tool: Tool | undefined, repo?: RepoTool): Promise<AdminTool["installed"]> => {
    const manifest = tool && manifestOf(tool);
    if (!tool || !manifest) return null;
    return {
      id: tool.id,
      version: manifest.version,
      installedAt: tool.createdAt.toISOString(),
      updatedAt: tool.updatedAt.toISOString(),
      updateAvailable: Boolean(repo && repo.sha !== tool.sha),
      models: await modelsState(tool, manifest),
    };
  };
  const fromRepo = await Promise.all(
    catalog.map(async (repo) => ({
      slug: repo.slug,
      manifest: repo.manifest,
      inRepo: true,
      installed: await installedOut(
        installed.find((tool) => tool.slug === repo.slug),
        repo,
      ),
    })),
  );
  const gone = await Promise.all(
    installed
      .filter((tool) => !catalog.some((repo) => repo.slug === tool.slug) && manifestOf(tool))
      .map(async (tool) => ({
        slug: tool.slug,
        manifest: manifestOf(tool)!,
        // Unknown while the repository can't be read: offered as installed, without an update.
        inRepo: repoError !== null,
        installed: await installedOut(tool),
      })),
  );
  return { tools: [...fromRepo, ...gone], repoError, source: toolsSource() };
}

/** Installs a repository tool for the instance, or takes its update, then fetches the models it brings in the
 *  background, as `adminId`. */
export async function installRepoTool(slug: string, adminId: string): Promise<AdminTool["installed"]> {
  if (!SLUG.test(slug)) throw new HttpError(400, "Not a tool name");
  const repo = await fetchRepoTool(slug, true);
  const files = toolModelFiles(repo.manifest);
  const existing = await prisma.tool.findUnique({ where: { scope_slug: { scope: "repo", slug } } });
  const modelsSha = modelsShaOf(repo.manifest);
  const modelsChanged = existing?.modelsSha !== modelsSha;
  // Its own files first, so a tool whose files can't be had isn't half installed.
  if (modelsChanged && files.length) await downloadRepoFiles(slug, modelsSha!, repo.manifest);
  const data = {
    manifest: repo.manifest as Prisma.InputJsonValue,
    script: repo.script,
    html: repo.html,
    locales: repo.locales as Prisma.InputJsonValue,
    sha: repo.sha,
    modelsSha,
    ...(modelsChanged ? { modelsFailed: {} } : {}),
  };
  if (existing && modelsChanged) {
    // Everyone's copies of the old models go, with the folder they were made from; the collections stay, renamed.
    await whileNotCopying(existing.id, async () => {
      await removeToolModels(existing.id);
      await fs.rm(modelsDir(existing), { recursive: true, force: true });
    });
  }
  const tool = await prisma.tool.upsert({
    where: { scope_slug: { scope: "repo", slug } },
    create: { source: "repo", scope: "repo", slug, ...data },
    update: data,
  });
  if (!repo.manifest.collection) await prisma.collection.deleteMany({ where: { toolId: tool.id } });
  void createLog({
    userId: adminId,
    action: "tool_installed",
    targetId: tool.id,
    details: { slug, version: repo.manifest.version, update: Boolean(existing) },
  });
  if (repo.manifest.collection) startModelFetch(tool, adminId);
  const manifest = manifestOf(tool)!;
  return {
    id: tool.id,
    version: manifest.version,
    installedAt: tool.createdAt.toISOString(),
    updatedAt: tool.updatedAt.toISOString(),
    updateAvailable: false,
    models: await modelsState(tool, manifest),
  };
}

/** The tool's own model files, from the repository into the folder each user's copy is made from. All or none. */
async function downloadRepoFiles(slug: string, modelsSha: string, manifest: ToolManifest): Promise<void> {
  const dir = modelsDir({ slug, modelsSha });
  const staging = `${dir}.part`;
  await fs.rm(staging, { recursive: true, force: true });
  try {
    let total = 0;
    for (const model of manifest.collection!.models) {
      if (!model.files) continue;
      const names: string[] = [];
      for (const file of model.files) {
        const content = await repoFile(`${slug}/${file}`, TOOL_FILE_MAX_BYTES);
        if (!content) throw new HttpError(502, `The tools repository has no ${slug}/${file}`);
        total += content.length;
        if (total > TOOL_FILES_MAX_BYTES)
          throw new HttpError(502, `The tool's files are larger than ${TOOL_FILES_MAX_BYTES / 1048576} MB`);
        const name = uniqueName(names, sanitizeFilename(path.basename(file)));
        await fs.mkdir(path.join(staging, model.key, "files"), { recursive: true });
        await fs.writeFile(path.join(staging, model.key, "files", name), content);
        names.push(name);
      }
      const info: FetchedModel = { title: null, notes: null, files: names, images: [] };
      await fs.writeFile(path.join(staging, model.key, MODEL_INFO), JSON.stringify(info));
    }
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await fs.rename(staging, dir);
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true });
    throw err;
  }
}

function uniqueName(taken: string[], name: string): string {
  if (!taken.includes(name)) return name;
  const { name: base, ext } = path.parse(name);
  let n = 2;
  while (taken.includes(`${base}-${n}${ext}`)) n++;
  return `${base}-${n}${ext}`;
}

/** Fetches the models that aren't in yet (imports of their pages, as the admin), then gives everyone their copies.
 *  Again for the ones that failed, e.g. after the provider's daily downloads ran out. */
export function startModelFetch(tool: Tool, adminId: string): void {
  if (fetches.has(tool.id)) return;
  const run = fetchToolModels(tool, adminId)
    .catch((err) => console.error(`Fetching the models of tool ${tool.slug} failed:`, err))
    .finally(() => {
      fetches.delete(tool.id);
      // Everyone's copies, made one user after another: on a big instance that takes a while, and an uninstall
      // meanwhile stops it (whileNotCopying).
      void provisionEveryone(tool.id).catch((err) =>
        console.error(`Giving out the models of tool ${tool.slug} failed:`, err),
      );
    });
  fetches.set(tool.id, run);
}

/** Waits for a tool's fetch to finish; everyone's copies are still being made after it. For tests. */
export async function toolFetchSettled(toolId: string): Promise<void> {
  await fetches.get(toolId);
}

export async function retryModelFetch(slug: string, adminId: string): Promise<void> {
  const tool = await prisma.tool.findUnique({ where: { scope_slug: { scope: "repo", slug } } });
  if (!tool) throw new HttpError(404, "That tool isn't installed");
  startModelFetch(tool, adminId);
}

// The same reason this many times in a row is the admin's account, not the models (not connected, out of downloads):
// the rest would only fail the same way, so they're left for a retry.
const SAME_REASON_STOP = 3;

async function fetchToolModels(tool: Tool, adminId: string): Promise<void> {
  const manifest = manifestOf(tool);
  const dir = modelsDir(tool);
  const failed: Record<string, string> = {};
  const wanted: ToolModelSpec[] = [];
  for (const model of manifest?.collection?.models ?? [])
    if (model.source && !(await fetchedModel(dir, model.key))) wanted.push(model);
  let last: string | null = null;
  let repeats = 0;
  for (const [index, model] of wanted.entries()) {
    try {
      await importToolModel(adminId, model, path.join(dir, model.key));
      last = null;
      repeats = 0;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failed[model.key] = reason;
      repeats = reason === last ? repeats + 1 : 1;
      last = reason;
      if (repeats >= SAME_REASON_STOP || (err instanceof HttpError && err.status === 429)) {
        for (const rest of wanted.slice(index + 1)) failed[rest.key] = reason;
        break;
      }
    }
    await prisma.tool.update({ where: { id: tool.id }, data: { modelsFailed: failed } }).catch(() => undefined);
  }
  await prisma.tool.update({ where: { id: tool.id }, data: { modelsFailed: failed } }).catch(() => undefined);
}

/** One model page imported as the admin, its files and pictures copied out, and the model it made thrown away (one
 *  the admin had already is left as it was). */
async function importToolModel(adminId: string, model: ToolModelSpec, target: string): Promise<void> {
  const { url, body } = await prepareSingleImport(adminId, { url: model.source! });
  const result = await importQuietly(() => importPrintFromUrl(adminId, url, body));
  const staging = `${target}.part`;
  await fs.rm(staging, { recursive: true, force: true });
  try {
    await fs.mkdir(path.join(staging, "files"), { recursive: true });
    await fs.mkdir(path.join(staging, "images"), { recursive: true });
    const files: string[] = [];
    for (const plate of result.plates.toSorted((a, b) => a.position - b.position)) {
      const from = resolvePlateFilePath(plate);
      if (!from) continue;
      const name = uniqueName(files, sanitizeFilename(plate.filename));
      await fs.copyFile(from, path.join(staging, "files", name));
      files.push(name);
    }
    if (!files.length) throw new HttpError(502, "The import brought no model files");
    const images: string[] = [];
    const home = await printAssetHome(result.print.id);
    for (const image of result.previewImages.toSorted((a, b) => a.position - b.position)) {
      const from = previewImagePath(image.id, home);
      if (!fsSync.existsSync(from)) continue;
      const name = `${images.length + 1}.jpg`;
      await fs.copyFile(from, path.join(staging, "images", name));
      images.push(name);
    }
    const info: FetchedModel = { title: result.print.title, notes: result.print.notes, files, images };
    await fs.writeFile(path.join(staging, MODEL_INFO), JSON.stringify(info));
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(staging, target);
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true });
    throw err;
  } finally {
    if (!result.alreadyImported) await deletePrint(adminId, result.print.id, { quiet: true }).catch(() => undefined);
  }
}

export async function uninstallRepoTool(slug: string, adminId: string): Promise<void> {
  const tool = await prisma.tool.findUnique({ where: { scope_slug: { scope: "repo", slug } } });
  if (!tool) throw new HttpError(404, "That tool isn't installed");
  await whileNotCopying(tool.id, async () => {
    await removeToolModels(tool.id);
    // Its collections and the data it kept go with it.
    await prisma.tool.delete({ where: { id: tool.id } });
  });
  await fs.rm(path.join(TOOLS_STORAGE, slug), { recursive: true, force: true });
  void createLog({ userId: adminId, action: "tool_uninstalled", targetId: tool.id, details: { slug } });
}

export type OwnToolInUse = {
  id: string;
  slug: string;
  manifest: ToolManifest;
  owner: { id: string; displayName: string; email: string };
};

/** For admins: the tools users made themselves. */
export async function ownToolsInUse(): Promise<OwnToolInUse[]> {
  const tools = await prisma.tool.findMany({
    where: { source: "own" },
    include: { user: { select: { id: true, displayName: true, email: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return tools.flatMap((tool) => {
    const manifest = manifestOf(tool);
    return manifest && tool.user ? [{ id: tool.id, slug: tool.slug, manifest, owner: tool.user }] : [];
  });
}

// --- Everyone's own models from a tool's files ---------------------------------------------------------------------------

// One run per tool and user at a time: the collections page and the Tools page may both ask at once.
const provisioning = new Map<string, Promise<void>>();
// Tools whose models are being taken away, by an uninstall or an update: no new copies are made meanwhile.
const removing = new Set<string>();

/** Stops new models being given out, and waits out the ones being given and the fetch, before `fn` takes them. */
async function whileNotCopying<T>(toolId: string, fn: () => Promise<T>): Promise<T> {
  removing.add(toolId);
  try {
    await fetches.get(toolId)?.catch(() => undefined);
    // A run already queued may start after this looks, and then stops at once (syncUser), so a second look is enough.
    await new Promise((resolve) => setImmediate(resolve));
    for (let pass = 0; pass < 2; pass++) {
      const runs = [...provisioning.entries()].filter(([key]) => key.startsWith(`${toolId}:`)).map(([, run]) => run);
      await Promise.all(runs);
    }
    return await fn();
  } finally {
    removing.delete(toolId);
  }
}

function serially(key: string, fn: () => Promise<void>): Promise<void> {
  const next = (provisioning.get(key) ?? Promise.resolve()).then(fn, fn);
  const settled = next.catch(() => undefined);
  provisioning.set(key, settled);
  void settled.then(() => {
    if (provisioning.get(key) === settled) provisioning.delete(key);
  });
  return next;
}

/** Gives the user their copies of every installed tool's models when they can use tools, and takes them away when
 *  they can't. Cheap when there's nothing to do. */
export async function syncToolModels(user: ToolUser): Promise<void> {
  const tools = await prisma.tool.findMany({ where: { source: "repo", modelsSha: { not: null } } });
  if (!tools.length) return;
  const { canUse } = await toolAccessOf(user);
  for (const tool of tools) await serially(`${tool.id}:${user.id}`, () => syncUser(tool, user.id, canUse));
}

/** The same, not waited for: a page that lists collections shouldn't wait for copies to be made. */
export function syncToolModelsSoon(user: ToolUser): void {
  void syncToolModels(user).catch((err) => console.error("Giving out tools' models failed:", err));
}

/** After an install, or a change to who may use tools: everyone's copies, made or taken away. */
export async function provisionEveryone(toolId?: string): Promise<void> {
  const users = await prisma.user.findMany({ select: { id: true, role: true } });
  const allowed = new Set(await toolUsers());
  const tools = await prisma.tool.findMany({
    where: { source: "repo", modelsSha: { not: null }, ...(toolId ? { id: toolId } : {}) },
  });
  for (const tool of tools) {
    for (const user of users) {
      await serially(`${tool.id}:${user.id}`, () => syncUser(tool, user.id, allowed.has(user.id))).catch((err) =>
        console.error(`Giving out the models of tool ${tool.slug} failed:`, err),
      );
    }
  }
}

export function provisionEveryoneSoon(): void {
  void provisionEveryone().catch((err) => console.error("Giving out tools' models failed:", err));
}

/** One user's copies of one tool's models, made or taken away; neither while the tool's are being taken away for
 *  everyone, which takes this user's too. */
function syncUser(tool: Tool, userId: string, canUse: boolean): Promise<void> {
  if (removing.has(tool.id)) return Promise.resolve();
  return canUse ? provisionUser(tool, userId) : removeToolModels(tool.id, userId);
}

/** The name of a tool's collection in the user's library: "Tool: <name>", unless they have one of their own by it. */
async function collectionName(userId: string, name: string, excludeId?: string): Promise<string> {
  const base = `Tool: ${name}`.slice(0, 200);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base} (${n})`;
    const taken = await prisma.collection.findFirst({
      where: {
        userId,
        nameNormalized: normalizeCollectionName(candidate),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
}

async function provisionUser(tool: Tool, userId: string): Promise<void> {
  const spec = manifestOf(tool)?.collection;
  if (!spec || removing.has(tool.id)) return;
  const dir = modelsDir(tool);
  let collection = await prisma.collection.findFirst({ where: { toolId: tool.id, userId } });
  if (!collection) {
    const name = await collectionName(userId, spec.name);
    collection = await prisma.collection.create({
      data: {
        userId,
        toolId: tool.id,
        name,
        nameNormalized: normalizeCollectionName(name),
        description: spec.description ?? null,
      },
    });
  } else if (
    !collection.name.startsWith(`Tool: ${spec.name}`) ||
    collection.description !== (spec.description ?? null)
  ) {
    // An update renamed it.
    const name = await collectionName(userId, spec.name, collection.id);
    collection = await prisma.collection.update({
      where: { id: collection.id },
      data: { name, nameNormalized: normalizeCollectionName(name), description: spec.description ?? null },
    });
  }
  const have = new Set(
    (await prisma.print.findMany({ where: { userId, toolId: tool.id }, select: { toolKey: true } })).map(
      (p) => p.toolKey,
    ),
  );
  let added = false;
  for (const model of spec.models) {
    if (removing.has(tool.id)) return;
    if (have.has(model.key)) continue;
    const fetched = await fetchedModel(dir, model.key);
    if (!fetched) continue;
    await giveModelTo(userId, tool.id, collection.id, model, fetched, path.join(dir, model.key));
    added = true;
  }
  if (added) await orderCollection(collection.id, spec.models);
}

/**
 * One of a tool's models in a user's library.
 *
 * The model is the user's -- their own row, in their own collection, in their own language -- but the files are
 * the tool's, and stay in the tool's folder: a plate's `sourcePath` is read wherever it points, so a planner
 * bringing twelve gigabytes of parts costs that once for the instance rather than once for every user who can
 * open it. Nothing here is the user's to change, so there is nothing to be gained by giving them a copy to
 * change: deleting one of these models leaves the tool's file where it is (deletePlateFiles only removes what
 * is under the model's own path, which for these is nothing), and an update that changes the models takes
 * everyone's away with the folder they point at, before the new ones are given out.
 */
async function giveModelTo(
  userId: string,
  toolId: string,
  collectionId: string,
  model: ToolModelSpec,
  fetched: FetchedModel,
  from: string,
): Promise<void> {
  const { print } = await createPrint(
    userId,
    { title: model.name, notes: model.description ?? fetched.notes, tags: model.tags },
    model.name,
    fetched.files.map((file) => ({ filename: file, sourcePath: path.join(from, "files", file) })),
    { describe: false, classify: false },
  );
  try {
    await prisma.print.update({ where: { id: print.id }, data: { toolId, toolKey: model.key } });
  } catch (err) {
    // Another run made this one first.
    await deletePrint(userId, print.id, { quiet: true }).catch(() => undefined);
    throw err;
  }
  const images = await Promise.all(fetched.images.map((image) => fs.readFile(path.join(from, "images", image))));
  if (images.length) await addUploadedPreviewImages(print.id, images).catch(() => undefined);
  await addPrintsToCollection(collectionId, [print.id]);
}

/** In the order the tool lists them, however they came in. */
async function orderCollection(collectionId: string, models: ToolModelSpec[]): Promise<void> {
  const order = new Map(models.map((model, index) => [model.key, index]));
  const items = await prisma.collectionItem.findMany({
    where: { collectionId },
    select: { id: true, position: true, print: { select: { toolKey: true } } },
  });
  for (const item of items) {
    const position = order.get(item.print.toolKey ?? "") ?? models.length;
    if (position !== item.position) await prisma.collectionItem.update({ where: { id: item.id }, data: { position } });
  }
}

/** A tool's models, everyone's or one user's, with their collections when it's the user's. */
async function removeToolModels(toolId: string, userId?: string): Promise<void> {
  const prints = await prisma.print.findMany({
    where: { toolId, ...(userId ? { userId } : {}) },
    select: { id: true, userId: true },
  });
  for (const print of prints) {
    // One a user's account took with it as it was deleted is gone already.
    await deletePrint(print.userId, print.id, { quiet: true }).catch((err: unknown) => {
      if (!gone(err)) throw err;
    });
  }
  if (userId) await prisma.collection.deleteMany({ where: { toolId, userId } });
}

/** The user's copies of the tool's models, by key, for `thingport.tool.models`. */
export async function toolModelsOf(
  user: ToolUser,
  toolId: string,
): Promise<{ key: string; name: string; source: string | null; printId: string | null }[]> {
  const tool = await usableTool(user, toolId);
  const models = tool.parsed.collection?.models ?? [];
  const prints = await prisma.print.findMany({
    where: { userId: user.id, toolId: tool.id },
    select: { id: true, toolKey: true },
  });
  const byKey = new Map(prints.map((p) => [p.toolKey, p.id]));
  return models.map((model) => ({
    key: model.key,
    name: model.name,
    source: model.source ?? null,
    printId: byKey.get(model.key) ?? null,
  }));
}

// --- Locks ----------------------------------------------------------------------------------------------------------

const LOCKED = "TOOL_OWNED";

/** Refuses a change to models a tool brought: they're kept as the tool needs them, until it's uninstalled. */
export async function assertNotToolModels(printIds: string[]): Promise<void> {
  if (!printIds.length) return;
  const locked = await prisma.print.findFirst({ where: { id: { in: printIds }, toolId: { not: null } } });
  if (locked)
    throw new HttpError(403, `"${locked.title || locked.name}" belongs to a tool and can't be changed`, LOCKED);
}

/** Refuses a change to a tool's collection, which only the tool's uninstall removes. */
export async function assertNotToolCollections(collectionIds: string[]): Promise<void> {
  if (!collectionIds.length) return;
  const locked = await prisma.collection.findFirst({ where: { id: { in: collectionIds }, toolId: { not: null } } });
  if (locked) throw new HttpError(403, `"${locked.name}" belongs to a tool and can't be changed`, LOCKED);
}

/** A model deleted meanwhile: by its user's account going, or a run that got there first. */
const gone = (err: unknown) =>
  (err instanceof HttpError && err.status === 404) || (err as { code?: unknown } | null)?.code === "P2025";

// --- What a tool keeps ----------------------------------------------------------------------------------------------

export const STORAGE_KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const VALUE_MAX_BYTES = 1024 * 1024;
const TOOL_DATA_MAX_BYTES = 20 * 1024 * 1024;
const TOOL_DATA_MAX_KEYS = 2000;

function assertKey(key: string): void {
  if (!STORAGE_KEY.test(key))
    throw new HttpError(400, "A key is 1-200 letters, digits, dots, dashes, colons and underscores");
}

export async function listToolData(user: ToolUser, toolId: string) {
  const tool = await usableTool(user, toolId);
  const rows = await prisma.toolData.findMany({
    where: { toolId: tool.id, userId: user.id },
    select: { key: true, size: true, updatedAt: true },
    orderBy: { key: "asc" },
  });
  return rows.map((row) => ({ key: row.key, size: row.size, updatedAt: row.updatedAt.toISOString() }));
}

/** What's kept under the key; `found` false when nothing is, which a tool asks about on its first run. */
export async function getToolData(
  user: ToolUser,
  toolId: string,
  key: string,
): Promise<{ found: boolean; value?: unknown }> {
  assertKey(key);
  const tool = await usableTool(user, toolId);
  const row = await prisma.toolData.findUnique({
    where: { toolId_userId_key: { toolId: tool.id, userId: user.id, key } },
  });
  return row ? { found: true, value: row.value } : { found: false };
}

export async function setToolData(user: ToolUser, toolId: string, key: string, value: unknown): Promise<void> {
  assertKey(key);
  if (value === undefined) throw new HttpError(400, "There's no value to keep");
  const tool = await usableTool(user, toolId);
  const size = Buffer.byteLength(JSON.stringify(value));
  if (size > VALUE_MAX_BYTES) throw new HttpError(413, "A value is at most 1 MB as JSON");
  const where = { toolId: tool.id, userId: user.id };
  const [used, keys, current] = await Promise.all([
    prisma.toolData.aggregate({ where: { ...where, key: { not: key } }, _sum: { size: true } }),
    prisma.toolData.count({ where: { ...where, key: { not: key } } }),
    prisma.toolData.findUnique({ where: { toolId_userId_key: { ...where, key } }, select: { id: true } }),
  ]);
  if ((used._sum.size ?? 0) + size > TOOL_DATA_MAX_BYTES)
    throw new HttpError(413, "This tool keeps 20 MB at most for you; delete something first");
  if (!current && keys >= TOOL_DATA_MAX_KEYS)
    throw new HttpError(413, `This tool keeps ${TOOL_DATA_MAX_KEYS} keys at most`);
  const json = value as Prisma.InputJsonValue;
  await prisma.toolData.upsert({
    where: { toolId_userId_key: { ...where, key } },
    create: { ...where, key, value: json, size },
    update: { value: json, size },
  });
}

export async function deleteToolData(user: ToolUser, toolId: string, key: string): Promise<void> {
  assertKey(key);
  const tool = await usableTool(user, toolId);
  await prisma.toolData.deleteMany({ where: { toolId: tool.id, userId: user.id, key } });
}

// --- Reaching declared hosts ----------------------------------------------------------------------------------------

export const toolFetchSchema = widgetFetchSchema;

export async function toolFetch(user: ToolUser, toolId: string, request: z.infer<typeof toolFetchSchema>) {
  const tool = await usableTool(user, toolId);
  return declaredHostFetch(tool.parsed.hosts, request, "tool");
}
