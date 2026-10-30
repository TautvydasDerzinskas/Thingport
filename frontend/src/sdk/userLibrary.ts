import { collectionsApi, type Collection } from "../api/collections";
import { printsApi, type Print } from "../api/prints";
import { searchApi } from "../api/search";
import type { SdkCollection, SdkCollections, SdkFileInput, SdkModel, SdkModels, SdkRelatedFile } from "./types";

// The user's own library, as a widget's or a tool's script reaches it: the same API the app itself uses, as the
// user. Kept small and plain — no Print objects, no React — so it stays the same as the app changes, and so what a
// script may do with the library is one list, in one place, however the script is run.

export type { SdkCollection, SdkFileInput, SdkModel, SdkRelatedFile } from "./types";

const toModel = (print: Print): SdkModel => ({
  id: print.id,
  name: print.title || print.name,
  description: print.notes ?? null,
  tags: print.tags,
  thumbnail: print.thumb_url ? printsApi.fileUrl(print.thumb_url) : null,
  files: (print.plates ?? []).map((plate) => ({
    id: plate.id,
    name: plate.filename,
    size: plate.size,
    url: printsApi.fileUrl(plate.url),
  })),
  relatedCount: print.supporting_file_count ?? 0,
  toolOwned: Boolean(print.tool_id),
  createdAt: print.created_at ?? null,
});

export const toCollection = (collection: Collection): SdkCollection => ({
  id: collection.id,
  name: collection.name,
  description: collection.description,
  tags: collection.tags,
  modelCount: collection.item_count,
  toolOwned: Boolean(collection.tool_id),
});

export function toFile(input: SdkFileInput): File {
  if (!input || typeof input.name !== "string" || !input.name.trim()) throw new Error("A file needs a name");
  const data = input.data instanceof Blob ? input.data : new Blob([input.data as BlobPart]);
  return new File([data], input.name, { type: input.type ?? (data.type || "application/octet-stream") });
}

function listOptions(options: { limit?: number; offset?: number } = {}) {
  return { limit: Math.min(Math.max(1, options.limit ?? 50), 200), offset: Math.max(0, options.offset ?? 0) };
}

/**
 * The `models` and `collections` objects a script is given.
 *
 * `openModel` is how the host leaves for a model's page — a tool closes its window first, a panel just navigates. A
 * tool adds `collections.pick` itself, as only it has a "save where?" dialog.
 */
export function buildUserLibrary({ openModel }: { openModel: (id: string) => void }): {
  models: SdkModels;
  collections: SdkCollections;
} {
  const getModel = async (id: string) => toModel(await printsApi.get(id));

  // What each member does is in types.ts, which the reference is written from.
  const models: SdkModels = {
    list: async (
      options: { q?: string; tags?: string[]; collectionId?: string; limit?: number; offset?: number } = {},
    ) => {
      const page = await printsApi.list({
        q: options.q,
        tags: options.tags,
        collection_id: options.collectionId,
        ...listOptions(options),
      });
      return { models: page.items.map(toModel), hasMore: page.hasMore, total: page.total ?? null };
    },
    search: async (q: string) => {
      const result = await searchApi.search(q);
      return {
        models: result.models.map(toModel),
        collections: result.collections.map((c) => ({ id: c.id, name: c.name, modelCount: c.item_count })),
        tags: result.tags,
      };
    },
    get: getModel,
    file: async (id: string, fileId?: string): Promise<ArrayBuffer> => {
      const model = await getModel(id);
      const file = fileId ? model.files.find((f) => f.id === fileId) : model.files[0];
      if (!file) throw new Error("The model has no such file");
      const res = await fetch(file.url);
      // A 404 here means the row is in the library but the file isn't in storage, which reads as a mystery
      // unless the message says so.
      if (res.status === 404) throw new Error(`${file.name} is missing from Thingport's storage`);
      if (!res.ok) throw new Error(`Couldn't read ${file.name} (HTTP ${res.status})`);
      return res.arrayBuffer();
    },
    relatedFiles: async (id: string): Promise<SdkRelatedFile[]> =>
      (await printsApi.listFiles(id)).map((file) => ({
        id: file.id,
        name: file.filename,
        type: file.mime,
        size: file.size,
        url: printsApi.fileUrl(file.url),
      })),
    relatedText: async (id: string, fileId: string): Promise<string> => {
      const files = await models.relatedFiles(id);
      const file = files.find((f) => f.id === fileId);
      if (!file) throw new Error("The model has no such related file");
      const res = await fetch(file.url);
      if (res.status === 404) throw new Error(`${file.name} is missing from Thingport's storage`);
      if (!res.ok) throw new Error(`Couldn't read ${file.name} (HTTP ${res.status})`);
      return res.text();
    },
    create: async (input: {
      name: string;
      description?: string;
      tags?: string[];
      collectionId?: string;
      files: SdkFileInput[];
    }) => {
      if (!input.files?.length) throw new Error("A model needs at least one file");
      const { prints } = await printsApi.upload(input.files.map(toFile), {
        title: input.name,
        notes: input.description,
        tags: input.tags,
        mode: "multiplate",
        origin: "created",
      });
      const print = prints[0];
      if (input.collectionId) await collectionsApi.addItems(input.collectionId, [print.id]);
      return toModel(print);
    },
    addFiles: async (id: string, files: SdkFileInput[]) =>
      toModel((await printsApi.addPlates(id, files.map(toFile))).print),
    addImages: async (id: string, images: SdkFileInput[]) =>
      toModel((await printsApi.addPreviewImages(id, images.map(toFile))).print),
    replaceFile: async (id: string, fileId: string, file: SdkFileInput) => {
      const before = await printsApi.get(id);
      const order = before.plates.map((plate) => plate.id);
      if (!order.includes(fileId)) throw new Error("The model has no such file");
      const added = (await printsApi.addPlates(id, [toFile(file)])).print;
      const fresh = added.plates.find((plate) => !order.includes(plate.id));
      if (!fresh) throw new Error("The new file didn't arrive");
      await printsApi.reorderPlates(
        id,
        order.map((plateId) => (plateId === fileId ? fresh.id : plateId)).concat(fileId),
      );
      return toModel((await printsApi.deletePlate(id, fileId)).print);
    },
    update: async (id: string, patch: { name?: string; description?: string; tags?: string[] }) => {
      if (patch.name !== undefined || patch.description !== undefined)
        await printsApi.updateMeta(id, {
          ...(patch.name !== undefined ? { title: patch.name } : {}),
          ...(patch.description !== undefined ? { notes: patch.description } : {}),
        });
      if (patch.tags) await printsApi.setTags(id, patch.tags);
      return getModel(id);
    },
    open: (id: string) => openModel(id),
  };

  const collections: SdkCollections = {
    list: async () => (await collectionsApi.list()).filter((collection) => !collection.system_key).map(toCollection),
    get: async (id: string) => toCollection(await collectionsApi.get(id)),
    create: async (input: { name: string; description?: string; tags?: string[] }) =>
      toCollection(await collectionsApi.create(input)),
    models: (id: string, options: { limit?: number; offset?: number } = {}) =>
      models.list({ ...options, collectionId: id }),
    add: (id: string, modelIds: string[]) => collectionsApi.addItems(id, modelIds),
    remove: (id: string, modelIds: string[]) => collectionsApi.removeItems(id, modelIds),
  };

  return { models, collections };
}
