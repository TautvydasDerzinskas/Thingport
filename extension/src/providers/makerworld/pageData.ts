import { parseMakerworldModelUrl } from "./urls.generated";

export type MakerworldCreator = { uid?: string | number; name?: string };
export type MakerworldInstance = { id?: string | number; title?: string; instanceCreator?: MakerworldCreator };
export type MakerworldDesign = {
  id?: string | number;
  defaultInstanceId?: string | number;
  designCreator?: MakerworldCreator;
  instances?: MakerworldInstance[];
  /** Holds the design's files, among them the script it was generated from, where it has one. */
  designExtension?: { model_files?: unknown[] };
};

export type MakerworldProfileScope = "url" | "designer" | "all";
export type MakerworldPage = { design: MakerworldDesign; nonce: string | null; requestedInstanceId: string | null };

function readNextData(): unknown {
  const el = document.getElementById("__NEXT_DATA__");
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent);
  } catch {
    return null;
  }
}

function getPath(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function designFromNextData(nextData: unknown, designId: string): Omit<MakerworldPage, "requestedInstanceId"> | null {
  const design = getPath(nextData, "props", "pageProps", "design") as MakerworldDesign | undefined;
  if (!design || typeof design !== "object" || design.id == null || String(design.id) !== designId) return null;
  const nonce = getPath(nextData, "props", "pageProps", "x-nonce");
  return { design, nonce: typeof nonce === "string" && nonce.trim() ? nonce : null };
}

// Page data fetched after client-side navigation, by design id.
const fetchedDesigns = new Map<string, Omit<MakerworldPage, "requestedInstanceId">>();

/** Null when missing or stale: Next.js only writes __NEXT_DATA__ on a full page load, so after
 *  client-side navigation it describes the previous model. Falls back to fetched page data. */
export function readMakerworldDesignForPage(pageUrl: string): MakerworldPage | null {
  const expected = parseMakerworldModelUrl(pageUrl);
  if (!expected) return null;
  const found = designFromNextData(readNextData(), expected.designId) ?? fetchedDesigns.get(expected.designId) ?? null;
  return found ? { ...found, requestedInstanceId: expected.requestedInstanceId } : null;
}

const PAGE_FETCH_TIMEOUT_MS = 10000;

/** A page's own __NEXT_DATA__, fetched fresh. */
async function fetchNextData(pageUrl: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(pageUrl.split("#")[0], { headers: { Accept: "text/html" }, signal: controller.signal });
    if (!res.ok) return null;
    const html = await res.text();
    const el = new DOMParser().parseFromString(html, "text/html").getElementById("__NEXT_DATA__");
    return el?.textContent ? JSON.parse(el.textContent) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches the model's own page once when the tab's data is stale (the usual case after clicking
 *  through MakerWorld). */
export async function loadMakerworldDesignForPage(pageUrl: string): Promise<MakerworldPage | null> {
  const current = readMakerworldDesignForPage(pageUrl);
  if (current) return current;
  const expected = parseMakerworldModelUrl(pageUrl);
  if (!expected) return null;
  const found = designFromNextData(await fetchNextData(pageUrl), expected.designId);
  if (!found) return null;
  fetchedDesigns.set(expected.designId, found);
  return { ...found, requestedInstanceId: expected.requestedInstanceId };
}

function collectionTotalFromNextData(nextData: unknown, collectionId: string): number | null {
  const favoriteId = getPath(nextData, "props", "pageProps", "favorite", "id");
  if (favoriteId == null || String(favoriteId) !== collectionId) return null;
  const total = getPath(nextData, "props", "pageProps", "favoriteDesigns", "total");
  return typeof total === "number" && total >= 0 ? total : null;
}

/** How many models the collection page will list (hidden ones excluded), from the page's own data;
 *  the page itself only renders 20 at a time. Null if it can't be read. */
export async function loadMakerworldCollectionTotal(pageUrl: string): Promise<number | null> {
  const collectionId = pageUrl.match(/\/collections\/(\d+)/)?.[1];
  if (!collectionId) return null;
  return (
    collectionTotalFromNextData(readNextData(), collectionId) ??
    collectionTotalFromNextData(await fetchNextData(pageUrl), collectionId)
  );
}

/** The requested profile (if the design has it), then the default (if the design still has it),
 *  then the first. MakerWorld can leave `defaultInstanceId` pointing at a profile that was since
 *  deleted, and asking for that one's download answers 403 "The client does not have access rights
 *  to the content." */
export function pickMakerworldInstanceId(design: MakerworldDesign, requestedInstanceId: string | null): string | null {
  const instances = Array.isArray(design.instances) ? design.instances.filter((inst) => inst && inst.id) : [];
  const has = (id: string) => instances.some((inst) => String(inst.id) === id);
  if (requestedInstanceId && has(requestedInstanceId)) return requestedInstanceId;
  const defaultId = design.defaultInstanceId ? String(design.defaultInstanceId) : null;
  if (defaultId && has(defaultId)) return defaultId;
  return instances.length ? String(instances[0].id) : null;
}

/**
 * The generator scripts a design lists, and whether every one of them is held back.
 *
 * Mirrors the backend's makerworldParametricSource, so the page says the same thing the import would: a
 * creator can mark a .scad `protected`, and MakerWorld then hands out the models it makes but never the
 * script itself. Null where the design has no script at all, which is most of them.
 */
function scadEntries(design: MakerworldDesign): Record<string, unknown>[] {
  const files = design.designExtension?.model_files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is Record<string, unknown> => {
    if (!file || typeof file !== "object") return false;
    const entry = file as Record<string, unknown>;
    return (
      String(entry.modelType ?? "").toLowerCase() === "scad" ||
      String(entry.modelName ?? "")
        .toLowerCase()
        .endsWith(".scad")
    );
  });
}

export function makerworldScripts(design: MakerworldDesign): { filenames: string[]; withheld: boolean } | null {
  const scripts = scadEntries(design);
  if (!scripts.length) return null;
  const filenames = scripts
    .map((file) => (typeof file.modelName === "string" ? file.modelName.trim() : ""))
    .filter((name) => name.length > 0);
  return { filenames, withheld: scripts.every((file) => file.protected === true) };
}

/** Mirrors the backend's selectMakerworldProfiles. */
export function makerworldProfileIds(
  design: MakerworldDesign,
  scope: MakerworldProfileScope,
  requestedInstanceId: string | null,
): string[] {
  const primary = pickMakerworldInstanceId(design, requestedInstanceId);
  if (!primary) return [];
  if (scope === "url") return [primary];
  const designerUid = design.designCreator?.uid != null ? String(design.designCreator.uid) : null;
  const instances = Array.isArray(design.instances) ? design.instances.filter((inst) => inst && inst.id != null) : [];
  const wanted = instances
    .filter(
      (inst) =>
        scope === "all" ||
        (designerUid !== null && inst.instanceCreator?.uid != null && String(inst.instanceCreator.uid) === designerUid),
    )
    .map((inst) => String(inst.id));
  return [primary, ...wanted.filter((id) => id !== primary)];
}

// Larger designs would exceed the backend's JSON body limit; it reads the page itself instead.
const MAX_IMPORT_DESIGN_CHARS = 64 * 1024;

/** Sent with the import so the backend doesn't refetch the page. Null when too big. */
export function makerworldDesignForImport(design: MakerworldDesign): Record<string, unknown> | null {
  const source = design as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of [
    "id",
    "title",
    "tags",
    "summary",
    "coverUrl",
    "coverPortrait",
    "coverLandscape",
    "designCreator",
  ]) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  const pictures = getPath(source, "designExtension", "design_pictures");
  // Only the .scad entries, and only the three fields the backend reads off them: it decides from these whether
  // the model came with the script it was generated from, and whether its creator shared it. Sending the whole
  // model_files list would spend the budget below on files the import already gets another way.
  const scripts = scadEntries(design).map((file) => ({
    modelType: file.modelType,
    modelName: file.modelName,
    protected: file.protected,
  }));
  if (Array.isArray(pictures) || scripts.length) {
    out.designExtension = {
      ...(Array.isArray(pictures)
        ? {
            design_pictures: pictures.map((picture) => ({
              name: getPath(picture, "name"),
              url: getPath(picture, "url"),
            })),
          }
        : {}),
      ...(scripts.length ? { model_files: scripts } : {}),
    };
  }
  if (Array.isArray(source.categories))
    out.categories = source.categories.map((category) => ({ id: getPath(category, "id") }));
  if (JSON.stringify(out).length > MAX_IMPORT_DESIGN_CHARS) return null;
  // Each profile's own picture and name, for its file's thumbnail and name; left out rather than lose the rest when
  // there are too many.
  if (Array.isArray(source.instances)) {
    const instances = source.instances.map((inst) => ({
      id: getPath(inst, "id"),
      title: getPath(inst, "title"),
      cover: getPath(inst, "cover"),
    }));
    if (JSON.stringify({ ...out, instances }).length <= MAX_IMPORT_DESIGN_CHARS) out.instances = instances;
  }
  return out;
}

export function currentMakerworldProfileTitle(pageUrl: string): string | null {
  const page = readMakerworldDesignForPage(pageUrl);
  if (!page || !page.requestedInstanceId || !Array.isArray(page.design.instances)) return null;
  const instance = page.design.instances.find((inst) => inst && String(inst.id) === page.requestedInstanceId);
  return instance && typeof instance.title === "string" && instance.title.trim() ? instance.title.trim() : null;
}
