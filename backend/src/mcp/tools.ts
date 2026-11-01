import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { MANIFESTS } from "../providers/index.generated";
import { providerNames } from "../providers/names";
import { prisma } from "../db";
import { toAuthorOut, type PrintOut } from "../dto";
import { HttpError, sanitizeFilename } from "../utils/fileUtils";
import { IMPORT_MAX_BYTES } from "../config";
import type { McpAccess } from "../services/settingsService";
import {
  addModelsToCollection,
  createCollection,
  removeModelsFromCollection,
  isSystemCollectionId,
  SYSTEM_COLLECTIONS,
  systemCollectionKeyForId,
} from "../services/collectionService";
import { getDashboardSummary } from "../services/dashboardService";
import { printOutById } from "../services/printLoader";
import { listPrints, PRINT_SORT_MODES, SELF_AUTHOR_ID, type PrintListPage } from "../services/printQuery";
import { search } from "../services/searchService";
import { getImportTask, startImportTask, type ImportTaskState } from "../services/importTaskService";
import { importAndDescribe, prepareSingleImport } from "../services/singleImport";
import {
  assertWidgetSourceEnabled,
  enabledWidgetSources,
  listCustomWidgets,
  localesSchema,
  parseManifest,
  saveOwnWidget,
  validateManifest,
} from "../services/customWidgetsService";
import { CUSTOM_WIDGET_GUIDE } from "../services/customWidgetGuide";
import { listTools as listUserTools, saveOwnTool } from "../services/toolsService";
import { parseToolManifest, toolLocalesSchema, validateToolManifest } from "../services/toolFormat";
import { TOOL_GUIDE } from "../services/toolGuide";
import { ICON_MAX_BYTES, listIcons as listUserIcons, saveIcon } from "../services/iconService";
import { ensurePlateProfiles, plateProfileOut, type PlateProfile } from "../services/plateProfile";
import { removePlate, renamePlate, resolvePlateFilePath } from "../services/printCreation";
import { deletePreparedFile, deleteSupportingFile, managedPrintFilePath } from "../services/printFileService";
import { notifyUpload } from "../services/modelNotifications";
import {
  addUploadedFiles,
  addUploadedPreviewImages,
  createUploadedModel,
  type FileKind,
  type UploadedFile,
} from "../services/uploadService";
import { previewImagePath, removePreviewImage, reorderPreviewImages } from "../services/previewImageService";
import { deletePrint, setPrintTags, updatePrintMeta } from "../services/printEditService";
import { setPrintCategory } from "../services/printCategoryService";
import { uniqueModelName } from "../services/printService";
import { CATEGORY_KINDS, createCategory, type CategoryKind } from "../services/categoryService";
import { createLog } from "../services/auditLog";
import { normalizeTags } from "../utils/tagNormalization";
import BUILTIN_ICONS from "./builtinIcons.json";

// The tools /api/mcp offers. Each runs as the token's user, through the same services as the REST
// API, so it sees exactly that user's library. Outputs are trimmed to what an assistant can use:
// image and file URLs only from the picture and file tools.
//
// A token reaches only the tools its user ticked (see routes/mcp.ts). A tool that writes must say so with
// `readOnly: false`: it's then off for a new token until its user turns it on, unless it's `defaultOn`.

export type McpToolContext = {
  userId: string;
  /** The instance's address as an admin set it, "" when unset: see getPublicUrl. */
  publicUrl: string;
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  /** A write tool a new token gets anyway, for writes that stay in the user's own space. */
  defaultOn?: boolean;
  /** Changes or removes something already there, rather than only adding: MCP's destructiveHint. */
  destructive?: boolean;
  /** Calling it again with the same arguments changes nothing more. */
  idempotent?: boolean;
  /** Reaches outside this Thingport, e.g. a provider's site. */
  openWorld?: boolean;
  inputSchema: z.ZodRawShape;
  run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

/** A result that also shows the assistant pictures, beside its JSON. */
export class WithImages {
  constructor(
    readonly data: unknown,
    readonly images: { data: string; mimeType: string }[],
  ) {}
}

const MAX_PAGE = 50;
const DEFAULT_PAGE = 20;

const pageArgs = {
  limit: z.number().int().min(1).max(MAX_PAGE).optional().describe(`How many to return, up to ${MAX_PAGE}.`),
  offset: z.number().int().min(0).optional().describe("How many to skip, for the next page."),
};

/** The model's page in the Thingport web app, when the instance knows its own address. */
function modelUrl(ctx: McpToolContext, id: string): string | null {
  return ctx.publicUrl ? `${ctx.publicUrl}/models/${id}` : null;
}

function modelSummary(ctx: McpToolContext, print: PrintOut) {
  return {
    id: print.id,
    title: print.title || print.name,
    creator: print.author?.name ?? print.creator,
    tags: print.tags,
    category: print.category_name,
    source: print.source_provider ? { provider: print.source_provider, url: print.source_url } : null,
    file_count: print.plates.length,
    view_count: print.view_count,
    print_count: print.print_count,
    favorite: print.is_favorite,
    added_at: print.created_at,
    url: modelUrl(ctx, print.id),
  };
}

function page(ctx: McpToolContext, result: PrintListPage) {
  return {
    models: result.prints.map((print) => modelSummary(ctx, print)),
    total: result.total,
    next_offset: result.hasMore ? result.nextOffset : null,
  };
}

const searchModels: McpToolDefinition = {
  name: "search_models",
  title: "Search models",
  description:
    "Search the library by words in a model's title, tags, creator or description. Also returns matching " +
    "collections and tags. Start here to find a model by what it is.",
  readOnly: true,
  inputSchema: {
    query: z.string().min(1).describe("Words to look for, e.g. 'benchy' or 'cable clip'."),
    limit: z.number().int().min(1).max(25).optional().describe("How many models to return, up to 25."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const result = await search(userId, args.query as string, args.limit as number | undefined);
    return {
      models: result.models.map((print) => modelSummary(ctx, print)),
      more_models: result.has_more_models,
      collections: result.collections.map((c) => ({ id: c.id, name: c.name, model_count: c.item_count })),
      tags: result.tags.map((t) => ({ tag: t.tag, model_count: t.count })),
    };
  },
};

const listModels: McpToolDefinition = {
  name: "list_models",
  title: "List models",
  description:
    "List models, optionally filtered by tags, category, collection or author, newest first unless sorted " +
    "otherwise. Filters combine: a model must match every one given.",
  readOnly: true,
  inputSchema: {
    query: z.string().optional().describe("Only models matching these words, as in search_models."),
    tags: z.array(z.string()).optional().describe("Only models that have every one of these tags."),
    category_id: z.string().optional().describe("Only models in this category (an id from list_categories)."),
    collection_id: z
      .string()
      .optional()
      .describe("Only models in this collection (an id from list_collections, or 'favorites' or 'history')."),
    author_id: z
      .string()
      .optional()
      .describe(`Only models by this author (an id from a model's author), or '${SELF_AUTHOR_ID}' for the user's own.`),
    sort: z
      .enum(PRINT_SORT_MODES)
      .optional()
      .describe("newest (default), popular (most viewed), downloads (most printed), or relevance (needs query)."),
    ...pageArgs,
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const result = await listPrints(
      userId,
      {
        q: args.query as string | undefined,
        tags: args.tags as string[] | undefined,
        categoryIds: args.category_id ? [args.category_id as string] : [],
        collectionId: args.collection_id as string | undefined,
        authorId: args.author_id as string | undefined,
      },
      {
        sort: args.sort as (typeof PRINT_SORT_MODES)[number] | undefined,
        limit: (args.limit as number | undefined) ?? DEFAULT_PAGE,
        offset: args.offset as number | undefined,
      },
    );
    return page(ctx, result);
  },
};

const getModel: McpToolDefinition = {
  name: "get_model",
  title: "Get a model",
  description:
    "Everything about one model: its description, files, tags, category, author, collections, where it was " +
    "imported from, and how often it was viewed and printed. Change it with edit_model.",
  readOnly: true,
  inputSchema: { id: z.string().min(1).describe("The model's id, from search_models or list_models.") },
  async run(ctx, args) {
    const { userId } = ctx;
    // printOutById, not GET /print/:id: an assistant looking at a model isn't the user viewing it, so
    // its view count and Browsing History stay as they are.
    const print = await printOutById(userId, args.id as string);
    const memberships = await prisma.collectionItem.findMany({
      where: { printId: print.id, collection: { userId } },
      select: { collection: { select: { id: true, name: true } } },
    });
    return {
      ...modelSummary(ctx, print),
      description: print.notes,
      author: print.author
        ? {
            id: print.author.id,
            name: print.author.name,
            handle: print.author.handle,
            provider: print.author.provider,
            links: print.author.links,
          }
        : null,
      files: print.plates.map((plate) => ({ name: plate.filename, size_bytes: plate.size })),
      supporting_file_count: print.supporting_file_count,
      image_count: print.preview_images.length,
      total_size_bytes: print.total_size,
      collections: memberships.map((m) => m.collection),
    };
  },
};

const listCollections: McpToolDefinition = {
  name: "list_collections",
  title: "List collections",
  description: "The user's collections, with how many models each holds, plus Favourites and Browsing History.",
  readOnly: true,
  inputSchema: {},
  async run(ctx) {
    const { userId } = ctx;
    const [collections, favoriteCount, historyCount] = await Promise.all([
      prisma.collection.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { items: true } }, sync: { select: { provider: true, sourceUrl: true } } },
      }),
      prisma.print.count({ where: { userId, favoritedAt: { not: null } } }),
      prisma.print.count({ where: { userId, lastViewedAt: { not: null } } }),
    ]);
    return {
      collections: [
        { id: SYSTEM_COLLECTIONS.favorites.id, name: SYSTEM_COLLECTIONS.favorites.name, model_count: favoriteCount },
        { id: SYSTEM_COLLECTIONS.history.id, name: SYSTEM_COLLECTIONS.history.name, model_count: historyCount },
        ...collections.map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          tags: c.tags,
          model_count: c._count.items,
          synced_with: c.sync ? { provider: c.sync.provider, url: c.sync.sourceUrl } : null,
        })),
      ],
    };
  },
};

