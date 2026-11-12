// Creality Cloud for Download adapted (content/adapted/): its files are Creality Print projects. A model's print
// profiles are listed and downloaded through its own API as its pages do, the download signed in as the user is
// there, and the profile is the one picked on the page. The button gets a row of its own under the site's Cloud Slice
// and Download 3MF.

import { MAX_BYTES, readBody, tooBig } from "../../content/adapted/download";
import { orcaFamilyFormat } from "../../content/adapted/formats";
import { pageCookie, placeAfter, signInFirst, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { providerCredentialRequest } from "../../shared/providerCredentialRequest";
import { CXY_HEADERS } from "./content";
import { parseCrealitycloudModelUrl } from "./urls.generated";

const API = "https://www.crealitycloud.com/api/cxy";
const NAME = "Creality Cloud";
// Its answer to a token it doesn't take; its own pages sign the user out on it.
const INVALID_TOKEN = 4;

type Answer = { code?: number; msg?: string; result?: Record<string, unknown> | null };

async function cxy(path: string, body: Record<string, unknown>, auth?: { token: string; uid: string }) {
  const res = await providerCredentialRequest("crealitycloud-api", `${API}${path}`, {
    method: "POST",
    headers: {
      ...CXY_HEADERS,
      __cxy_requestid_: crypto.randomUUID(),
      ...(auth ? { __cxy_token_: auth.token, __cxy_uid_: auth.uid } : {}),
    },
    body: JSON.stringify(body),
    credentials: "omit",
  });
  if (!res.ok) throw new Error(`${NAME} answered HTTP ${res.status}. Try again in a moment.`);
  return (await res.json()) as Answer;
}

/** The profiles `3mfList` gives, as files: shown by their names on the page, their files named once downloaded. */
export function profileFiles(result: Record<string, unknown> | null | undefined): AdaptFile[] {
  const rows = Array.isArray(result?.list) ? (result.list as Record<string, unknown>[]) : [];
  return rows.flatMap((row) => {
    if (row?.id == null) return [];
    const title = typeof row.secondName === "string" && row.secondName.trim() ? row.secondName.trim() : "";
    const size = Number(row.size);
    return [{ id: String(row.id).toLowerCase(), name: `${title || "model"}.3mf`, title, size: size > 0 ? size : null }];
  });
}

/** The profile the page shows: its own `?profileId=`, or the `#profileId-` of a link Thingport made. */
export function pickedProfile(href: string, files: AdaptFile[]): AdaptFile | null {
  const own = new URL(href).searchParams.get("profileId")?.toLowerCase();
  const id = own ?? parseCrealitycloudModelUrl(href)?.requestedProfileId ?? null;
  return files.find((file) => file.id === id) ?? null;
}

// The model each listed profile is of: its file's name comes from the profile's details, which want both.
const modelOf = new Map<string, string>();

const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);

export const CREALITYCLOUD_ADAPT: AdaptSite = {
  id: "crealitycloud",
  name: NAME,
  filesAre: "Creality Cloud's files are Creality Print projects",
  formats: [orcaFamilyFormat("Creality_Print", "7.2.1.5476")],

  async files(pageUrl) {
    const alias = parseCrealitycloudModelUrl(pageUrl)?.modelId;
    if (!alias) return [];
    const detail = await cxy("/v3/model/modelGroupDetail", { id: alias });
    const groupId = (detail.result?.groupItem as Record<string, unknown> | undefined)?.id;
    if (groupId == null) return [];
    const list = await cxy("/v3/model/3mfList", { page: 1, pageSize: 199, modelGroupId: groupId, filterType: 11 });
    const files = profileFiles(list.result);
    for (const file of files) modelOf.set(file.id, String(groupId));
    return files;
  },

  selected: (files) => pickedProfile(location.href, files),

  async download(_pageUrl, file, progress) {
    const token = pageCookie("model_token");
    const uid = pageCookie("model_user_id");
    if (!token || !uid) throw signInFirst(NAME);
    if (file.size && file.size > MAX_BYTES) throw tooBig(file.size, NAME);
    const stop = rotatePhrases(gettingFilePhrases, progress);
    const groupId = modelOf.get(file.id);
    const [link, detail] = await Promise.all([
      cxy("/v3/model/3mfDownload", { id: file.id }, { token, uid }),
      groupId ? cxy("/v3/model/3mfDetail", { modelGroupId: groupId, id: file.id }).catch(() => null) : null,
    ]).finally(stop);
    if (link.code === INVALID_TOKEN) throw signInFirst(NAME);
    const url = link.result?.downloadUrl;
    if (link.code !== 0 || typeof url !== "string" || !url.startsWith("https://")) {
      throw new Error(`${NAME} didn't give this file${link.msg ? ` (${link.msg})` : ""}. Try again in a moment.`);
    }
    // Its file host lets any page read a file, but not the name it's given: that comes from the profile's details.
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`${NAME}'s file server refused the download (${res.status}). Try again in a moment.`);
    const declared = Number(res.headers.get("Content-Length")) || null;
    if (declared && declared > MAX_BYTES) {
      void res.body?.cancel();
      throw tooBig(declared, NAME);
    }
    const bytes = await readBody(res, declared, NAME, progress);
    const named = detail?.result?.name;
    const filename = typeof named === "string" && /\.3mf$/i.test(named.trim()) ? named.trim() : file.name;
    return { bytes, filename: filename.replace(/[\\/:*?"<>|]+/g, "_") };
  },

  // The grid of its Cloud Slice and Download 3MF; a model nobody has bought shows a Purchase box instead.
  anchor: () => visible(document.querySelector<HTMLElement>(".model-detail-base-info-layout .model-info .btn-group")),

  // A row of its own under that grid, in the column it's in.
  place: placeAfter,

  // A class on <html>, set before the page paints and following the system where the user picked that.
  dark: () => document.documentElement.classList.contains("dark"),
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["class"] }),
};
