// QIDI Maker's own model data, as its pages read it: which print profiles a model has, and whose they are.

import { loadQidimakerModel, type QidimakerProfile } from "./api";
import { parseQidimakerModelUrl } from "./urls.generated";

export type QidimakerProfileScope = "url" | "designer" | "all";

/** Mirrors the backend's selectQidimakerProfiles, the linked (or designer's first) profile first. */
export function qidimakerProfileIds(
  profiles: QidimakerProfile[],
  scope: QidimakerProfileScope,
  requested: string | null,
): string[] {
  const designers = profiles.filter((p) => p.designer);
  const primary = profiles.find((p) => p.id === requested)?.id ?? designers[0]?.id ?? profiles[0]?.id ?? null;
  if (!primary) return [];
  if (scope === "url") return [primary];
  const wanted = (scope === "all" ? profiles : designers.length ? designers : profiles.slice(0, 1)).map((p) => p.id);
  return [primary, ...wanted.filter((id) => id !== primary)];
}

/** Profile ids for each scope, for the panel's picker and its import. Null when the model can't be read. */
export async function loadQidimakerProfileIds(
  url: string,
): Promise<((scope: QidimakerProfileScope) => string[]) | null> {
  const parsed = parseQidimakerModelUrl(url);
  const model = parsed ? await loadQidimakerModel(parsed.modelId) : null;
  if (!parsed || !model) return null;
  return (scope) => qidimakerProfileIds(model.profiles, scope, parsed.requestedProfileId);
}
