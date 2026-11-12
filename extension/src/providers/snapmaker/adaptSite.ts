// Snapmaker Space for Download adapted (content/adapted/): its files are Snapmaker Orca projects. A model's print
// profiles come from its public model detail, and a profile's file from its download API as the user signed in there,
// the profile being the one picked on the page. The button goes under the site's Download 3MF.
//
// Its sign-in is renewed by the page and by Grab's background alone: a token it no longer takes means reloading the
// page, never a refresh from here, as its refresh tokens work once (snapmaker-provider notes).

import { MAX_BYTES, readBody, tooBig } from "../../content/adapted/download";
import { orcaFamilyFormat } from "../../content/adapted/formats";
import { pageCookie, placeAfter, signInFirst, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { providerCredentialRequest } from "../../shared/providerCredentialRequest";
import { MANIFESTS } from "../index.generated";
import { parseSnapmakerModelUrl } from "./urls.generated";

const API = MANIFESTS.snapmaker.endpoints.api;
const NAME = "Snapmaker Space";
const OK = 200;
// Its answer to a missing or expired token.
const UNAUTHORIZED = 110002;
// Where its download links point first; they redirect, without the headers a page's fetch needs, to the site itself.
const LINK_HOST = "models.snapmaker.com";
const SITE = "https://space.snapmaker.com";

/** The profiles its model detail lists, as files: those with a file to download, shown by their titles. */
export function profileFiles(data: Record<string, unknown> | null | undefined): AdaptFile[] {
  const profiles = Array.isArray(data?.printProfiles) ? (data.printProfiles as Record<string, unknown>[]) : [];
  return profiles.flatMap((p) => {
    if (p?.id == null || !p.gcodeUrl || typeof p.fileName !== "string") return [];
    const title = [p.translatedTitle, p.title].find((t): t is string => typeof t === "string" && Boolean(t.trim()));
    const size = Number(p.fileSize);
    return [{ id: String(p.id), name: p.fileName, title: title?.trim(), size: size > 0 ? size : null }];
  });
}

/** A download link as the page itself would end up fetching it: on the site, where the page may read it. */
export function onSite(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname === LINK_HOST) return `${SITE}${url.pathname}${url.search}`;
  return url.origin === SITE ? url.href : null;
}

const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);

export const SNAPMAKER_ADAPT: AdaptSite = {
  id: "snapmaker",
  name: NAME,
  filesAre: "Snapmaker Space's files are Snapmaker Orca projects",
  formats: [orcaFamilyFormat("Snapmaker_Orca", "2.4.0")],

  async files(pageUrl) {
    const modelId = parseSnapmakerModelUrl(pageUrl)?.modelId;
    if (!modelId) return [];
    const res = await fetch(`${API}/model/detail/${encodeURIComponent(modelId)}`, { credentials: "omit" });
    const body = (await res.json()) as { code?: number; data?: Record<string, unknown> };
    return body.code === OK ? profileFiles(body.data) : [];
  },

  // `#profileId-<id>`, which the page writes as profiles are picked.
  selected: (files) => {
    const id = parseSnapmakerModelUrl(location.href)?.requestedProfileId;
    return files.find((file) => file.id === id) ?? null;
  },

  async download(pageUrl, file, progress) {
    const token = pageCookie("login_access_token");
    if (!token) throw signInFirst(NAME);
    if (file.size && file.size > MAX_BYTES) throw tooBig(file.size, NAME);
    const modelId = parseSnapmakerModelUrl(pageUrl)?.modelId;
    if (!modelId) throw new Error(`Couldn't tell which ${NAME} model this page is.`);
    const stop = rotatePhrases(gettingFilePhrases, progress);
    const answer = await providerCredentialRequest("snapmaker-api", `${API}/model/download/${modelId}`, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-custom-site": "Web-Space",
        Authorization: `Bearer ${token}`,
      },
      credentials: "omit",
    })
      .then((res) => res.json() as Promise<{ code?: number; msg?: string; data?: Record<string, unknown> }>)
      .finally(stop);
    if (answer.code === UNAUTHORIZED) {
      throw new Error(`${NAME} didn't take your sign-in: it may have run out. Reload the page, then try again.`);
    }
    const profiles = Array.isArray(answer.data?.printProfiles)
      ? (answer.data.printProfiles as Record<string, unknown>[])
      : [];
    const link = profiles.find((p) => String(p?.profileId) === file.id)?.downloadUrl;
    const url = typeof link === "string" ? onSite(link) : null;
    if (answer.code !== OK || !url) {
      throw new Error(`${NAME} didn't give this file${answer.msg ? ` (${answer.msg})` : ""}. Try again in a moment.`);
    }
    const res = await fetch(url);
    // A link it doesn't take answers 200 with a short plain-text note rather than the file.
    if (!res.ok || /^text\/plain/i.test(res.headers.get("Content-Type") ?? "")) {
      void res.body?.cancel();
      throw new Error(`${NAME}'s file server refused the download (${res.status}). Try again in a moment.`);
    }
    const declared = Number(res.headers.get("Content-Length")) || null;
    if (declared && declared > MAX_BYTES) {
      void res.body?.cancel();
      throw tooBig(declared, NAME);
    }
    const bytes = await readBody(res, declared, NAME, progress);
    return { bytes, filename: file.name.replace(/[\\/:*?"<>|]+/g, "_") };
  },

  // The wrapper of its split Download 3MF button (whose ▾ is the one menu button in the profiles' column), which also
  // positions that menu: the button goes after it, not in it.
  anchor() {
    const column = document.querySelector(".config-popup-scroll")?.closest<HTMLElement>(".space-y-4");
    const toggle = column?.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
    return visible(toggle?.closest<HTMLElement>(".relative") ?? null);
  },

  // Its column spaces its children itself.
  place: (host, anchor) => placeAfter(host, anchor, { spaced: true }),

  // Light only so far; a `dark` class on <body> if it ever shows its dark theme.
  dark: () => document.body.classList.contains("dark"),
  themeWatch: () => ({ target: document.body, attributeFilter: ["class"] }),
};
