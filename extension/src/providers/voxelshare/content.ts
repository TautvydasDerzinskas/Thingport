// VoxelShare's own model data, as its pages read it: which print profiles a model has, and whose they are.

import { loadVoxelshareModel, shownProfileId, type VoxelshareProfile } from "./api";
import { parseVoxelshareModelUrl } from "./urls.generated";

export type VoxelshareProfileScope = "url" | "designer" | "all";

/** Mirrors the backend's selectVoxelshareProfiles: the designer's are theirs alone, as that import brings no other;
 *  otherwise the picked (or designer's first) profile first. */
export function voxelshareProfileIds(
  profiles: VoxelshareProfile[],
  scope: VoxelshareProfileScope,
  requested: string | null,
): string[] {
  const designers = profiles.filter((p) => p.designer);
  if (scope === "designer") return (designers.length ? designers : profiles.slice(0, 1)).map((p) => p.id);
  const primary = profiles.find((p) => p.id === requested)?.id ?? designers[0]?.id ?? profiles[0]?.id ?? null;
  if (!primary) return [];
  if (scope === "url") return [primary];
  return [primary, ...profiles.map((p) => p.id).filter((id) => id !== primary)];
}

/** Profile ids for each scope, for the panel's picker and its import: the one the page shows, else the one a link
 *  names. Null when the model can't be read. */
export async function loadVoxelshareProfileIds(
  url: string,
): Promise<((scope: VoxelshareProfileScope) => string[]) | null> {
  const parsed = parseVoxelshareModelUrl(url);
  const model = parsed ? await loadVoxelshareModel(parsed.modelId) : null;
  if (!parsed || !model) return null;
  return (scope) => voxelshareProfileIds(model.profiles, scope, shownProfileId(url));
}
