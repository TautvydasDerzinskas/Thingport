// Reading OwlCAD. It is a Firebase app, and all three of the things we read answer with no credential at all -- no
// sign-in, no API key, no App Check token:
//
// - the gallery is a public Firestore collection, read over its REST API;
// - a library part's mesh is a GLB in Firebase Storage, fetched by its path;
// - a CAD project's document comes from the `api` Cloud Function's `resolveProject`, whose signed mesh links are
//   themselves fetched bare.
//
// Deliberately no API key on any of them: Firestore's REST API answers without one here, and sending the site's
// public web key would only tie our reads to its quota.

import { z } from "zod";
import { HttpError } from "../../utils/fileUtils";
import type { ImportedPageMetadata } from "../../services/importResolvers";
import type { ResolvedModel } from "../types";
import manifest from "./manifest.generated";
import { owlcadModelUrl } from "./urls.generated";

const NAME = manifest.name;
const PROJECT = "webcad-66241";
const FIRESTORE = `${manifest.endpoints.firestore}/v1/projects/${PROJECT}/databases/(default)/documents`;
const STORAGE = `${manifest.endpoints.files}/v0/b/${PROJECT}.firebasestorage.app/o`;
const CALLABLE = `${manifest.endpoints.api}/api`;
const GALLERY = "gallery";

const TIMEOUT_MS = 30_000;
/** A gallery item's mesh; the biggest in the catalogue is a few MB, and a CAD project's imported mesh a few more. */
const MAX_FILE_BYTES = 80 * 1024 * 1024;

export class OwlcadError extends Error {}

/** Firestore's REST API answers in a tagged shape ({"stringValue": …}); this is its value as plain JSON. */
function plain(field: unknown): unknown {
  if (!field || typeof field !== "object") return null;
  const [key, value] = Object.entries(field as Record<string, unknown>)[0] ?? [];
  switch (key) {
    case "nullValue":
      return null;
    case "integerValue":
      return Number(value);
    case "doubleValue":
      return typeof value === "number" ? value : Number(value);
    case "booleanValue":
      return Boolean(value);
    case "arrayValue":
      return ((value as { values?: unknown[] })?.values ?? []).map(plain);
    case "mapValue":
      return Object.fromEntries(
        Object.entries((value as { fields?: Record<string, unknown> })?.fields ?? {}).map(([k, v]) => [k, plain(v)]),
      );
    default:
      return value ?? null;
  }
}

function documentFields(doc: unknown): Record<string, unknown> | null {
  const fields = (doc as { fields?: Record<string, unknown> } | null)?.fields;
  if (!fields || typeof fields !== "object") return null;
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, plain(v)]));
}

/** What the gallery says about an item. Only `type` and `name` are relied on; the rest is as thin as the doc is. */
const galleryItemSchema = z.object({
  type: z.string().nullish(),
  kind: z.string().nullish(),
  name: z.string().nullish(),
  slug: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  license: z.string().nullish(),
  authorName: z.string().nullish(),
  attribution: z.object({ author: z.string().nullish(), sourceUrl: z.string().nullish() }).nullish(),
  pack: z.object({ name: z.string().nullish(), url: z.string().nullish() }).nullish(),
  storagePath: z.string().nullish(),
  thumbnailUrl: z.string().nullish(),
  status: z.string().nullish(),
  aiGenerated: z.boolean().nullish(),
});

export type OwlcadGalleryItem = z.infer<typeof galleryItemSchema> & { id: string };

/** A gallery item is one of two things, and they are fetched in completely different ways. */
export type OwlcadKind = "part" | "project";

export type OwlcadModel = ResolvedModel & {
  id: string;
  item: OwlcadGalleryItem;
  /** A library part, whose mesh is in Storage, or a CAD project, whose geometry is its document. */
  kind: OwlcadKind;
};

