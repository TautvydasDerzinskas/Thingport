// MakerOnline for Download adapted (content/adapted/): its print profiles are Anycubic Slicer Next projects, one 3MF
// each, and a model's own 3MFs come from wherever they were made. They're listed in its public model data; a file's
// link is signed in the page itself, as its own Download does (background.ts), for the user signed in there. The
// button goes under its Download, for the profile or file picked above it.

import { MAX_BYTES, readBody, tooBig } from "../../content/adapted/download";
import { orcaFamilyFormat } from "../../content/adapted/formats";
import { pageCookie, placeAfter, signInFirst, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { request } from "../../shared/messages";
import { MANIFESTS } from "../index.generated";
import { MAKERONLINE_PICK } from "./pick";
import { parseMakeronlineModelUrl } from "./urls.generated";

const NAME = "MakerOnline";
const ACCESS_COOKIE = MANIFESTS.makeronline.sessionCookies.token;
// Its tabs: the print profiles, and the model's own files.
const PROFILES_TAB = ".print-and-model-container .file-container";
const FILES_TAB = ".print-and-model-container .model-profile-files";

/** What its download call needs of a file: the file's key, and a print profile's id (2) or the model's (1). */
type Signing = { key: string; fileType: 1 | 2; signId: number };

const positive = (value: unknown) => (typeof value === "number" && value > 0 ? Math.round(value) : null);
const is3mf = (name: unknown): name is string => typeof name === "string" && /\.3mf$/i.test(name);

/** The 3MFs its model data lists: each print profile's (`p<id>`), shown by the profile's name, then the model's own
 *  (`f<file id>`), in the site's order. */
export function moldFiles(data: Record<string, unknown> | null | undefined): (AdaptFile & Signing)[] {
  const moldId = data?.id;
  const profiles = Array.isArray(data?.print_profiles) ? (data.print_profiles as Record<string, unknown>[]) : [];
  const own = Array.isArray(data?.files) ? (data.files as Record<string, unknown>[]) : [];
  return [
    ...profiles.flatMap((profile) => {
      const download = profile?.download as Record<string, unknown> | undefined;
      if (!Number.isSafeInteger(profile?.id) || typeof download?.key !== "string" || !is3mf(download.file_name))
        return [];
      const title = typeof profile.title === "string" && profile.title.trim() ? profile.title.trim() : undefined;
      return [
        {
          id: `p${String(profile.id)}`,
          name: download.file_name,
          title,
          size: positive(profile.total_size),
          key: download.key,
          fileType: 2 as const,
          signId: profile.id as number,
        },
      ];
    }),
    ...(Number.isSafeInteger(moldId)
      ? own.flatMap((file) => {
          if (file?.file_id == null || typeof file.key !== "string" || !is3mf(file.file_name)) return [];
          return [
            {
              id: `f${String(file.file_id)}`,
              name: file.file_name,
              size: positive(file.file_size),
              key: file.key,
              fileType: 1 as const,
              signId: moldId as number,
            },
          ];
        })
      : []),
  ];
}

/** The file the page has picked, from its picks kept on <html> ("<profile id>|<file id>") and the tab it shows: null
 *  where it hasn't picked one there, "other" where it's a file other than a 3MF. */
export function pickedFile(files: AdaptFile[], picks: string | null, filesTab: boolean): AdaptFile | null | "other" {
  const [profile = "", file = ""] = (picks ?? "").split("|");
  const id = filesTab ? file && `f${file}` : profile && `p${profile}`;
  if (!id) return null;
  return files.find((each) => each.id === id) ?? "other";
}

/** The file picked while the page's picks can't be read yet: on the print profiles tab, the one it highlights, by
 *  `title`; on the files tab, which shows nothing to go by, "other", so that the first file isn't downloaded in place
 *  of the one picked there. */
export function unreadPick(
  files: AdaptFile[],
  filesTab: boolean,
  title: string | null | undefined,
): AdaptFile | null | "other" {
  if (filesTab) return "other";
  if (!title) return null;
  return files.find((file) => file.title === title) ?? "other";
}

const signing = new Map<string, Signing>();

// How long to wait between asks while the page's store isn't there yet: a little longer each time, for about a minute
// on a slow page. After that, the next look at the picks (selected) asks again.
export const WATCH_DELAYS_MS = [1000, 1000, 2000, 2000, 4000, 4000, 8000, 8000, 15000, 15000];
let watching: Promise<boolean> | null = null;
let watched = false;

/** Asks the page to keep its picks where this can read them; again a little later while the page is still starting
 *  and still on the same model, so a slow page still gets its picks read. One round of asks at a time. */
export function watchPicks(): Promise<boolean> {
  if (watched) return Promise.resolve(true);
  if (watching) return watching;
  const page = location.href;
  watching = (async () => {
    for (let attempt = 0; ; attempt++) {
      const ok = await request("WATCH_MAKERONLINE_PICK").catch(() => false);
      if (ok) return (watched = true);
      if (attempt >= WATCH_DELAYS_MS.length || location.href !== page) return false;
      await new Promise((resolve) => setTimeout(resolve, WATCH_DELAYS_MS[attempt]));
      if (location.href !== page) return false;
    }
  })().finally(() => {
    watching = null;
  });
  return watching;
}

/** For tests: forgets that the page's picks are watched. */
export function resetPickWatch(): void {
  watched = false;
  watching = null;
}

const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);

