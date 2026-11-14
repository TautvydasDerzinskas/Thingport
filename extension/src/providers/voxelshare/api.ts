// VoxelShare's own API, as its pages call it from www.voxelshare.com: plain GETs on api.voxelshare.com answered with
// `{code, msg, data}`, code 0 when it went well. Models and their print profiles need no sign-in, so none is sent.

import { MANIFESTS } from "../index.generated";

const API = MANIFESTS.voxelshare.endpoints.api;
const CODE_OK = 0;
// A model or profile its page shows.
const SHOWN = 1;

type Answer = { code: number | null; data: unknown };

/** One call's answer; null where it failed or couldn't be read at all. A plain GET, so the browser asks nothing
 *  first. */
async function voxelshareApi(path: string, params: Record<string, string>): Promise<Answer | null> {
  try {
    const res = await fetch(`${API}/${path}?${new URLSearchParams(params)}`, { credentials: "omit" });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { code?: unknown; data?: unknown } | null;
    return { code: typeof json?.code === "number" ? json.code : null, data: json?.data };
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const records = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRecord) : []);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Its ids, as the API gives them: digits, as text. */
function idOf(value: unknown): string | null {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : (text(value) ?? "");
  return /^\d{1,20}$/.test(id) ? id : null;
}

/** One of a model's print profiles as its page lists it: a 3MF on the site's image host, behind a signed link that
 *  runs out after a day, made by the model's designer or someone else. */
export type VoxelshareProfile = { id: string; title: string; url: string; designer: boolean };

export type VoxelshareModel = { title: string | null; profiles: VoxelshareProfile[] };

/** A model's title and its print profiles in the page's order, as the backend reads them (voxelshareProfilesFrom),
 *  from its details and its list of profiles. */
export function voxelshareModelFrom(detail: unknown, list: unknown): VoxelshareModel | null {
  if (!isRecord(detail)) return null;
  const profiles = records(isRecord(list) ? list.items : null).flatMap((config) => {
    const id = idOf(config.id);
    const url = text(config.tmfDownloadUrl);
    if (!id || !url?.startsWith("https://")) return [];
    if (config.privateFlag === true || (config.status !== undefined && config.status !== SHOWN)) return [];
    return [{ id, title: text(config.name) ?? id, url, designer: config.modelCreator === true }];
  });
  return { title: text(detail.modelName) ?? text(detail.originalName), profiles };
}

/** The model's title and print profiles, from the same public API the page calls. Null when they can't be read. */
export async function loadVoxelshareModel(modelId: string): Promise<VoxelshareModel | null> {
  const [detail, list] = await Promise.all([
    voxelshareApi("v3/model/detail/info", { modelId }),
    voxelshareApi("v3/model/detail/print_configs", { modelId }),
  ]);
  if (detail?.code !== CODE_OK || list?.code !== CODE_OK) return null;
  return voxelshareModelFrom(detail.data, list.data);
}

/** The print profile the page shows, which it keeps to itself rather than in its address: the one marked in its list
 *  of them. Null where none is. */
export function pageProfileId(root: ParentNode = document): string | null {
  const id = root.querySelector<HTMLElement>(".list-container .list-item.active")?.dataset.configKey ?? "";
  return /^\d{1,20}$/.test(id) ? id : null;
}
