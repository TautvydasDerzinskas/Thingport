import { authHeaders } from "../utils/auth";
import { apiBase, assertOk, readErrorMessage, UnauthorizedError } from "./client";

/** "category": the starter categories imports sort into. "folder": the user's own tree. */
export type CategoryKind = "category" | "folder";

export type Category = {
  id: string;
  name: string;
  tags: string[];
  parent_id?: string | null;
  /** Always the same as the top-level ancestor's. */
  kind: CategoryKind;
  position: number;
  meta_title: string | null;
  meta_description: string | null;
  // Semicolon-separated, e.g. "800;71;1001"; empty when none.
  makerworld_cat_ids: string;
  thingiverse_cat_ids: string;
  printables_cat_ids: string;
  myminifactory_cat_ids: string;
  snapmaker_cat_ids: string;
  makeronline_cat_ids: string;
  crealitycloud_cat_ids: string;
  nexprint_cat_ids: string;
  thangs_cat_ids: string;
  cults3d_cat_ids: string;
};

export type CategoryMetaInput = {
  metaTitle: string | null;
  metaDescription: string | null;
  makerworldCatIds: string;
  thingiverseCatIds: string;
  printablesCatIds: string;
  myminifactoryCatIds: string;
  snapmakerCatIds: string;
  makeronlineCatIds: string;
  crealitycloudCatIds: string;
  nexprintCatIds: string;
  thangsCatIds: string;
  cults3dCatIds: string;
};

/** Category paths, top level first. */
export type CategoryResetPreview = {
  added: string[][];
  /** Kept categories whose name, details, site ids or place go back to the default's. */
  restored: string[][];
  removed: { path: string[]; models: number }[];
  /** Models in removed categories that move to the nearest kept parent. */
  models_moved: number;
  /** Models in removed categories with no kept parent, left without a category. */
  models_uncategorized: number;
  /** Moved models renamed for clashing with one already where they land. */
  models_renamed: number;
};

/** Whether a reset would change nothing. */
export const resetIsNoop = (p: CategoryResetPreview) => !p.added.length && !p.restored.length && !p.removed.length;

export const categoriesApi = {
  list: async (): Promise<Category[]> => {
    const res = await fetch(`${apiBase()}/categories`, { headers: authHeaders() });
    assertOk(res, "Failed to list categories");
    return res.json();
  },

  /** `kind` only applies at the top level; a subcategory takes its parent's. The server defaults to folder. */
  create: async (name: string, tags: string[] = [], parent_id?: string | null, kind?: CategoryKind) => {
    const res = await fetch(`${apiBase()}/categories`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, tags, parent_id, kind }),
    });
    assertOk(res, "Create category failed");
    return res.json();
  },

  update: async (id: string, name: string, tags: string[], parent_id?: string | null) => {
    const res = await fetch(`${apiBase()}/category/${id}`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name, tags, parent_id }),
    });
    assertOk(res, "Update category failed");
    return res.json();
  },

  delete: async (id: string) => {
    const res = await fetch(`${apiBase()}/category/${id}`, { method: "DELETE", headers: authHeaders() });
    assertOk(res, "Delete category failed");
    return res.json();
  },

  updateMeta: async (id: string, meta: CategoryMetaInput) => {
    const res = await fetch(`${apiBase()}/category/${id}/meta`, {
      method: "PATCH",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        meta_title: meta.metaTitle,
        meta_description: meta.metaDescription,
        makerworld_cat_ids: meta.makerworldCatIds,
        thingiverse_cat_ids: meta.thingiverseCatIds,
        printables_cat_ids: meta.printablesCatIds,
        myminifactory_cat_ids: meta.myminifactoryCatIds,
        snapmaker_cat_ids: meta.snapmakerCatIds,
        makeronline_cat_ids: meta.makeronlineCatIds,
        crealitycloud_cat_ids: meta.crealitycloudCatIds,
        nexprint_cat_ids: meta.nexprintCatIds,
        thangs_cat_ids: meta.thangsCatIds,
        cults3d_cat_ids: meta.cults3dCatIds,
      }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) {
      // Keep the backend's specific message (e.g. naming a typo).
      throw new Error(await readErrorMessage(res, "Update category details failed"));
    }
    return res.json();
  },

  /** `categoryIds` must be exactly one parent's current children (or the roots), reordered. */
  reorder: async (categoryIds: string[]) => {
    const res = await fetch(`${apiBase()}/categories/reorder`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ category_ids: categoryIds }),
    });
    assertOk(res, "Reorder categories failed");
    return res.json();
  },

  /** Puts a category under `parentId` (null for top level) at `position` among its new siblings. */
  move: async (id: string, parentId: string | null, position: number) => {
    const res = await fetch(`${apiBase()}/category/${id}/move`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ parent_id: parentId, position }),
    });
    if (res.status === 401) throw new UnauthorizedError();
    if (!res.ok) throw new Error(await readErrorMessage(res, "Move category failed"));
    return res.json();
  },

  /** What a reset to the starter categories would change; all empty when the tree already is that. */
  previewReset: async (): Promise<CategoryResetPreview> => {
    const res = await fetch(`${apiBase()}/categories/reset-defaults`, { headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Failed to preview the category reset");
    return res.json();
  },

  /** Puts the category tree (not folders) back to the starter one; returns every category afterwards. */
  resetDefaults: async (): Promise<Category[]> => {
    const res = await fetch(`${apiBase()}/categories/reset-defaults`, { method: "POST", headers: authHeaders() });
    if (res.status === 401) throw new UnauthorizedError();
    assertOk(res, "Reset categories failed");
    return res.json();
  },

  downloadZip: async (category_id: string) => {
    const res = await fetch(`${apiBase()}/category/${category_id}/download`, { headers: authHeaders() });
    assertOk(res, "Category download failed");
    return res;
  },
};