const getCollection: McpToolDefinition = {
  name: "get_collection",
  title: "Get a collection",
  description: "One collection and the models in it, a page at a time.",
  readOnly: true,
  inputSchema: {
    id: z.string().min(1).describe("The collection's id, from list_collections ('favorites' and 'history' work too)."),
    ...pageArgs,
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const id = args.id as string;
    const systemKey = systemCollectionKeyForId(id);
    const collection = systemKey
      ? { id, name: SYSTEM_COLLECTIONS[systemKey].name, description: null, tags: [] as string[] }
      : await prisma.collection.findFirst({
          where: { id, userId },
          select: { id: true, name: true, description: true, tags: true },
        });
    if (!collection) throw new HttpError(404, "Collection not found");
    const result = await listPrints(
      userId,
      { collectionId: id },
      { limit: (args.limit as number | undefined) ?? DEFAULT_PAGE, offset: args.offset as number | undefined },
    );
    return { ...collection, ...page(ctx, result) };
  },
};

const listTags: McpToolDefinition = {
  name: "list_tags",
  title: "List tags",
  description:
    "The library's tags, most used first, with how many models have each, so models can then be listed by the exact " +
    "tag names it uses. A big library has thousands: narrow them with query.",
  readOnly: true,
  inputSchema: {
    query: z.string().optional().describe("Only tags containing this, ignoring case, e.g. 'drag' for 'dragon'."),
    limit: z.number().int().min(1).max(500).optional().describe("How many to return, up to 500 (default 200)."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const query = ((args.query as string | undefined) ?? "").trim().toLowerCase();
    const rows = await prisma.print.findMany({ where: { userId }, select: { tags: true } });
    // Counted case-insensitively, under the spelling seen first, as the library's tag list does.
    const counts = new Map<string, { tag: string; model_count: number }>();
    for (const row of rows) {
      for (const tag of new Set(row.tags.map((t) => t.trim()).filter(Boolean))) {
        const key = tag.toLowerCase();
        if (query && !key.includes(query)) continue;
        const entry = counts.get(key);
        if (entry) entry.model_count++;
        else counts.set(key, { tag, model_count: 1 });
      }
    }
    const all = [...counts.values()].toSorted((a, b) => b.model_count - a.model_count || a.tag.localeCompare(b.tag));
    return { tags: all.slice(0, (args.limit as number | undefined) ?? 200), total: all.length };
  },
};

const listCategories: McpToolDefinition = {
  name: "list_categories",
  title: "List categories",
  description:
    "The user's category and folder tree, with how many models each holds directly. Use an id with " +
    "list_models' category_id.",
  readOnly: true,
  inputSchema: {},
  async run(ctx) {
    const { userId } = ctx;
    const [categories, counts] = await Promise.all([
      prisma.category.findMany({
        where: { userId },
        orderBy: [{ position: "asc" }, { name: "asc" }],
        select: { id: true, name: true, parentId: true, kind: true },
      }),
      prisma.print.groupBy({ by: ["categoryId"], where: { userId, categoryId: { not: null } }, _count: true }),
    ]);
    const countById = new Map(counts.map((c) => [c.categoryId, c._count]));
    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        parent_id: c.parentId,
        kind: c.kind,
        model_count: countById.get(c.id) ?? 0,
      })),
    };
  },
};

const getAuthor: McpToolDefinition = {
  name: "get_author",
  title: "Get an author",
  description: "A designer the library has models from: who they are, where to find them, and their models here.",
  readOnly: true,
  inputSchema: {
    id: z.string().min(1).describe("The author's id, from a model's author."),
    ...pageArgs,
  },
  async run(ctx, args) {
    const { userId } = ctx;
    // Authors are shared across users; only this user's models of theirs are listed.
    const author = await prisma.author.findUnique({ where: { id: args.id as string } });
    if (!author) throw new HttpError(404, "Author not found");
    const out = toAuthorOut(author);
    const result = await listPrints(
      userId,
      { authorId: author.id },
      { limit: (args.limit as number | undefined) ?? DEFAULT_PAGE, offset: args.offset as number | undefined },
    );
    return {
      id: out.id,
      name: out.name,
      handle: out.handle,
      provider: out.provider,
      bio: out.bio_translated ?? out.bio,
      links: out.links,
      ...page(ctx, result),
    };
  },
};

