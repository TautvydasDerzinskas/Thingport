// Creality Cloud's own model data, as its pages read it: which print profiles a model has, and whose they are.

import { request } from "../shared/messages";
import { parseCrealitycloudModelUrl } from "../shared/providers/_generated/crealitycloud/urls";

export type CrealitycloudProfileScope = "url" | "designer" | "all";

type Profile = { id: string; designers: boolean };

const asId = (value: unknown) => (value == null ? null : String(value));

// Its API answers "Invalid Parameter" to a call without the headers its own pages send.
const HEADERS = {
  "Content-Type": "application/json",
  __cxy_app_id_: "cxy-gen2",
  __cxy_app_ver_: "7.3.28",
  __cxy_app_ch_: "Chrome",
  __cxy_brand_: "creality",
  __cxy_platform_: "2",
  __cxy_os_lang_: "0",
  __cxy_os_ver_: "Web",
  __cxy_timezone_: "0",
  __cxy_duid_: crypto.randomUUID(),
};

async function call(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const res = await fetch(`/api/cxy${path}`, {
    method: "POST",
    headers: { ...HEADERS, __cxy_requestid_: crypto.randomUUID() },
    body: JSON.stringify(body),
    credentials: "omit",
  });
  const json = (await res.json()) as { code?: number; result?: Record<string, unknown> };
  return json.code === 0 && json.result ? json.result : null;
}

/** The model's print profiles, from the same public API the page calls. Null when they can't be read. */
async function loadProfiles(modelId: string): Promise<Profile[] | null> {
  try {
    const detail = await call("/v3/model/modelGroupDetail", { id: modelId });
    const group = detail?.groupItem as Record<string, unknown> | undefined;
    const groupId = asId(group?.id);
    if (!groupId) return null;
    const creatorId = asId((group?.userInfo as Record<string, unknown> | undefined)?.userId);
    const list = await call("/v3/model/3mfList", { page: 1, pageSize: 199, modelGroupId: groupId, filterType: 11 });
    if (!list) return null;
    return (Array.isArray(list.list) ? (list.list as Record<string, unknown>[]) : []).flatMap((p) => {
      const id = asId(p?.id);
      if (!id) return [];
      const owner = asId((p.userInfo as Record<string, unknown> | undefined)?.userId);
      return [{ id, designers: p.isAuth === true || (!!owner && owner === creatorId) }];
    });
  } catch {
    return null;
  }
}

/** Mirrors the backend's selectCrealitycloudProfiles, the linked (or designer's first) profile first. */
function profileIds(profiles: Profile[], scope: CrealitycloudProfileScope, requested: string | null): string[] {
  const designers = profiles.filter((p) => p.designers);
  const primary = profiles.find((p) => p.id === requested)?.id ?? designers[0]?.id ?? profiles[0]?.id ?? null;
  if (!primary) return [];
  if (scope === "url") return [primary];
  const wanted = (scope === "all" ? profiles : designers).map((p) => p.id);
  return [primary, ...wanted.filter((id) => id !== primary)];
}

/** Profile ids for each scope, for the panel's picker and its import. Null when the model can't be read. */
export async function loadCrealitycloudProfiles(
  url: string,
): Promise<((scope: CrealitycloudProfileScope) => string[]) | null> {
  const parsed = parseCrealitycloudModelUrl(url);
  const profiles = parsed ? await loadProfiles(parsed.modelId) : null;
  if (!parsed || !profiles) return null;
  return (scope) => profileIds(profiles, scope, parsed.requestedProfileId);
}

/** Who's signed in on Creality Cloud, so likes are only offered on their own page. */
export async function crealitycloudUserId(): Promise<string | null> {
  const res = await request("SYNC_CREALITYCLOUD_SESSION").catch(() => null);
  return res?.userId ?? null;
}
