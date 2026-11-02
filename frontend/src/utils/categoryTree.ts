import type { Category } from "../api/categories";

export type CategoryTree = {
  roots: Category[];
  /** Sorted children per parent id; leaves have no entry. */
  childrenByParent: Record<string, Category[]>;
  byId: Map<string, Category>;
};

const byPosition = (a: Category, b: Category) => a.position - b.position || a.name.localeCompare(b.name);

/** A category whose parent is missing is treated as a root, so nothing disappears. */
export function buildCategoryTree(categories: Category[]): CategoryTree {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenByParent: Record<string, Category[]> = {};
  const roots: Category[] = [];
  for (const category of categories) {
    if (category.parent_id && byId.has(category.parent_id)) {
      (childrenByParent[category.parent_id] ??= []).push(category);
    } else {
      roots.push(category);
    }
  }
  for (const key of Object.keys(childrenByParent)) childrenByParent[key].sort(byPosition);
  return { roots: roots.toSorted(byPosition), childrenByParent, byId };
}

/** The category and everything under it. */
export function subtreeIds(tree: CategoryTree, id: string): string[] {
  const ids: string[] = [];
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    ids.push(current);
    for (const child of tree.childrenByParent[current] ?? []) stack.push(child.id);
  }
  return ids;
}

/** Root first, ending with the category itself. */
export function ancestorPath(tree: CategoryTree, id: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let current = tree.byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parent_id ? tree.byId.get(current.parent_id) : undefined;
  }
  return path;
}

/** Lowercase and without accents, so typing "zaislai" finds "Žaislai". */
export function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** What a search keeps: the categories whose name has `query`, the way down to them, and everything under them, as a
 *  match on a heading is a search for what's in it. */
export function categorySearchIds(
  tree: CategoryTree,
  query: string,
  nameOf: (category: Category) => string,
): Set<string> {
  const needle = foldForSearch(query.trim());
  const kept = new Set<string>();
  for (const category of tree.byId.values()) {
    if (!foldForSearch(nameOf(category)).includes(needle)) continue;
    for (const id of ancestorPath(tree, category.id)) kept.add(id);
    for (const id of subtreeIds(tree, category.id)) kept.add(id);
  }
  return kept;
}

export type FlatCategory = { category: Category; depth: number };

/** Depth-first display order. Children of ids in `skipChildrenOf` are left out. */
export function flattenCategoryTree(tree: CategoryTree, skipChildrenOf?: ReadonlySet<string>): FlatCategory[] {
  const out: FlatCategory[] = [];
  const visit = (category: Category, depth: number) => {
    out.push({ category, depth });
    if (skipChildrenOf?.has(category.id)) return;
    for (const child of tree.childrenByParent[category.id] ?? []) visit(child, depth + 1);
  };
  for (const root of tree.roots) visit(root, 0);
  return out;
}