/** Plain fetch: none of its hosts is behind Cloudflare, and none of the calls carries a credential.
 *
 *  `read` runs while the timeout still stands, so it covers the body as well as the headers -- a download that
 *  stalls halfway is cut off rather than held open for as long as the other end likes. */
async function call<T>(url: string, init: RequestInit | undefined, read: (res: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await read(await fetch(url, { ...init, redirect: "follow", signal: controller.signal }));
  } catch (err) {
    // What `read` made of the answer is the answer; only reaching OwlCAD at all failed here.
    if (err instanceof OwlcadError || err instanceof HttpError) throw err;
    throw new OwlcadError(`Could not reach ${NAME}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  return call(url, init, async (res) => {
    if (res.status === 404) return null;
    if (!res.ok) throw new OwlcadError(`${NAME} answered ${res.status}`);
    return res.json().catch(() => null);
  });
}

/** One gallery item by its id, or null when it isn't there or isn't shown.
 *
 *  Firestore answers a document that doesn't exist with 403 "Missing or insufficient permissions", not 404: its
 *  rules have nothing to grant a read on. So a missing model and one we may not read are the same answer, and for a
 *  gallery anyone can read it means the model is gone. */
export async function fetchOwlcadItem(id: string): Promise<OwlcadGalleryItem | null> {
  const fields = await call(`${FIRESTORE}/${GALLERY}/${encodeURIComponent(id)}`, undefined, async (res) => {
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new OwlcadError(`${NAME} answered ${res.status}`);
    return documentFields(await res.json().catch(() => null));
  });
  if (!fields) return null;
  const parsed = galleryItemSchema.safeParse(fields);
  if (!parsed.success) return null;
  // Anything not live is hidden, under review or taken down; to us it is simply not there.
  if (parsed.data.status !== "live") return null;
  return { ...parsed.data, id };
}

export function owlcadKindOf(item: OwlcadGalleryItem): OwlcadKind {
  return item.type === "part" ? "part" : "project";
}

/** Whether Thingport can build this model's file by itself. A library part's mesh is stored; a CAD project's is not
 *  -- its document is a script that only OwlCAD's own editor can turn into geometry, so Grab exports those. */
export function owlcadImportsServerSide(item: OwlcadGalleryItem): boolean {
  return owlcadKindOf(item) === "part" && !!item.storagePath;
}

/** A model's details, the same for both kinds. */
export function owlcadMetadata(item: OwlcadGalleryItem): Partial<ImportedPageMetadata> {
  const meta: Partial<ImportedPageMetadata> = {
    title: item.name?.trim() || null,
    description: item.description?.trim() || null,
    tags: (item.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    previewImageUrl: item.thumbnailUrl || null,
  };
  // Its categories have no ids: a doc carries the label, which is what the mapping is keyed by.
  if (item.category) {
    meta.siteCategoryIds = [item.category];
    meta.categorySite = manifest.id;
  }
  // A CAD project has no author at all on OwlCAD -- the site shows none either. A library part's is the pack's
  // original creator, whose page is on their own site, so that link is all there is to point at.
  const creator = item.authorName?.trim() || item.attribution?.author?.trim() || null;
  if (creator) {
    meta.creator = creator;
    const link = item.attribution?.sourceUrl?.trim() || item.pack?.url?.trim() || null;
    meta.author = {
      provider: manifest.id,
      // It keeps no id for a creator, so their name is what their models are gathered under.
      externalId: creator.toLowerCase(),
      name: creator,
      handle: null,
      bio: null,
      bioTranslated: null,
      links: link ? [link] : [],
      avatarUrl: null,
      backgroundUrl: null,
    };
  }
  return meta;
}

export function resolvedOwlcadModel(item: OwlcadGalleryItem): OwlcadModel {
  const thumbnail = item.thumbnailUrl?.trim();
  return {
    id: item.id,
    item,
    kind: owlcadKindOf(item),
    meta: owlcadMetadata(item),
    // Its gallery keeps exactly one picture per item, which is both the cover and the whole gallery.
    galleryImages: thumbnail ? [{ url: thumbnail, filename: `${item.slug || item.id}.png` }] : [],
  };
}

export async function resolveOwlcadModel(id: string): Promise<OwlcadModel | null> {
  const item = await fetchOwlcadItem(id);
  return item && resolvedOwlcadModel(item);
}

async function getBytes(url: string, what: string): Promise<Uint8Array> {
  return call(url, undefined, async (res) => {
    if (!res.ok) throw new OwlcadError(`${NAME} answered ${res.status} for ${what}`);
    const tooLarge = () => new HttpError(413, `This ${NAME} model's file is too large to import.`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_FILE_BYTES) throw tooLarge();
    const reader = res.body?.getReader();
    if (!reader) throw new OwlcadError(`${NAME} sent no file for ${what}`);
    // Read the body chunk by chunk and stop at the limit, rather than buffering it whole and measuring after: an
    // answer that doesn't declare its length, or declares one it then exceeds, is held to the same cap.
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FILE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    return bytes;
  });
}

