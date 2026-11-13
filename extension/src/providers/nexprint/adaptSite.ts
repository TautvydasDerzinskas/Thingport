// NexPrint for Download adapted (content/adapted/): its files are Elegoo Slicer projects. A model's print profiles
// come from its public model data, and a profile's file from the link its API signs for the user signed in there, the
// profile being the one picked on the page. The button goes under the site's Download, and each profile 3MF in its
// Files list gets a small one beside its own.

import { MAX_BYTES, readBody, tooBig } from "../../content/adapted/download";
import { orcaFamilyFormat } from "../../content/adapted/formats";
import { pageCookie, placeAfter, signInFirst, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { providerCredentialRequest } from "../../shared/providerCredentialRequest";
import { parseNexprintModelUrl } from "./urls.generated";

const API = "https://www.nexprint.com/gateway/api/v1";
const NAME = "NexPrint";
const HEADERS = { "client-id": "Nexprint", "user-lang": "en" };
// Its API's answer when the user isn't signed in.
const SIGNED_OUT = 401;
// The kind of file its signed links are for: a print profile's 3MF.
const PROFILE_FILE = "5";

/** What its link signing needs of a profile: the profile's own id and its file's. */
type Signing = { bizId: string; fileId: string };

/** The profiles its model data lists, as files by their `G…` ids: the open ones with a file, shown by their names. */
export function profileFiles(data: Record<string, unknown> | null | undefined): (AdaptFile & Signing)[] {
  const settings = Array.isArray(data?.settingInfoList) ? (data.settingInfoList as Record<string, unknown>[]) : [];
  return settings.flatMap((s) => {
    const file = s?.settingFile as Record<string, unknown> | undefined;
    if (typeof s?.settingOutId !== "string" || s.open === false || s.isInvalid === true) return [];
    if (file?.fileId == null || typeof file.fileName !== "string" || s.id == null) return [];
    const english = (s.settingNameTranslateMap as Record<string, unknown> | undefined)?.en;
    const title = [english, s.settingName].find((t): t is string => typeof t === "string" && Boolean(t.trim()));
    const size = Number(file.fileSize);
    return [
      {
        id: s.settingOutId.toUpperCase(),
        name: file.fileName,
        title: title?.trim(),
        size: size > 0 ? Math.round(size) : null,
        bizId: String(s.id),
        fileId: String(file.fileId),
      },
    ];
  });
}

const fileKey = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The Files list's rows matched to the model's profiles by file name, each name once, in the page's order. */
export function matchFileRows<T>(
  rows: { item: T; name: string }[],
  files: AdaptFile[],
): { item: T; file: AdaptFile }[] {
  const left = [...files];
  return rows.flatMap((row) => {
    const at = left.findIndex((file) => fileKey(file.name) === fileKey(row.name));
    return at < 0 ? [] : [{ item: row.item, file: left.splice(at, 1)[0] }];
  });
}

/** The profile the page shows: the `?printConfigId=` it writes as one is picked, else the `#profileId-` of a link
 *  Thingport made, which the page doesn't change. */
export function pickedProfile(href: string, files: AdaptFile[]): AdaptFile | null {
  const own = new URL(href).searchParams.get("printConfigId")?.trim().toUpperCase();
  const linked = parseNexprintModelUrl(href)?.requestedProfileId;
  return files.find((file) => file.id === own) ?? files.find((file) => file.id === linked) ?? null;
}

const signing = new Map<string, Signing>();

/** The sign-in its own pages send: the cookie they write, else the copy they keep. */
function token(): string | null {
  const cookie = pageCookie("auth_token");
  if (cookie) return cookie;
  try {
    const stored = JSON.parse(localStorage.getItem("ACCOUNT_INFO") ?? "null") as { access_token?: unknown } | null;
    return typeof stored?.access_token === "string" && stored.access_token ? stored.access_token : null;
  } catch {
    return null;
  }
}

// Its footer is a grid that pins the likes to its second row: while Grab's button is in it, the button takes that
// row and the likes the third, and the grid is as it was once the button goes.
const LAYOUT_ID = "thingport-grab-adapted-layout";
const LAYOUT = [
  ".print-config-footer--detail:has(> #thingport-grab-adapted){grid-template-rows:48px 48px 48px}",
  ".print-config-footer--detail:has(> #thingport-grab-adapted) > .left-div-1{grid-row:3}",
  ".print-config-footer--detail > #thingport-grab-adapted{grid-column:1 / -1;grid-row:2}",
].join("\n");

function layOut(): void {
  if (document.getElementById(LAYOUT_ID)) return;
  const style = document.createElement("style");
  style.id = LAYOUT_ID;
  style.textContent = LAYOUT;
  document.head.append(style);
}

const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);

