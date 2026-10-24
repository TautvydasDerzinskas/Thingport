// MakerOnline's own model data, as its pages read it: which print profiles a model has, and whose they are.

import { parseMakeronlineModelUrl } from "../../shared/providers/_generated/makeronline/urls";

export type MakeronlineProfileScope = "url" | "designer" | "all";

type Profile = { id: string; creatorId: string | null };
type Model = { creatorId: string | null; profiles: Profile[] };

const asId = (value: unknown) => (value == null ? null : String(value));

/** The model's print profiles that have a file, from the same public API the page calls. Null when it can't be
 *  read. */
async function loadModel(modelId: string): Promise<Model | null> {
  try {
    const res = await fetch(`/api/mold/detail?id=${encodeURIComponent(modelId)}`, { credentials: "omit" });
    const body = (await res.json()) as { code?: number; data?: Record<string, unknown> };
    if (body.code !== 0 || !body.data) return null;
    const profiles = Array.isArray(body.data.print_profiles)
      ? (body.data.print_profiles as Record<string, unknown>[]).flatMap((p) =>
          p && p.id != null && Array.isArray(p.files) && p.files.length
            ? [{ id: String(p.id), creatorId: asId(p.user_id) }]
            : [],
        )
      : [];
    return { creatorId: asId(body.data.user_id), profiles };
  } catch {
    return null;
  }
}

/** Mirrors the backend's selectMakeronlineProfiles, the linked (or designer's first) profile first. */
function profileIds(model: Model, scope: MakeronlineProfileScope, requested: string | null): string[] {
  const designers = model.profiles.filter((p) => p.creatorId === model.creatorId);
  const primary =
    model.profiles.find((p) => p.id === requested)?.id ?? designers[0]?.id ?? model.profiles[0]?.id ?? null;
  if (!primary) return [];
  if (scope === "url") return [primary];
  const wanted = (scope === "all" ? model.profiles : designers).map((p) => p.id);
  return [primary, ...wanted.filter((id) => id !== primary)];
}

/** Profile ids for each scope, for the panel's picker. Null when the model can't be read. */
export async function loadMakeronlineProfiles(
  url: string,
): Promise<((scope: MakeronlineProfileScope) => string[]) | null> {
  const parsed = parseMakeronlineModelUrl(url);
  const model = parsed ? await loadModel(parsed.modelId) : null;
  if (!parsed || !model) return null;
  return (scope) => profileIds(model, scope, parsed.requestedProfileId);
}