const libraryStats: McpToolDefinition = {
  name: "library_stats",
  title: "Library stats",
  description:
    "How big the library is (models, collections, authors, categories) and its most viewed, most printed and " +
    "most recently added models, top authors and the sites models came from.",
  readOnly: true,
  inputSchema: {},
  async run(ctx) {
    const { userId } = ctx;
    const summary = await getDashboardSummary(userId);
    const model = (m: (typeof summary.topViewed)[number]) => ({
      id: m.id,
      title: m.name,
      view_count: m.viewCount,
      print_count: m.printCount,
      added_at: m.createdAt.toISOString(),
      url: modelUrl(ctx, m.id),
    });
    return {
      model_count: summary.modelCount,
      collection_count: summary.collectionCount,
      author_count: summary.authorCount,
      category_count: summary.categoryCount,
      most_viewed: summary.topViewed.map(model),
      most_printed: summary.topPrinted.map(model),
      recently_added: summary.recentlyAdded.map(model),
      top_authors: summary.topAuthors.map((a) => ({
        id: a.id,
        name: a.name,
        handle: a.handle,
        model_count: a.modelCount,
      })),
      sources: summary.topProviders.map((p) => ({ provider: p.provider, model_count: p.modelCount })),
    };
  },
};

// An import that takes longer than this (a big zip, a slow provider) carries on in the background, and the
// assistant follows it with get_import_status rather than holding the call open.
// An object so tests can shorten the wait.
export const mcpImportTiming = { waitMs: 25_000, pollMs: 250 };

type ImportedModel = PrintOut & { import_outcome: "created" | "already_imported" | "profile_added" };

/** What a finished, failed or still running import looks like to the assistant. */
function importStateOut(ctx: McpToolContext, taskId: string, state: ImportTaskState) {
  if (state.status === "running") {
    return {
      status: "running",
      task_id: taskId,
      note: "Still importing. Call get_import_status with this task_id in a little while.",
    };
  }
  if (state.status === "error") throw new HttpError(state.http_status, state.detail);
  const result = state.result as { model?: ImportedModel; collection?: { id: string; name: string } | null };
  // A task id from POST /import?async=1 belongs to the same user but holds a bare model.
  if (!result?.model) throw new HttpError(404, "No such import from import_model");
  return {
    status: result.model.import_outcome,
    model: modelSummary(ctx, result.model),
    collection: result.collection ?? null,
  };
}

/** Collections models can be filed in: the user's own, not Favourites or Browsing History. */
async function assertFilableCollection(userId: string, collectionId: string): Promise<void> {
  if (isSystemCollectionId(collectionId)) throw new HttpError(400, "Models can't be added to that collection");
  const owned = await prisma.collection.count({ where: { id: collectionId, userId } });
  if (!owned) throw new HttpError(404, "Collection not found");
}

const importModel: McpToolDefinition = {
  name: "import_model",
  title: "Import a model",
  description:
    `Import a model into the library from its page on a supported site (${providerNames(() => true)}), as + Add > ` +
    "Import does. A model already in the library isn't imported twice. " +
    "Usually finishes in the call; a long import returns a task_id to check with get_import_status.",
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    url: z.string().min(1).describe(`The model's page, e.g. ${MANIFESTS.printables.examples.model}`),
    title: z.string().max(500).optional().describe("A title to use instead of the site's."),
    tags: z.array(z.string()).optional().describe("Tags to use instead of the site's."),
    category_id: z.string().optional().describe("A category to file it in (an id from list_categories)."),
    collection_id: z.string().optional().describe("A collection to add it to (an id from list_collections)."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const collectionId = args.collection_id as string | undefined;
    // Checked first, so a bad collection doesn't leave an import half done.
    if (collectionId) await assertFilableCollection(userId, collectionId);
    // No captcha: like Thingport Grab, an assistant has nowhere to show one. The token's user turned this
    // tool on themselves, and an admin who doesn't want that sets MCP to read only.
    const { url, body } = await prepareSingleImport(userId, {
      url: args.url as string,
      title: (args.title as string | undefined) ?? null,
      tags: (args.tags as string[] | undefined) ?? [],
      category_id: (args.category_id as string | undefined) ?? null,
    });
    const taskId = startImportTask(userId, async () => {
      const model = (await importAndDescribe(userId, url, body)) as ImportedModel;
      const filed = collectionId ? (await addModelsToCollection(userId, collectionId, [model.id])).collection : null;
      return { model, collection: filed ? { id: filed.id, name: filed.name } : null };
    });
    const deadline = Date.now() + mcpImportTiming.waitMs;
    let state = getImportTask(taskId, userId)!;
    while (state.status === "running" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, mcpImportTiming.pollMs));
      state = getImportTask(taskId, userId)!;
    }
    return importStateOut(ctx, taskId, state);
  },
};

const getImportStatus: McpToolDefinition = {
  name: "get_import_status",
  title: "Check an import",
  description: "How an import that import_model left running is getting on, and the model once it's done.",
  readOnly: true,
  inputSchema: { task_id: z.string().min(1).describe("The task_id import_model returned.") },
  async run(ctx, args) {
    const { userId } = ctx;
    const taskId = args.task_id as string;
    const state = getImportTask(taskId, userId);
    // Tasks live in memory for a while after they finish; a restart forgets them.
    if (!state) throw new HttpError(404, "No such import: it may have finished a while ago, or the server restarted");
    return importStateOut(ctx, taskId, state);
  },
};

// What one call may carry: the JSON body /api/mcp takes is capped in app.ts, and base64 is a third bigger.
export const MCP_UPLOAD_MAX_BYTES = 24 * 1024 * 1024;
const MCP_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MB = 1024 * 1024;

function decodeBase64(base64: string, what: string): Buffer {
  // A data: URL's prefix is dropped, so either works. Checked first: Buffer.from skips what isn't base64.
  const encoded = base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new HttpError(400, `${what} isn't base64`);
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new HttpError(400, `${what} is empty or isn't base64`);
  return buffer;
}

const base64File = z.object({
  name: z.string().min(1).max(255).describe("The file's name with its extension, e.g. stringing-test.stl."),
  base64: z.string().min(1).describe("The file's contents, base64-encoded."),
});
const base64Images = z.array(z.string().min(1)).max(10).describe("Pictures of it (PNG, JPEG or WebP), base64-encoded.");

type DecodedFile = { name: string; buffer: Buffer };

/** The call's files and pictures, decoded and sized up before anything is written. */
function decodeUploads<F extends { name: string; base64: string }>(
  files: F[],
  images: string[],
): { files: (Omit<F, "base64"> & DecodedFile)[]; images: Buffer[] } {
  const decoded = files.map(({ base64, ...file }) => ({
    ...file,
    name: sanitizeFilename(file.name) || "model",
    buffer: decodeBase64(base64, file.name),
  }));
  const pictures = images.map((image, i) => decodeBase64(image, `Image ${i + 1}`));
  for (const file of decoded) {
    if (file.buffer.length > IMPORT_MAX_BYTES) throw new HttpError(413, `${file.name} is over the size limit`);
  }
  if (pictures.some((image) => image.length > MCP_IMAGE_MAX_BYTES)) {
    throw new HttpError(413, `Each image can be up to ${MCP_IMAGE_MAX_BYTES / MB} MB`);
  }
  const total = [...decoded.map((f) => f.buffer), ...pictures].reduce((sum, b) => sum + b.length, 0);
  if (total > MCP_UPLOAD_MAX_BYTES) throw new HttpError(413, `Up to ${MCP_UPLOAD_MAX_BYTES / MB} MB in all`);
  return { files: decoded, images: pictures };
}