export const MAKERONLINE_ADAPT: AdaptSite = {
  id: "makeronline",
  name: NAME,
  filesAre: "MakerOnline's print profiles are Anycubic Slicer Next projects",
  // Built on OrcaSlicer 2.3.1, it writes `BambuStudio-` as its app (adapter/slicers/anycubicslicernext.ts).
  formats: [orcaFamilyFormat("BambuStudio", "2.3.1")],

  async files(pageUrl) {
    const modelId = parseMakeronlineModelUrl(pageUrl)?.modelId;
    if (!modelId) return [];
    const res = await fetch(`${location.origin}/api/mold/detail?${new URLSearchParams({ id: modelId })}`, {
      headers: { Accept: "application/json", lang: "en" },
      credentials: "omit",
    });
    const body = (await res.json()) as { code?: number; data?: Record<string, unknown> | null };
    const files = body.code === 0 ? moldFiles(body.data) : [];
    for (const { id, key, fileType, signId } of files) signing.set(id, { key, fileType, signId });
    if (files.length) void watchPicks();
    return files.map(({ key: _key, fileType: _fileType, signId: _signId, ...file }) => file);
  },

  // The one picked in the tab shown. Before the page's picks can be read, its highlighted print profile, by name.
  selected(files) {
    const picks = document.documentElement.getAttribute(MAKERONLINE_PICK);
    const filesTab = Boolean(document.querySelector(FILES_TAB));
    if (picks !== null) return pickedFile(files, picks, filesTab);
    // Not read yet: ask the page again, in case it was still starting when it was last asked.
    watched = false;
    void watchPicks();
    const title = document.querySelector<HTMLImageElement>(`${PROFILES_TAB} .file-item.active .icon img`)?.alt?.trim();
    return unreadPick(files, filesTab, title);
  },

  async download(_pageUrl, file, progress) {
    if (!pageCookie(ACCESS_COOKIE)) throw signInFirst(NAME);
    if (file.size && file.size > MAX_BYTES) throw tooBig(file.size, NAME);
    const sign = signing.get(file.id);
    if (!sign)
      throw new Error(`Couldn't find this file among the model's on ${NAME}. Reload the page, then try again.`);
    const stop = rotatePhrases(gettingFilePhrases(NAME), progress);
    const signed = await request("SIGN_MAKERONLINE_FILE", {
      key: sign.key,
      fileType: sign.fileType,
      id: sign.signId,
      name: file.name,
    }).finally(stop);
    // Its file host lets any page read a file, but not the name it's given: that's the file's own name.
    const res = await fetch(signed, { credentials: "omit" });
    if (!res.ok) throw new Error(`${NAME}'s file server refused the download (${res.status}). Try again in a moment.`);
    const declared = Number(res.headers.get("Content-Length")) || null;
    if (declared && declared > MAX_BYTES) {
      void res.body?.cancel();
      throw tooBig(declared, NAME);
    }
    const bytes = await readBody(res, declared, NAME, progress);
    return { bytes, filename: file.name.replace(/[\\/:*?"<>|]+/g, "_") };
  },

  // Its Download, with "Open in Anycubic Slicer Next" beside it, under the list of the tab shown.
  anchor: () => visible(document.querySelector<HTMLElement>(".print-and-model-container .button-groups")),

  // A full-width row of its own under the two, as far below them as they are below the list.
  place(host, anchor) {
    placeAfter(host, anchor, { spaced: true });
    host.style.margin = "8px 0 0";
  },

  // Light only in a browser: Anycubic Slicer Next's built-in one has its own dark theme.
  dark: () => false,
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["class"] }),
};