export const NEXPRINT_ADAPT: AdaptSite = {
  id: "nexprint",
  name: NAME,
  filesAre: "NexPrint's files are Elegoo Slicer projects",
  formats: [orcaFamilyFormat("ElegooSlicer", "1.5.3.5", "2.4.2")],

  async files(pageUrl) {
    const modelId = parseNexprintModelUrl(pageUrl)?.modelId;
    if (!modelId) return [];
    const query = new URLSearchParams({ id: modelId, loadSupportPrintProfile: "true" });
    const res = await fetch(`${API}/model-library-server/model-base-info/get?${query}`, {
      headers: HEADERS,
      credentials: "omit",
    });
    const body = (await res.json()) as { code?: number; data?: Record<string, unknown> | null };
    const files = body.code === 0 ? profileFiles(body.data) : [];
    for (const { id, bizId, fileId } of files) signing.set(id, { bizId, fileId });
    return files.map(({ bizId: _bizId, fileId: _fileId, ...file }) => file);
  },

  selected: (files) => pickedProfile(location.href, files),

  async download(_pageUrl, file, progress) {
    const auth = token();
    if (!auth) throw signInFirst(NAME);
    if (file.size && file.size > MAX_BYTES) throw tooBig(file.size, NAME);
    const sign = signing.get(file.id);
    if (!sign)
      throw new Error(`Couldn't find this file among the model's on ${NAME}. Reload the page, then try again.`);
    const stop = rotatePhrases(gettingFilePhrases(NAME), progress);
    const answer = await providerCredentialRequest(
      "nexprint-api",
      `${API}/model-library-server/common/presigned-download-url`,
      {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
        body: JSON.stringify({ fileInfoList: [{ fileId: sign.fileId, type: PROFILE_FILE, bizId: sign.bizId }] }),
        credentials: "omit",
      },
    )
      .then((res) => res.json() as Promise<{ code?: number; msg?: string; data?: Record<string, unknown> | null }>)
      .finally(stop);
    if (answer.code === SIGNED_OUT) throw signInFirst(NAME);
    const signed = (answer.data?.fileInfoList as Record<string, unknown>[] | undefined)?.[0]?.resultUrl;
    if (answer.code !== 0 || typeof signed !== "string" || !signed.startsWith("https://")) {
      throw new Error(`${NAME} didn't give this file${answer.msg ? ` (${answer.msg})` : ""}. Try again in a moment.`);
    }
    // Its file host lets any page read a file, but not the name it's given: that's the profile's file name.
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

  // Its Download, in the footer under the profiles; the tab bar that sticks on scrolling has another.
  anchor: () => visible(document.querySelector<HTMLElement>(".print-config-footer--detail .master-button-div")),

  // A row of its own in the footer's grid, between the Download and the likes.
  place(host, anchor) {
    layOut();
    placeAfter(host, anchor);
  },

  fileRows(files) {
    const rows = [...document.querySelectorAll<HTMLElement>("#model-detail-files .files-div li")].flatMap((row) => {
      const actions = visible(row.querySelector<HTMLElement>(".file-operation"));
      const name = row.querySelector(".filename-span")?.textContent ?? "";
      return actions && name ? [{ item: actions, name }] : [];
    });
    return matchFileRows(rows, files).map(({ item, file }) => ({ anchor: item, file }));
  },

  // First of its buttons for the file, small, beside them.
  placeInRow(host, anchor) {
    host.dataset.row = "pill";
    anchor.prepend(host);
  },

  // Light only in a browser. Elegoo Slicer's built-in browser sets a `dark` class on <html>, but Grab doesn't run there,
  // and the site's own stylesheet has next to nothing for it.
  dark: () => false,
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["class"] }),
};
