// NexPrint's own model data, as its pages read it: which print profiles a model has, and whose they are.

import { parseNexprintModelUrl } from "../../shared/providers/_generated/nexprint/urls";

export type NexprintProfileScope = "url" | "designer" | "all";

type Profile = { id: string; designers: boolean };

/** The model's print profiles, from the same public API the page calls. Null when they can't be read. */
async function loadProfiles(modelId: string): Promise<Profile[] | null> {
  try {
    const query = new URLSearchParams({ id: modelId, loadGeneratorInfo: "true", loadSupportPrintProfile: "true" });
    const res = await fetch(`/gateway/api/v1/model-library-server/model-base-info/get?${query}`, {
      headers: { "client-id": "Nexprint", "user-lang": "en" },
      credentials: "omit",
    });
    const json = (await res.json()) as { code?: number; data?: Record<string, unknown> | null };
    const data = json.code === 0 ? json.data : null;
    if (!data?.modelId) return null;
    const authorId = data.authorId == null ? null : String(data.authorId);
    const settings = Array.isArray(data.settingInfoList) ? (data.settingInfoList as Record<string, unknown>[]) : [];
    return settings.flatMap((s) => {
      const id = typeof s?.settingOutId === "string" ? s.settingOutId.toUpperCase() : null;
      if (!id || s.open === false || s.isInvalid === true) return [];
      return [{ id, designers: s.isCreator === true || (!!authorId && String(s.userId) === authorId) }];
    });
  } catch {
    return null;
  }
}

/** Mirrors the backend's selectNexprintProfiles, the linked (or designer's first) profile first. */
function profileIds(profiles: Profile[], scope: NexprintProfileScope, requested: string | null): string[] {
  const designers = profiles.filter((p) => p.designers);
  const primary = profiles.find((p) => p.id === requested)?.id ?? designers[0]?.id ?? profiles[0]?.id ?? null;
  if (!primary) return [];
  if (scope === "url") return [primary];
  const wanted = (scope === "all" ? profiles : designers).map((p) => p.id);
  return [primary, ...wanted.filter((id) => id !== primary)];
}

/** Profile ids for each scope, for the panel's picker and its import. Null when the model can't be read. */
export async function loadNexprintProfiles(url: string): Promise<((scope: NexprintProfileScope) => string[]) | null> {
  const parsed = parseNexprintModelUrl(url);
  const profiles = parsed ? await loadProfiles(parsed.modelId) : null;
  if (!parsed || !profiles) return null;
  return (scope) => profileIds(profiles, scope, parsed.requestedProfileId);
}
