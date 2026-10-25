// Snapmaker Space's own model data, as its pages read it: which print profiles a model has, and whose they are.

import { request } from "../../shared/messages";
import { parseSnapmakerModelUrl } from "./urls.generated";
import { MANIFESTS } from "../index.generated";

export type SnapmakerProfileScope = "url" | "designer" | "all";

type Profile = { id: string; creatorId: string | null };
type Model = { creatorId: string | null; profiles: Profile[] };

const API = MANIFESTS.snapmaker.endpoints.api;

const asId = (value: unknown) => (value == null ? null : String(value));

/** The model's print profiles, from the same public API the page calls. Null when it can't be read. */
async function loadModel(modelId: string): Promise<Model | null> {
  try {
    const res = await fetch(`${API}/model/detail/${encodeURIComponent(modelId)}`, { credentials: "omit" });
    const body = (await res.json()) as { code?: number; data?: Record<string, unknown> };
    if (body.code !== 200 || !body.data) return null;
    const profiles = Array.isArray(body.data.printProfiles)
      ? (body.data.printProfiles as Record<string, unknown>[]).flatMap((p) =>
          p && p.id != null ? [{ id: String(p.id), creatorId: asId(p.creatorId) }] : [],
        )
      : [];
    return { creatorId: asId(body.data.creatorId), profiles };
  } catch {
    return null;
  }
}

/** Mirrors the backend's selectSnapmakerProfiles, the linked (or designer's first) profile first. */
function profileIds(model: Model, scope: SnapmakerProfileScope, requested: string | null): string[] {
  const designers = model.profiles.filter((p) => p.creatorId === model.creatorId);
  const primary =
    model.profiles.find((p) => p.id === requested)?.id ?? designers[0]?.id ?? model.profiles[0]?.id ?? null;
  if (!primary) return [];
  if (scope === "url") return [primary];
  const wanted = (scope === "all" ? model.profiles : designers).map((p) => p.id);
  return [primary, ...wanted.filter((id) => id !== primary)];
}

/** Profile ids for each scope, for the panel's picker and its import. Null when the model can't be read. */
export async function loadSnapmakerProfiles(url: string): Promise<((scope: SnapmakerProfileScope) => string[]) | null> {
  const parsed = parseSnapmakerModelUrl(url);
  const model = parsed ? await loadModel(parsed.modelId) : null;
  if (!parsed || !model) return null;
  return (scope) => profileIds(model, scope, parsed.requestedProfileId);
}

/** Who's signed in on Snapmaker, so likes and bookmarks are only offered on their own page. */
export async function snapmakerUserId(): Promise<string | null> {
  const res = await request("SYNC_PROVIDER_SESSION", { provider: MANIFESTS.snapmaker.id }).catch(() => null);
  return res?.userId ?? null;
}
