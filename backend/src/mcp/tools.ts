import { z } from "zod";
import { prisma } from "../db";
import { toAuthorOut, type PrintOut } from "../dto";
import { HttpError } from "../utils/fileUtils";
import type { McpAccess } from "../services/settingsService";
import {
  addModelsToCollection,
  createCollection,
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

// The tools /api/mcp offers. Each runs as the token's user, through the same services as the REST
// API, so it sees exactly that user's library. Outputs are trimmed to what an assistant can use:
// no image or file URLs, which need a session to open anyway.
//
// A token reaches only the tools its user ticked (see routes/mcp.ts). A tool that writes must say so with
// `readOnly: false`: it's then off for every token until its user turns it on.

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
  /** Calling it again with the same arguments changes nothing more. */
  idempotent?: boolean;
  /** Reaches outside this Thingport, e.g. a provider's site. */
  openWorld?: boolean;
  inputSchema: z.ZodRawShape;
  run: (ctx: McpToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

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
    "imported from, and how often it was viewed and printed.",
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

const importModel: McpToolDefinition = {
  name: "import_model",
  title: "Import a model",
  description:
    "Import a model into the library from its page on a supported site (MakerWorld, Printables, Thingiverse and " +
    "the others Thingport supports), as + Add > Import does. A model already in the library isn't imported twice. " +
    "Usually finishes in the call; a long import returns a task_id to check with get_import_status.",
  readOnly: false,
  idempotent: true,
  openWorld: true,
  inputSchema: {
    url: z.string().min(1).describe("The model's page, e.g. https://www.printables.com/model/3161-3d-benchy"),
    title: z.string().max(500).optional().describe("A title to use instead of the site's."),
    tags: z.array(z.string()).optional().describe("Tags to use instead of the site's."),
    category_id: z.string().optional().describe("A category to file it in (an id from list_categories)."),
    collection_id: z.string().optional().describe("A collection to add it to (an id from list_collections)."),
  },
  async run(ctx, args) {
    const { userId } = ctx;
    const collectionId = args.collection_id as string | undefined;
    // Checked first, so a bad collection doesn't leave an import half done.
    if (collectionId) {
      if (isSystemCollectionId(collectionId)) throw new HttpError(400, "Models can't be added to that collection");
      const owned = await prisma.collection.count({ where: { id: collectionId, userId } });
      if (!owned) throw new HttpError(404, "Collection not found");
    }
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
    "Add models from the library to one of the user's collections. Models already in it stay as they are. " +
    "Nothing is ever removed.",
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
  getImportStatus,
  importModel,
  createCollectionTool,
  addToCollection,
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

/** What a new token gets when its user doesn't choose: every tool that only reads. */
export const DEFAULT_MCP_TOOL_NAMES = MCP_TOOLS.filter((tool) => tool.readOnly).map((tool) => tool.name);
