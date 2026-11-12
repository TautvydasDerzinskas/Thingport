// eufyMake's own model data, as its pages read it: which print files (its print profiles) a model has. They're all
// its designer's own.

import { parseEufymakeModelUrl } from "./urls.generated";

export type EufymakeProfileScope = "url" | "designer" | "all";

/** The model's print files, by their ids, from the same public API the page calls. Null when they can't be read. */
async function loadPrintFiles(modelId: string): Promise<string[] | null> {
  try {
    const res = await fetch("https://aiot-wapi-eu.ankermake.com/web/modelbase/model/get_model_detail", {
      method: "POST",
      headers: { "Content-Type": "application/json", "App-Name": "makeitreal", "Model-Type": "WEB" },
      body: JSON.stringify({ model_id: modelId }),
      credentials: "omit",
    });
    const body = (await res.json()) as { code?: number; data?: { model?: Record<string, unknown> } | null };
    const model = body.code === 0 ? body.data?.model : null;
    if (!model) return null;
    const infos = Array.isArray(model.model_print_infos) ? (model.model_print_infos as Record<string, unknown>[]) : [];
    return infos.flatMap((info) => {
      const id = info?.info_id == null ? "" : String(info.info_id);
      return /^\d+$/.test(id) && typeof info.file_3mf_key === "string" ? [id] : [];
    });
  } catch {
    return null;
  }
}

/** Mirrors the backend's selectEufymakeProfiles, the linked (or first) print file first: the designer's are all of
 *  them. */
function profileIds(ids: string[], scope: EufymakeProfileScope, requested: string | null): string[] {
  const primary = ids.find((id) => id === requested) ?? ids[0] ?? null;
  if (!primary) return [];
  if (scope === "url") return [primary];
  return [primary, ...ids.filter((id) => id !== primary)];
}

/** Print file ids for each scope, for the panel's picker and its import. Null when the model can't be read. */
export async function loadEufymakeProfiles(url: string): Promise<((scope: EufymakeProfileScope) => string[]) | null> {
  const parsed = parseEufymakeModelUrl(url);
  const ids = parsed ? await loadPrintFiles(parsed.modelId) : null;
  if (!parsed || !ids) return null;
  return (scope) => profileIds(ids, scope, parsed.requestedProfileId);
}