/** Writes the files to a temp folder, removed once `use` is done with them. */
async function withTempFiles<F extends DecodedFile, T>(
  files: F[],
  use: (uploaded: (Omit<F, "buffer" | "name"> & UploadedFile)[]) => Promise<T>,
): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "thingport-mcp-upload-"));
  try {
    const uploaded = [];
    for (const { buffer, name, ...rest } of files) {
      // Each in its own name, so two files called the same don't overwrite each other here.
      const tempPath = path.join(dir, `${crypto.randomBytes(8).toString("hex")}${path.extname(name)}`);
      await fs.writeFile(tempPath, buffer);
      uploaded.push({ ...rest, path: tempPath, originalname: name });
    }
    return await use(uploaded);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const uploadModel: McpToolDefinition = {
  name: "upload_model",
  title: "Upload a model",
  description:
    "Add one model to the library from the user's own files, as + Add > Upload files does: e.g. a test piece or a " +
    "part a script generated. Its 3D files (STL, 3MF, STEP, OBJ) become its plates, any other file a supporting " +
    "file; with no 3D file among them, every file is a plate. " +
    `Files and images go as base64, up to ${MCP_UPLOAD_MAX_BYTES / MB} MB in all. Change it later with edit_model.`,
  readOnly: false,
  inputSchema: {
    files: z.array(base64File).min(1).max(20).describe("The model's files."),
    title: z.string().max(500).optional().describe("The model's title; the first file's name when left out."),
    description: z.string().max(50_000).optional().describe("Its description, in Markdown, e.g. print settings."),
    tags: z.array(z.string()).optional(),
    category_id: z.string().optional().describe("A category to file it in (an id from list_categories)."),
    collection_id: z.string().optional().describe("A collection to add it to (an id from list_collections)."),
    images: base64Images
      .optional()
      .describe("Pictures of it (PNG, JPEG or WebP), base64-encoded; the first is its cover."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const collectionId = args.collection_id as string | undefined;
    if (collectionId) await assertFilableCollection(userId, collectionId);
    const { files, images } = decodeUploads(
      args.files as { name: string; base64: string }[],
      (args.images as string[] | undefined) ?? [],
    );
    return withTempFiles(files, async (uploaded) => {
      const title = (args.title as string | undefined)?.trim() || null;
      const print = await createUploadedModel(
        userId,
        {
          title,
          notes: (args.description as string | undefined) || null,
          tags: (args.tags as string[] | undefined) ?? [],
          categoryId: (args.category_id as string | undefined) || null,
          categorySource: args.category_id ? "MANUAL" : null,
        },
        uploaded,
      );
      const imagesAdded = images.length ? (await addUploadedPreviewImages(print.id, images)).length : 0;
      const filed = collectionId ? (await addModelsToCollection(userId, collectionId, [print.id])).collection : null;
      await notifyUpload(userId, [{ id: print.id, name: print.title || print.name }]).catch((err) =>
        console.error("Upload notification failed:", err),
      );
      return {
        model: modelSummary(ctx, await printOutById(userId, print.id)),
        images_added: imagesAdded,
        images_skipped: images.length - imagesAdded,
        collection: filed ? { id: filed.id, name: filed.name } : null,
      };
    });
  },
};

const editModel: McpToolDefinition = {
  name: "edit_model",
  title: "Edit a model",
  description:
    "Change a model's details, as its page's Edit does: title, description, creator, tags, category and whether " +
    "it's a favourite. Only what's given changes. Tags are free text: a tag the library hasn't used yet is " +
    "created by giving it. Pictures change with edit_model_images, files with add_model_files and remove_model_file.",
  readOnly: false,
  destructive: true,
  idempotent: true,
  inputSchema: {
    model_id: z.string().min(1).describe("The model's id, from search_models or list_models."),
    title: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Its new title; it must not be taken by another model in the same category."),
    description: z.string().max(50_000).optional().describe("Its new description in Markdown, replacing the old."),
    creator: z.string().max(200).optional().describe("Who designed it, as free text; an empty string clears it."),
    tags: z.array(z.string()).max(200).optional().describe("Its tags, replacing every tag it has."),
    add_tags: z.array(z.string()).max(50).optional().describe("Tags to add to the ones it has."),
    remove_tags: z.array(z.string()).max(50).optional().describe("Tags to take off, in any case."),
    category_id: z
      .string()
      .nullable()
      .optional()
      .describe("A category to file it in (an id from list_categories or create_category), or null for none."),
    favorite: z.boolean().optional().describe("Make it a favourite, or no longer one."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const print = await prisma.print.findFirst({ where: { id: args.model_id as string, userId } });
    if (!print) throw new HttpError(404, "Print not found");
    const title = args.title as string | undefined;
    const categoryId = args.category_id as string | null | undefined;
    const tagArgs = [args.tags, args.add_tags, args.remove_tags] as (string[] | undefined)[];
    const changes = [title, args.description, args.creator, categoryId, args.favorite, ...tagArgs];
    if (changes.every((value) => value === undefined)) throw new HttpError(400, "Nothing to change");

    // Checked before anything is written, so a bad category or a taken name doesn't leave the edit half done.
    if (categoryId && !(await prisma.category.count({ where: { id: categoryId, userId } }))) {
      throw new HttpError(400, "Category not found");
    }
    if (title !== undefined || categoryId !== undefined) {
      await uniqueModelName(
        userId,
        title ?? print.name,
        categoryId === undefined ? print.categoryId : categoryId,
        print.id,
      );
    }

    const changed: string[] = [];
    const moving = categoryId !== undefined && categoryId !== print.categoryId;
    // With a new title, the move goes in the same write: the name is free in the new category, maybe not the old.
    const moveWithRename = moving && title !== undefined;
    if (title !== undefined || args.description !== undefined || args.creator !== undefined) {
      await updatePrintMeta(userId, print.id, {
        name: title,
        notes: args.description as string | undefined,
        creator: args.creator as string | undefined,
        categoryId: moveWithRename ? categoryId : undefined,
      });
      if (title !== undefined) changed.push("title");
      if (args.description !== undefined) changed.push("description");
      if (args.creator !== undefined) changed.push("creator");
    }
    if (tagArgs.some(Boolean)) {
      const [replace, add = [], remove = []] = tagArgs;
      const removed = new Set(normalizeTags(remove));
      const own = normalizeTags(replace ?? print.tags).filter((tag) => !removed.has(tag));
      const tags = normalizeTags([...own, ...add]);
      if (tags.join("\n") !== normalizeTags(print.tags).join("\n")) {
        await setPrintTags(userId, print.id, tags);
        changed.push("tags");
      }
    }
    if (moving && !moveWithRename) {
      const updated = await setPrintCategory(userId, print.id, categoryId, categoryId ? "MANUAL" : null, {
        clearSuggestion: true,
      });
      if (!updated) throw new HttpError(409, "Category changed concurrently");
      void createLog({
        userId,
        action: "model_edited",
        targetId: print.id,
        details: { field: "category", name: updated.name },
      });
      changed.push("category");
    }
    if (moveWithRename) changed.push("category");
    if (args.favorite !== undefined && args.favorite !== Boolean(print.favoritedAt)) {
      await prisma.print.update({ where: { id: print.id }, data: { favoritedAt: args.favorite ? new Date() : null } });
      changed.push("favorite");
    }

    const out = await printOutById(userId, print.id);
    return { model: { ...modelSummary(ctx, out), description: out.notes }, changed };
  },
};

// Bigger files come by their download_url instead: base64 a third bigger in the assistant's context costs a lot.
export const MCP_FILE_MAX_BYTES = 10 * 1024 * 1024;

type ModelFile = {
  id: string;
  name: string;
  kind: "plate" | "supporting" | "prepared";
  mime: string;
  size_bytes: number;
  /** Under /api; read with the token when it may read Model files. */
  apiPath: string;
  diskPath: () => string | null;
  /** Set on plates only. */
  profile?: PlateProfile | null;
};

/** Every file of one of the user's models: its plates, supporting files and sliced print. */
async function modelFiles(userId: string, modelId: string): Promise<ModelFile[]> {
  const print = await prisma.print.findFirst({
    where: { id: modelId, userId },
    include: { plates: { orderBy: { position: "asc" } }, files: { orderBy: { createdAt: "asc" } } },
  });
  if (!print) throw new HttpError(404, "Print not found");
  await ensurePlateProfiles(print.plates);
  const plates = print.plates.map((plate): ModelFile => ({
    id: plate.id,
    name: plate.filename,
    kind: "plate",
    mime: plate.mime || "application/octet-stream",
    size_bytes: plate.size,
    apiPath: `/print/${print.id}/plate/${plate.id}/file/${encodeURIComponent(plate.filename)}`,
    diskPath: () => resolvePlateFilePath(plate),
    profile: plateProfileOut(plate.profileMeta),
  }));
  const others = print.files.map((file): ModelFile => ({
    id: file.id,
    name: file.filename,
    kind: file.role === "PREPARED" ? "prepared" : "supporting",
    mime: file.mime || "application/octet-stream",
    size_bytes: file.size,
    apiPath: file.role === "PREPARED" ? `/print/${print.id}/prepared-print` : `/print/${print.id}/files/${file.id}`,
    diskPath: () => managedPrintFilePath(file),
  }));
  return [...plates, ...others];
}

function fileOut(ctx: McpToolContext, file: ModelFile) {
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    mime: file.mime,
    size_bytes: file.size_bytes,
    api_path: `/api${file.apiPath}`,
    download_url: ctx.publicUrl ? `${ctx.publicUrl}/api${file.apiPath}` : null,
    ...(file.profile !== undefined && { profile: file.profile }),
  };
}

const listModelFiles: McpToolDefinition = {
  name: "list_model_files",
  title: "List a model's files",
  description:
    "A model's files: its plates (the 3D files), supporting files and sliced print, each with the id get_model_file " +
    "takes. api_path (on the server's own address) or download_url, when the server knows its address, opens with " +
    "the same token as 'Authorization: Bearer' if it may read Model files. 3MF plates also carry their slicer " +
    "profile (title, printer, nozzle, layer height, materials, plates, and for a sliced file print time and weight per plate), each part null when the file doesn't say.",
  readOnly: true,
  inputSchema: { model_id: z.string().min(1).describe("The model's id, from search_models or list_models.") },
  async run(ctx, args) {
    const files = await modelFiles(ctx.userId, args.model_id as string);
    return { files: files.map((file) => fileOut(ctx, file)) };
  },
};

const getModelFile: McpToolDefinition = {
  name: "get_model_file",
  title: "Get a model file",
  description:
    `One of a model's files, base64-encoded, up to ${MCP_FILE_MAX_BYTES / MB} MB: e.g. to slice or convert it. ` +
    "Find its id with list_model_files. A bigger file comes without its contents; fetch it by its download_url or " +
    "api_path.",
  readOnly: true,
  inputSchema: {
    model_id: z.string().min(1).describe("The model's id."),
    file_id: z.string().min(1).describe("The file's id, from list_model_files."),
  },
  async run(ctx, args) {
    const files = await modelFiles(ctx.userId, args.model_id as string);
    const file = files.find((f) => f.id === args.file_id);
    if (!file) throw new HttpError(404, "File not found");
    const diskPath = file.diskPath();
    const stat = diskPath ? await fs.stat(diskPath).catch(() => null) : null;
    if (!diskPath || !stat?.isFile()) throw new HttpError(404, "The file is missing from storage");
    const out = { ...fileOut(ctx, file), size_bytes: stat.size };
    if (stat.size > MCP_FILE_MAX_BYTES) {
      return {
        ...out,
        base64: null,
        note: `Over ${MCP_FILE_MAX_BYTES / MB} MB: fetch it by its download_url or api_path.`,
      };
    }
    return { ...out, base64: (await fs.readFile(diskPath)).toString("base64") };
  },
};

const addModelFiles: McpToolDefinition = {
  name: "add_model_files",
  title: "Add files to a model",
  description:
    "Add files to one of the user's models, as its page's Add files does: e.g. a fixed version of a part, or a " +
    "variant. 3D files (STL, 3MF, STEP, OBJ) become plates, other files supporting files; a sliced print (G-code, " +
    "a sliced 3MF) takes the place of the model's own. `kind` overrides that. " +
    `Files go as base64, up to ${MCP_UPLOAD_MAX_BYTES / MB} MB in all.`,
  readOnly: false,
  destructive: true,
  inputSchema: {
    model_id: z.string().min(1).describe("The model's id, from search_models or list_models."),
    files: z
      .array(
        base64File.extend({
          kind: z
            .enum(["plate", "supporting"])
            .optional()
            .describe("plate (a 3D file to print) or supporting (anything else), when the extension doesn't say."),
        }),
      )
      .min(1)
      .max(20)
      .describe("The files to add."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const modelId = args.model_id as string;
    // Before decoding: a model that isn't there says so, not that a file is too big.
    if (!(await prisma.print.count({ where: { id: modelId, userId } }))) throw new HttpError(404, "Print not found");
    const { files } = decodeUploads(args.files as { name: string; base64: string; kind?: FileKind }[], []);
    const added = await withTempFiles(files, (uploaded) => addUploadedFiles(userId, modelId, uploaded));
    return {
      plates_added: added.plates,
      files_added: added.files,
      files: (await modelFiles(userId, modelId)).map((file) => fileOut(ctx, file)),
    };
  },
};

const removeModelFile: McpToolDefinition = {
  name: "remove_model_file",
  title: "Remove a model file",
  description:
    "Delete one of a model's files for good: a plate, a supporting file or its sliced print, by its id from " +
    "list_model_files. A model's only plate can't be removed. Only remove what the user asked to.",
  readOnly: false,
  destructive: true,
  inputSchema: {
    model_id: z.string().min(1).describe("The model's id."),
    file_id: z.string().min(1).describe("The file's id, from list_model_files."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const modelId = args.model_id as string;
    const file = (await modelFiles(userId, modelId)).find((f) => f.id === args.file_id);
    if (!file) throw new HttpError(404, "File not found");
    if (file.kind === "plate") {
      const print = await prisma.print.findFirstOrThrow({ where: { id: modelId, userId } });
      await removePlate(print, file.id);
    } else if (file.kind === "prepared") {
      await deletePreparedFile(userId, modelId);
    } else {
      await deleteSupportingFile(userId, modelId, file.id);
    }
    return {
      removed: { id: file.id, name: file.name, kind: file.kind },
      files: (await modelFiles(userId, modelId)).map((f) => fileOut(ctx, f)),
    };
  },
};

/** One of the user's models' gallery, cover first. */
async function modelImages(ctx: McpToolContext, modelId: string) {
  const print = await prisma.print.findFirst({ where: { id: modelId, userId: ctx.userId }, select: { id: true } });
  if (!print) throw new HttpError(404, "Print not found");
  const images = await prisma.previewImage.findMany({ where: { printId: print.id }, orderBy: { position: "asc" } });
  return images.map((image, i) => {
    const apiPath = `/preview-image/${image.id}/file.jpg`;
    return {
      id: image.id,
      cover: i === 0,
      generated: image.generated,
      api_path: `/api${apiPath}`,
      download_url: ctx.publicUrl ? `${ctx.publicUrl}/api${apiPath}` : null,
    };
  });
}

// Small enough that a gallery costs the assistant little, big enough to tell pictures apart.
const PICTURE_SIZE = 512;
const MAX_PICTURES = 8;

/** The pictures themselves, scaled down; one that's missing from storage is left out. */
async function picturesOf(userId: string, ids: string[]) {
  const rows = await prisma.previewImage.findMany({
    where: { id: { in: ids }, print: { userId } },
    include: { print: { select: { assetsPath: true } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pictures = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) continue;
    const jpeg = await sharp(previewImagePath(row.id, row.print.assetsPath))
      .resize(PICTURE_SIZE, PICTURE_SIZE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer()
      .catch(() => null);
    if (jpeg) pictures.push({ data: jpeg.toString("base64"), mimeType: "image/jpeg" });
  }
  return pictures;
}

const listModelImages: McpToolDefinition = {
  name: "list_model_images",
  title: "List a model's pictures",
  description:
    "A model's pictures in the order its page shows them, the cover first, each with the id edit_model_images " +
    "takes. `generated` marks Thingport's own render of the model, there only while it has no picture of its own. " +
    `With include_pictures, the first ${MAX_PICTURES} also come as images to look at, scaled down, in the same order. ` +
    "api_path or download_url opens with the same token as 'Authorization: Bearer' if it may read Images.",
  readOnly: true,
  inputSchema: {
    model_id: z.string().min(1).describe("The model's id, from search_models or list_models."),
    include_pictures: z
      .boolean()
      .optional()
      .describe("Also show the pictures, e.g. to pick the best cover or describe the model."),
  },
  async run(ctx, args) {
    const images = await modelImages(ctx, args.model_id as string);
    if (!args.include_pictures) return { images };
    const shown = images.slice(0, MAX_PICTURES);
    return new WithImages(
      { images, pictures_shown: shown.length },
      await picturesOf(
        ctx.userId,
        shown.map((image) => image.id),
      ),
    );
  },
};

const editModelImages: McpToolDefinition = {
  name: "edit_model_images",
  title: "Edit a model's pictures",
  description:
    "Add pictures to a model, remove some, or change their order, as its page's gallery does. The first picture is " +
    "the model's cover and card picture. Find the ids with list_model_images. Removing deletes a picture for good: " +
    `only remove what the user asked to. Pictures go as base64, up to ${MCP_UPLOAD_MAX_BYTES / MB} MB in all.`,
  readOnly: false,
  destructive: true,
  inputSchema: {
    model_id: z.string().min(1).describe("The model's id, from search_models or list_models."),
    add: base64Images.optional().describe("Pictures to add (PNG, JPEG or WebP), base64-encoded, after the others."),
    added_first: z
      .boolean()
      .optional()
      .describe("Put the added pictures before the others, so the first of them becomes the cover."),
    remove: z.array(z.string().min(1)).max(100).optional().describe("Ids of pictures to delete."),
    order: z
      .array(z.string().min(1))
      .max(100)
      .optional()
      .describe("Ids in the order to show them, the cover first; the ones left out follow in their current order."),
  },
  async run(ctx, args) {
    const modelId = args.model_id as string;
    const remove = new Set((args.remove as string[] | undefined) ?? []);
    const order = (args.order as string[] | undefined) ?? [];
    const { images } = decodeUploads([], (args.add as string[] | undefined) ?? []);
    if (!images.length && !remove.size && !order.length) throw new HttpError(400, "Nothing to change");

    // Every id is checked before anything is written.
    const current = new Set((await modelImages(ctx, modelId)).map((image) => image.id));
    const unknown = [...remove, ...order].filter((id) => !current.has(id));
    if (unknown.length) throw new HttpError(404, `No such picture on this model: ${unknown.join(", ")}`);
    if (order.some((id) => remove.has(id))) throw new HttpError(400, "A picture can't be both removed and ordered");
    if (new Set(order).size !== order.length) throw new HttpError(400, "A picture can be in the order only once");

    for (const id of remove) await removePreviewImage(modelId, id);
    const added = images.length ? await addUploadedPreviewImages(modelId, images) : [];
    if (order.length || (args.added_first && added.length)) {
      // Adding the first picture drops Thingport's own render, so the order is built from what's there now.
      const now = (await modelImages(ctx, modelId)).map((image) => image.id);
      const listed = order.filter((id) => now.includes(id));
      const rest = now.filter((id) => !listed.includes(id) && !added.includes(id));
      const front = args.added_first ? [...added, ...listed] : listed;
      await reorderPreviewImages(modelId, [...front, ...rest, ...(args.added_first ? [] : added)]);
    }
    return {
      added: added.length,
      skipped: images.length - added.length,
      removed: remove.size,
      images: await modelImages(ctx, modelId),
    };
  },
};

const renameModelFile: McpToolDefinition = {
  name: "rename_model_file",
  title: "Rename a model file",
  description:
    "Rename one of a model's plates (its 3D files), by its id from list_model_files. A name another plate has gets " +
    "a number added; the extension should stay the same.",
  readOnly: false,
  destructive: true,
  idempotent: true,
  inputSchema: {
    model_id: z.string().min(1).describe("The model's id."),
    file_id: z.string().min(1).describe("The plate's id, from list_model_files."),
    name: z.string().trim().min(1).max(255).describe("Its new name with its extension, e.g. bracket-left.stl."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const modelId = args.model_id as string;
    const file = (await modelFiles(userId, modelId)).find((f) => f.id === args.file_id);
    if (!file) throw new HttpError(404, "File not found");
    if (file.kind !== "plate") throw new HttpError(400, "Only a plate can be renamed");
    const print = await prisma.print.findFirstOrThrow({ where: { id: modelId, userId } });
    const name = await renamePlate(print, file.id, args.name as string);
    return { id: file.id, name, previous_name: file.name };
  },
};

const deleteModel: McpToolDefinition = {
  name: "delete_model",
  title: "Delete a model",
  description:
    "Delete a model from the library for good, with its files and pictures, as its page's Delete does. There's no " +
    "undo: only delete what the user asked to, and say which model it is first.",
  readOnly: false,
  destructive: true,
  inputSchema: { model_id: z.string().min(1).describe("The model's id, from search_models or list_models.") },
  async run(ctx, args) {
    const print = await prisma.print.findFirst({ where: { id: args.model_id as string, userId: ctx.userId } });
    if (!print) throw new HttpError(404, "Print not found");
    await deletePrint(ctx.userId, print.id);
    return { deleted: { id: print.id, title: print.title || print.name } };
  },
};

const createCategoryTool: McpToolDefinition = {
  name: "create_category",
  title: "Create a category",
  description:
    "Create a category or folder in the user's tree, e.g. to file a model under a new one with edit_model or " +
    "upload_model. Look with list_categories first, and create one only when nothing there fits.",
  readOnly: false,
  inputSchema: {
    name: z.string().trim().min(1).max(200).describe("The category's name."),
    parent_id: z.string().optional().describe("The category to put it under (an id from list_categories)."),
    kind: z
      .enum(CATEGORY_KINDS)
      .optional()
      .describe("For a top-level one: category (by what models are) or folder (the user's own grouping, the default)."),
    tags: z.array(z.string()).max(50).optional(),
  },
  async run(ctx, args) {
    const category = await createCategory(ctx.userId, {
      name: args.name as string,
      parentId: (args.parent_id as string | undefined) ?? null,
      kind: args.kind as CategoryKind | undefined,
      tags: args.tags as string[] | undefined,
    });
    return { id: category.id, name: category.name, parent_id: category.parentId, kind: category.kind };
  },
};

const createCollectionTool: McpToolDefinition = {
  name: "create_collection",
  title: "Create a collection",
  description: "Create a new, empty collection. Fill it with add_to_collection.",
  readOnly: false,
  inputSchema: {
    name: z.string().trim().min(1).max(200).describe("The collection's name; it must not already be taken."),
    description: z.string().trim().max(2000).optional(),
    tags: z.array(z.string()).optional(),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const collection = await createCollection(userId, {
      name: args.name as string,
      description: (args.description as string | undefined) ?? null,
      tags: args.tags as string[] | undefined,
    });
    return { id: collection.id, name: collection.name, description: collection.description, tags: collection.tags };
  },
};

const addToCollection: McpToolDefinition = {
  name: "add_to_collection",
  title: "Add models to a collection",
  description:
    "Add models from the library to one of the user's collections. Models already in it stay as they are; take " +
    "them out with remove_from_collection.",
  readOnly: false,
  idempotent: true,
  inputSchema: {
    collection_id: z.string().min(1).describe("The collection, an id from list_collections."),
    model_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(100)
      .describe("The models, ids from search_models or list_models."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const result = await addModelsToCollection(userId, args.collection_id as string, args.model_ids as string[]);
    return {
      collection: { id: result.collection.id, name: result.collection.name },
      added: result.added,
      already_in: result.alreadyIn,
      not_found: result.notFound,
    };
  },
};

const removeFromCollection: McpToolDefinition = {
  name: "remove_from_collection",
  title: "Remove models from a collection",
  description:
    "Take models out of one of the user's collections. The models stay in the library; only their place in the " +
    "collection goes.",
  readOnly: false,
  destructive: true,
  idempotent: true,
  inputSchema: {
    collection_id: z.string().min(1).describe("The collection, an id from list_collections."),
    model_ids: z.array(z.string().min(1)).min(1).max(100).describe("The models, ids from get_collection."),
  },
  async run(ctx, args) {
    const result = await removeModelsFromCollection(
      ctx.userId,
      args.collection_id as string,
      args.model_ids as string[],
    );
    return {
      collection: { id: result.collection.id, name: result.collection.name },
      removed: result.removed,
      not_in_it: result.notIn,
    };
  },
};

const widgetGuide: McpToolDefinition = {
  name: "widget_guide",
  title: "How to write a dashboard widget",
  description:
    "Read this before writing a custom dashboard widget: its metadata, the script's `thingport` argument, its " +
    "labels and how they translate its settings, the libraries it can borrow, the rules, and how to share it with " +
    "screenshots. Then save it with save_widget.",
  readOnly: true,
  idempotent: true,
  inputSchema: {},
  async run() {
    return { guide: CUSTOM_WIDGET_GUIDE };
  },
};

const listWidgets: McpToolDefinition = {
  name: "list_widgets",
  title: "List my dashboard widgets",
  description:
    "The user's custom dashboard widgets: their own and those installed from the community, with each one's " +
    "metadata, and with `include_code` its script, HTML and labels too, e.g. to change one.",
  readOnly: true,
  idempotent: true,
  inputSchema: {
    include_code: z.boolean().optional().describe("Also return each widget's script, HTML and labels."),
  },
  async run(ctx, args) {
    const widgets = await listCustomWidgets(ctx.userId, await enabledWidgetSources());
    return {
      widgets: widgets.map((widget) => ({
        id: widget.id,
        slug: widget.slug,
        source: widget.source,
        metadata: widget.manifest,
        script: args.include_code ? widget.script : undefined,
        html: args.include_code ? widget.html : undefined,
        locales: args.include_code ? widget.locales : undefined,
      })),
    };
  },
};

const saveWidget: McpToolDefinition = {
  name: "save_widget",
  title: "Save a dashboard widget",
  description:
    "Create one of the user's own dashboard widgets, or replace the one with the same slug. Read widget_guide first. " +
    "Its script runs in the user's dashboard with their access, so write only what the user asked for. Keep every " +
    "word it shows in `locales` rather than in the script, including the labels its settings use. Screenshots " +
    "belong only to a widget shared through the repository, which carries the files, so leave them out here. The " +
    "user then adds it from Add panel while editing their dashboard.",
  readOnly: false,
  defaultOn: true,
  destructive: true,
  idempotent: true,
  inputSchema: {
    slug: z
      .string()
      .describe("The widget's folder name: 2-40 lowercase letters, digits and dashes, e.g. print-farm-status."),
    metadata: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .describe("The metadata, as an object, or as JSON or YAML text."),
    script: z.string().describe("The ES module; its `export default` function draws the widget."),
    html: z.string().optional().describe("Markup put into the panel before the script runs, e.g. a <style>."),
    locales: z
      .record(z.string(), z.record(z.string(), z.string()))
      .optional()
      .describe('The words it shows, by language: `{ "en": { "wind.label": "Wind" } }`. English is the fallback.'),
  },
  async run(ctx, args) {
    await assertWidgetSourceEnabled("own");
    const metadata = args.metadata;
    const manifest = typeof metadata === "string" ? parseManifest(metadata) : validateManifest(metadata);
    const locales = args.locales ? localesSchema.parse(args.locales) : undefined;
    const widget = await saveOwnWidget(ctx.userId, {
      slug: args.slug as string,
      manifest,
      script: args.script as string,
      html: (args.html as string | undefined) ?? null,
      locales,
    });
    return {
      id: widget.id,
      slug: widget.slug,
      name: widget.manifest.name,
      languages: Object.keys(widget.locales),
      next: "Ask the user to open their dashboard, choose Edit, then Add panel, and pick the widget.",
    };
  },
};

/** The user as the tools service wants them: what they may do with tools depends on their role as well. */
async function toolUser(ctx: McpToolContext) {
  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { id: true, role: true } });
  if (!user) throw new HttpError(404, "No such user");
  return user;
}

const toolGuide: McpToolDefinition = {
  name: "tool_guide",
  title: "How to write a tool",
  description:
    "Read this before writing a tool for the user's Tools page: its metadata, the script's `thingport` argument, " +
    "the labels, the libraries it can borrow, and the rules. Then save it with save_tool.",
  readOnly: true,
  idempotent: true,
  inputSchema: {},
  async run() {
    return { guide: TOOL_GUIDE };
  },
};

const listToolsTool: McpToolDefinition = {
  name: "list_tools",
  title: "List my tools",
  description:
    "The tools the user can open from their Tools page: their own and those an admin installed from the Thingport " +
    "repository, with each one's metadata, and with `include_code` its script, HTML and labels too, e.g. to change " +
    "one of theirs.",
  readOnly: true,
  idempotent: true,
  inputSchema: {
    include_code: z.boolean().optional().describe("Also return each tool's script, HTML and labels."),
  },
  async run(ctx, args) {
    const { access, tools } = await listUserTools(await toolUser(ctx));
    return {
      can_use: access.canUse,
      can_create: access.canCreate,
      // Saving fails without this, so an assistant asked to write one should say which setting the user needs.
      note: access.canCreate
        ? undefined
        : access.canUse
          ? "Users' own tools are off on this Thingport: an admin turns them on under Administration > Tools."
          : "Tools aren't available to this user: an admin turns them on under Administration > Tools.",
      tools: tools.map((tool) => ({
        id: tool.id,
        slug: tool.slug,
        source: tool.source,
        metadata: tool.manifest,
        updated_at: tool.updatedAt,
        script: args.include_code ? tool.script : undefined,
        html: args.include_code ? tool.html : undefined,
        locales: args.include_code ? tool.locales : undefined,
      })),
    };
  },
};

const saveToolTool: McpToolDefinition = {
  name: "save_tool",
  title: "Save a tool",
  description:
    "Create one of the user's own tools, or replace the one with the same slug. Read tool_guide first. Its script " +
    "runs in the user's browser with their access to Thingport, so write only what the user asked for. They then " +
    "open it from Tools in the sidebar.",
  readOnly: false,
  defaultOn: true,
  destructive: true,
  idempotent: true,
  inputSchema: {
    slug: z.string().describe("The tool's folder name: 2-40 lowercase letters, digits and dashes, e.g. label-maker."),
    metadata: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .describe("The metadata, as an object, or as JSON or YAML text."),
    script: z.string().describe("The ES module; its `export default` function is called with `thingport`."),
    html: z.string().optional().describe("Markup and a <style> block put into the window before the script runs."),
    locales: z
      .record(z.string(), z.record(z.string(), z.string()))
      .optional()
      .describe('The words it shows, by language: `{ "en": { "save.title": "Save" } }`. English is the fallback.'),
  },
  async run(ctx, args) {
    const metadata = args.metadata;
    const manifest = typeof metadata === "string" ? parseToolManifest(metadata) : validateToolManifest(metadata);
    const locales = args.locales ? toolLocalesSchema.parse(args.locales) : undefined;
    const tool = await saveOwnTool(await toolUser(ctx), {
      slug: args.slug as string,
      manifest,
      script: args.script as string,
      html: (args.html as string | undefined) ?? null,
      locales,
    });
    return {
      id: tool.id,
      slug: tool.slug,
      name: tool.manifest.name,
      languages: Object.keys(tool.locales),
      next: "Ask the user to open Tools in the sidebar and double-click the tool.",
    };
  },
};

// Generated from the frontend's icon browser: `npm run icons:sync` in frontend/.
type BuiltinIcon = { value: string; name: string; group: string; keywords?: string };
const builtinIcons: BuiltinIcon[] = BUILTIN_ICONS;

const listIconsTool: McpToolDefinition = {
  name: "list_icons",
  title: "Find an icon",
  description:
    "Thingport's own icons and those the user uploaded, as the icon browser shows them: e.g. for a widget's " +
    "`iconUrl`. Search by name, such as `octoprint` or `timer`; each comes with the `value` to use.",
  readOnly: true,
  idempotent: true,
  inputSchema: {
    query: z.string().max(100).optional().describe("Words in the icon's name, e.g. `jellyfin` or `calendar`."),
    limit: pageArgs.limit,
  },
  async run(ctx, args) {
    const words = String(args.query ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const matches = (...texts: (string | undefined)[]) => {
      const haystack = texts.join(" ").toLowerCase();
      return words.every((word) => haystack.includes(word));
    };
    const uploaded = (await listUserIcons(ctx.userId))
      .filter((icon) => matches(icon.name))
      .map((icon) => ({ value: icon.url, name: icon.name, group: "uploaded" }));
    const builtin = builtinIcons
      .filter((icon) => matches(icon.name, icon.value, icon.keywords))
      .map(({ value, name, group }) => ({ value, name, group }));
    const all = [...uploaded, ...builtin];
    return { icons: all.slice(0, (args.limit as number | undefined) ?? MAX_PAGE), total: all.length };
  },
};

const uploadIcon: McpToolDefinition = {
  name: "upload_icon",
  title: "Upload an icon",
  description:
    "Keep an image as one of the user's icons, as the icon browser's Upload does: an SVG as text, or a PNG, JPEG or " +
    `WebP as base64, up to ${ICON_MAX_BYTES / 1024 / 1024} MB. Returns its \`value\`, to use as a widget's ` +
    "`iconUrl`. Look with list_icons first, and upload only when nothing there fits.",
  readOnly: false,
  defaultOn: true,
  inputSchema: {
    name: z.string().min(1).max(80).describe("What the icon shows, e.g. `print farm`."),
    svg: z.string().optional().describe("The SVG's markup. Prefer this: it stays sharp at every size."),
    base64: z.string().optional().describe("A PNG, JPEG or WebP, base64-encoded, when it isn't an SVG."),
  },
  async run(ctx, args) {
    const svg = args.svg as string | undefined;
    const base64 = args.base64 as string | undefined;
    if (!svg === !base64) throw new HttpError(400, "Give the icon as `svg` or as `base64`, one of them");
    const buffer = svg ? Buffer.from(svg, "utf8") : Buffer.from(base64!, "base64");
    const icon = await saveIcon(ctx.userId, { buffer, originalname: args.name as string });
    return { value: icon.url, name: icon.name };
  },
};

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  searchModels,
  listModels,
  getModel,
  listCollections,
  getCollection,
  listTags,
  listCategories,
  getAuthor,
  libraryStats,
  listModelFiles,
  getModelFile,
  listModelImages,
  getImportStatus,
  importModel,
  uploadModel,
  editModel,
  editModelImages,
  addModelFiles,
  removeModelFile,
  renameModelFile,
  deleteModel,
  createCategoryTool,
  createCollectionTool,
  addToCollection,
  removeFromCollection,
  widgetGuide,
  listWidgets,
  saveWidget,
  toolGuide,
  listToolsTool,
  saveToolTool,
  listIconsTool,
  uploadIcon,
];

export const MCP_TOOL_NAMES = MCP_TOOLS.map((tool) => tool.name);

/** The tools the instance's MCP access lets a token reach, ticked or not. */
export function mcpToolsFor(access: McpAccess): readonly McpToolDefinition[] {
  if (access === "off") return [];
  return access === "read" ? MCP_TOOLS.filter((tool) => tool.readOnly) : MCP_TOOLS;
}

/** What the profile page offers to tick under this access. */
export function mcpToolCatalog(access: McpAccess) {
  return mcpToolsFor(access).map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    read_only: tool.readOnly,
  }));
}

/** What a new token gets when its user doesn't choose: every tool that only reads, and the `defaultOn` ones. */
export const DEFAULT_MCP_TOOL_NAMES = MCP_TOOLS.filter((tool) => tool.readOnly || tool.defaultOn).map(
  (tool) => tool.name,
);
