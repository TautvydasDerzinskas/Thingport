import type { Collection } from "../../api/collections";

export type CollectionType = "system" | "user" | "tool";

export const COLLECTION_TYPES: CollectionType[] = ["system", "user", "tool"];

const STORAGE_KEY = "thingport_collections_hidden_types";

export const collectionType = (collection: Collection): CollectionType =>
  collection.system_key ? "system" : collection.tool_id ? "tool" : "user";

export function readHiddenTypes(): CollectionType[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? COLLECTION_TYPES.filter((type) => stored.includes(type)) : [];
  } catch {
    return [];
  }
}

export function saveHiddenTypes(hidden: CollectionType[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden));
  } catch {}
}
