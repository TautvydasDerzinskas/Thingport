// GENERATED from providers/owlcad/urls.ts by scripts/sync-providers.mjs. Don't edit it here:
// change providers/ and run npm run providers:sync.
import { hostIsSite } from "../_lib/hosts.generated";
import type { ListLink, ModelLink, ProviderUrls } from "../_lib/types.generated";
import manifest from "./manifest.generated";

const SITE_ORIGIN = manifest.site;

function isHost(hostname: string): boolean {
  return hostIsSite(hostname, manifest.hosts[0]);
}

function parseUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return isHost(parsed.hostname) ? parsed : null;
  } catch {
    return null;
  }
}

// Every gallery item is keyed by a UUID, both the library parts and the CAD projects.
const MODEL_PATH = /^\/gallery\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/[^/]*)?\/?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// /gallery/ai-generated and /gallery/category/<slug> are gallery pages, not models; the id pattern excludes them.
const EDITOR_PATH = /^\/app\/?$/;

/** `/gallery/<id>`, the name after it optional, or `/app?shared=<id>`, which is the same model open in the editor --
 *  the page Grab exports a CAD project from, and the link its Share button hands out. */
export function parseOwlcadModelUrl(url: string): { modelId: string } | null {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  const m = parsed.pathname.match(MODEL_PATH);
  if (m) return { modelId: m[1].toLowerCase() };
  if (!EDITOR_PATH.test(parsed.pathname)) return null;
  const shared = parsed.searchParams.get("shared")?.trim() ?? "";
  return UUID.test(shared) ? { modelId: shared.toLowerCase() } : null;
}

/** The gallery page of a model. Its name is only decoration, and the id alone resolves, so links are written bare. */
export function owlcadModelUrl(modelId: string): string {
  return `${SITE_ORIGIN}/gallery/${modelId}`;
}

/** The model open in OwlCAD's editor: where its Export lives, and so where Grab gets a CAD project's file. */
export function owlcadEditorUrl(modelId: string): string {
  return `${SITE_ORIGIN}/app?shared=${modelId}`;
}

export const urls: ProviderUrls = {
  isHost,
  parseModel(url): ModelLink | null {
    const model = parseOwlcadModelUrl(url);
    return model && { externalId: model.modelId, requestedProfileId: null };
  },
  // OwlCAD has no collections and no likes: its gallery is one list, filtered by category.
  parseList(): ListLink | null {
    return null;
  },
  modelUrl: (modelId) => owlcadModelUrl(modelId),
};
