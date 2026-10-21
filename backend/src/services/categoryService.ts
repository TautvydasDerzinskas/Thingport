import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../utils/fileUtils";
import { DEFAULT_CATEGORIES, type DefaultCategoryNode } from "../seedData/defaultCategories";
import { availableModelName, reorganizeManagedPrints, sanitizePathSegment } from "./printService";

export const CATEGORY_KINDS = ["category", "folder"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/** A new or moved category takes its parent's kind; a top-level one keeps `fallback`. */
export async function kindUnder(userId: string, parentId: string | null, fallback: string): Promise<string> {
  if (!parentId) return fallback;
  const parent = await prisma.category.findFirst({ where: { id: parentId, userId }, select: { kind: true } });
  return parent?.kind ?? fallback;
}

/** Keeps a moved subtree's kind in line with its new top-level ancestor. */
export async function setSubtreeKind(userId: string, rootId: string, kind: string): Promise<void> {
  const ids: string[] = [];
  let frontier = [rootId];
  while (frontier.length) {
    ids.push(...frontier);
    const children = await prisma.category.findMany({
      where: { userId, parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
  }
  await prisma.category.updateMany({ where: { userId, id: { in: ids } }, data: { kind } });
}

/** Any depth is allowed; only cycles are rejected (a category under itself or its own descendant). */
export async function validateParentCategory(
  userId: string,
  parentId: string | null | undefined,
  categoryId?: string | null,
): Promise<string | null> {
  if (!parentId) return null;
  const parent = await prisma.category.findFirst({ where: { id: parentId, userId } });
  if (!parent) throw new HttpError(400, "Parent category not found");
  if (categoryId && parentId === categoryId) throw new HttpError(400, "Category cannot be its own parent");

  if (categoryId) {
    // `visited` guards against a cycle already in the data.
    const visited = new Set<string>();
    let ancestorId = parent.parentId;
    while (ancestorId && !visited.has(ancestorId)) {
      if (ancestorId === categoryId) {
        throw new HttpError(400, "A category cannot be moved under one of its own subcategories");
      }
      visited.add(ancestorId);
      const ancestor = await prisma.category.findFirst({
        where: { id: ancestorId, userId },
        select: { parentId: true },
      });
      ancestorId = ancestor?.parentId ?? null;
    }
  }

  return parentId;
}

/** A default category's own fields, without its place in the tree. */
function defaultCategoryData(node: DefaultCategoryNode) {
  return {
    name: node.name,
    kind: "category",
    tags: node.tags ?? [],
    metaTitle: node.metaTitle ?? null,
    metaDescription: node.metaDescription ?? null,
    makerworldCatIds: node.makerworldCatIds ?? [],
    thingiverseCatIds: node.thingiverseCatIds ?? [],
    printablesCatIds: node.printablesCatIds ?? [],
    myminifactoryCatIds: node.myminifactoryCatIds ?? [],
    snapmakerCatIds: node.snapmakerCatIds ?? [],
    makeronlineCatIds: node.makeronlineCatIds ?? [],
    crealitycloudCatIds: node.crealitycloudCatIds ?? [],
    nexprintCatIds: node.nexprintCatIds ?? [],
    thangsCatIds: node.thangsCatIds ?? [],
    cults3dCatIds: node.cults3dCatIds ?? [],
  };
}

/** Takes a Prisma client so it can run in the user-creation transaction. */
export async function seedDefaultCategories(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  async function createNode(node: DefaultCategoryNode, parentId: string | null, position: number): Promise<void> {
    const category = await tx.category.create({ data: { userId, parentId, position, ...defaultCategoryData(node) } });
    for (const [i, child] of (node.children ?? []).entries()) await createNode(child, category.id, i);
  }

  for (const [i, root] of DEFAULT_CATEGORIES.entries()) await createNode(root, null, i);
}

const pathKey = (parentKey: string, name: string) => `${parentKey}/${name.trim().toLowerCase()}`;

/** What a reset to the starter categories would do. Planned and applied from the same rows, so a preview matches. */
type ResetPlan = {
  /** Path key of every default category to the existing one it keeps, if any. */
  matches: Map<string, string>;
  /** Defaults that would be created. */
  added: string[][];
  /** Kept ones whose name, details, site ids or place differ from the default. */
  restored: string[][];
  removed: { id: string; path: string[]; models: number }[];
  /** Models in removed categories and where each would go: the nearest kept ancestor, or out of any category. */
  moves: { id: string; name: string; target: string | null }[];
  /** How many of the moved models would be renamed for clashing with one already in their new category. */
  renamed: number;
};

async function planCategoryReset(db: Prisma.TransactionClient, userId: string): Promise<ResetPlan> {
  const existing = await db.category.findMany({
    where: { userId, kind: "category" },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
  const byId = new Map(existing.map((c) => [c.id, c]));
  const childrenOf = new Map<string | null, typeof existing>();
  for (const c of existing) {
    const parentId = c.parentId && byId.has(c.parentId) ? c.parentId : null;
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), c]);
  }
  // With duplicate names on one path, the first in display order is the one kept.
  const byPath = new Map<string, string>();
  const pathOf = new Map<string, string[]>();
  const index = (parentId: string | null, parentKey: string, parentPath: string[]) => {
    for (const c of childrenOf.get(parentId) ?? []) {
      const key = pathKey(parentKey, c.name);
      if (!byPath.has(key)) byPath.set(key, c.id);
      pathOf.set(c.id, [...parentPath, c.name]);
      index(c.id, key, [...parentPath, c.name]);
    }
  };
  index(null, "", []);

  const matches = new Map<string, string>();
  const added: string[][] = [];
  const restored: string[][] = [];
  // `parentId` is undefined under a category that would be new, which no existing one sits under.
  const walk = (
    nodes: DefaultCategoryNode[],
    parentKey: string,
    parentId: string | null | undefined,
    parentPath: string[],
  ) => {
    for (const [position, node] of nodes.entries()) {
      const key = pathKey(parentKey, node.name);
      const path = [...parentPath, node.name];
      const match = byPath.get(key);
      if (match) {
        matches.set(key, match);
        const c = byId.get(match)!;
        const fields = defaultCategoryData(node);
        const same =
          c.parentId === parentId &&
          c.position === position &&
          (Object.keys(fields) as (keyof typeof fields)[]).every(
            (k) => JSON.stringify(c[k]) === JSON.stringify(fields[k]),
          );
        if (!same) restored.push(path);
      } else {
        added.push(path);
      }
      walk(node.children ?? [], key, match, path);
    }
  };
  walk(DEFAULT_CATEGORIES, "", null, []);

  const kept = new Set(matches.values());
  const removedRows = existing.filter((c) => !kept.has(c.id));
  const removedIds = removedRows.map((c) => c.id);
  const prints = removedIds.length
    ? await db.print.findMany({
        where: { userId, categoryId: { in: removedIds } },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, categoryId: true },
      })
    : [];
  const keptAncestor = (id: string): string | null => {
    const seen = new Set<string>();
    let current = byId.get(id)?.parentId ?? null;
    while (current && !kept.has(current) && !seen.has(current)) {
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return current && kept.has(current) ? current : null;
  };
  const moves = prints.map((p) => ({ id: p.id, name: p.name, target: keptAncestor(p.categoryId!) }));
  const modelsIn = new Map<string, number>();
  for (const p of prints) modelsIn.set(p.categoryId!, (modelsIn.get(p.categoryId!) ?? 0) + 1);

  // A moved model is renamed as availableModelName will at reset: suffixed past names taken where it lands, by a model
  // there or one moved earlier.
  let renamed = 0;
  if (moves.length) {
    const targets = [...new Set(moves.map((m) => m.target).filter((t): t is string => t !== null))];
    const staying = await db.print.findMany({
      where: {
        userId,
        OR: [{ categoryId: { in: targets } }, ...(moves.some((m) => !m.target) ? [{ categoryId: null }] : [])],
      },
      select: { categoryId: true, nameNormalized: true },
    });
    const taken = new Set(staying.map((p) => `${p.categoryId}\u0000${p.nameNormalized}`));
    for (const m of moves) {
      const base = sanitizePathSegment(m.name, "Model");
      let candidate = base;
      for (let suffix = 2; taken.has(`${m.target}\u0000${candidate.trim().toLowerCase()}`); suffix++) {
        candidate = `${base} (${suffix})`;
      }
      taken.add(`${m.target}\u0000${candidate.trim().toLowerCase()}`);
      if (candidate !== m.name) renamed++;
    }
  }

  return {
    matches,
    added,
    restored,
    removed: removedRows.map((c) => ({
      id: c.id,
      path: pathOf.get(c.id) ?? [c.name],
      models: modelsIn.get(c.id) ?? 0,
    })),
    moves,
    renamed,
  };
}

export type CategoryResetPreview = {
  added: string[][];
  restored: string[][];
  removed: { path: string[]; models: number }[];
  models_moved: number;
  models_uncategorized: number;
  models_renamed: number;
};

/** What resetting the category tree (not folders) to the starter one would change; all empty when it's already that. */
export async function previewCategoryReset(userId: string): Promise<CategoryResetPreview> {
  const plan = await planCategoryReset(prisma, userId);
  return {
    added: plan.added,
    restored: plan.restored,
    removed: plan.removed.map(({ path, models }) => ({ path, models })),
    models_moved: plan.moves.filter((m) => m.target).length,
    models_uncategorized: plan.moves.filter((m) => !m.target).length,
    models_renamed: plan.renamed,
  };
}

/**
 * Puts the user's category tree (not folders) back to the starter one. A category whose name path matches a default
 * one is kept, with its models, and gets the default's details, site ids and place back; missing defaults are
 * created; the rest are deleted, their models moving to the nearest kept ancestor, or out of any category.
 */
export async function resetDefaultCategories(userId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const plan = await planCategoryReset(tx, userId);
      const restore = async (nodes: DefaultCategoryNode[], parentId: string | null, parentKey: string) => {
        for (const [position, node] of nodes.entries()) {
          const key = pathKey(parentKey, node.name);
          const data = { parentId, position, ...defaultCategoryData(node) };
          const match = plan.matches.get(key);
          const id = match
            ? (await tx.category.update({ where: { id: match }, data, select: { id: true } })).id
            : (await tx.category.create({ data: { userId, ...data }, select: { id: true } })).id;
          await restore(node.children ?? [], id, key);
        }
      };
      await restore(DEFAULT_CATEGORIES, null, "");

      for (const move of plan.moves) {
        const name = await availableModelName(userId, move.name, move.target, move.id, tx);
        const data: Prisma.PrintUncheckedUpdateInput = { categoryId: move.target };
        // Out of any category, nothing chose where the model is any more.
        if (!move.target) data.categorySource = null;
        if (name !== move.name) Object.assign(data, { name, nameNormalized: name.trim().toLowerCase(), title: name });
        await tx.print.update({ where: { id: move.id }, data });
      }
      if (plan.removed.length) {
        await tx.category.deleteMany({ where: { userId, id: { in: plan.removed.map((r) => r.id) } } });
      }
    },
    // A few hundred sequential writes for a full tree.
    { timeout: 60_000 },
  );
  // Managed storage paths include the category path.
  await reorganizeManagedPrints(undefined, userId);
}