/** A library part's mesh, by the storage path its gallery doc names. */
export function owlcadPartUrl(storagePath: string): string {
  return `${STORAGE}/${encodeURIComponent(storagePath)}?alt=media`;
}

export async function fetchOwlcadPart(storagePath: string): Promise<Uint8Array> {
  return getBytes(owlcadPartUrl(storagePath), "a part");
}

const resolveProjectSchema = z.object({
  result: z.object({
    name: z.string().nullish(),
    document: z
      .object({ nodes: z.array(z.unknown()).nullish() })
      .passthrough()
      .nullish(),
    meshUrls: z.record(z.string()).nullish(),
    ownerId: z.string().nullish(),
  }),
});

export type OwlcadProjectDocument = {
  name: string | null;
  nodes: unknown[];
  meshUrls: Record<string, string>;
};

/** A CAD project's document. The call is one of the site's `api` Cloud Function's actions and, for a project shared
 *  to the gallery, answers without a sign-in or an App Check token. */
export async function fetchOwlcadProject(id: string): Promise<OwlcadProjectDocument | null> {
  const body = JSON.stringify({ data: { action: "resolveProject", payload: { projectId: id, meshUrls: true } } });
  const answer = await getJson(CALLABLE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const parsed = resolveProjectSchema.safeParse(answer);
  if (!parsed.success) return null;
  const { name, document, meshUrls } = parsed.data.result;
  return { name: name ?? null, nodes: document?.nodes ?? [], meshUrls: meshUrls ?? {} };
}

/** Walks a document's nodes for the one shape we can build ourselves: geometry that is nothing but an imported mesh.
 *  Anything else -- a boolean, a generator, a modifier -- is a script OwlCAD's kernel has to run. */
export function owlcadMeshOnlyRefs(nodes: unknown[]): string[] | null {
  const refs: string[] = [];
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    const { kind, meshRef } = node as { kind?: string; meshRef?: string };
    if (kind !== "mesh") return false;
    if (typeof meshRef === "string" && meshRef) refs.push(meshRef);
    return true;
  };
  for (const node of nodes) if (!walk(node)) return null;
  return refs.length ? refs : null;
}

/** The mesh links of a project Thingport can build by itself: a document that is nothing but imported meshes, every
 *  one of them with a link to fetch. Null for anything else, which is what sends a project through Grab -- so the
 *  import and the plan Grab asks for agree on which projects those are. */
export function owlcadProjectMeshUrls(project: OwlcadProjectDocument): string[] | null {
  const refs = owlcadMeshOnlyRefs(project.nodes);
  if (!refs) return null;
  const urls = refs.map((ref) => project.meshUrls[ref]);
  return urls.every((url) => !!url) ? urls : null;
}

export async function fetchOwlcadMesh(url: string): Promise<Uint8Array> {
  return getBytes(url, "a mesh");
}

export { owlcadModelUrl };
