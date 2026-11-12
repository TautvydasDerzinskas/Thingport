// eufyMake's Make it Real for Download adapted (content/adapted/): its print files are eufyMake Studio projects, and
// a model's own 3MFs come from wherever they were made, Bambu Studio mostly. Both are in its public model data, with
// links signed for a day that its file host lets the page read: no sign-in needed, as for Thingport's own imports.
// The button goes under its Open in Slicer and Download, for the 3MF picked in its file list.

import { MAX_BYTES, readBody, tooBig } from "../../content/adapted/download";
import { placeAfter, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { parseEufymakeModelUrl } from "./urls.generated";

const API = "https://aiot-wapi-eu.ankermake.com/web/modelbase";
const NAME = "eufyMake";
const HEADERS = { "Content-Type": "application/json", "App-Name": "makeitreal", "Model-Type": "WEB" };
// Its answers for a model it doesn't have (deleted, or never was), and for asking too often.
const NO_MODEL = 220001;
const TOO_FAST = 220010;
// Its page's parts, by the start of their class names: the end is a hash that changes with each release.
const FILE_LIST = '[class*="Files-module--filesBox"]';
const PICKED_ROW = '[class*="Files-module--fileItem"][class*="Files-module--active"]';
const ROW_NAME = 'p[class*="Files-module--fileName"]';

/** A 3MF with its link, which works for a day after the model data was read. */
type Linked = AdaptFile & { link: string };

const positive = (value: unknown) => (typeof value === "number" && value > 0 ? Math.round(value) : null);
const is3mf = (name: unknown): name is string => typeof name === "string" && /\.3mf$/i.test(name);
const isLink = (url: unknown): url is string => typeof url === "string" && url.startsWith("https://");

/** The 3MFs its model data lists, as the page lists them: the print files (`p<id>`), then the model files
 *  (`f<id>`). The zip of everything isn't one. */
export function modelFiles(model: Record<string, unknown> | null | undefined): Linked[] {
  const prints = Array.isArray(model?.model_print_infos) ? (model.model_print_infos as Record<string, unknown>[]) : [];
  const own = Array.isArray(model?.model_file) ? (model.model_file as Record<string, unknown>[]) : [];
  return [
    ...prints.flatMap((print) =>
      print?.info_id != null && is3mf(print.print_name) && isLink(print.file_3mf_key)
        ? [
            {
              id: `p${String(print.info_id)}`,
              name: print.print_name,
              size: positive(print.print_size),
              link: print.file_3mf_key,
            },
          ]
        : [],
    ),
    ...own.flatMap((file) =>
      file?.file_id != null && file.file_type === 1 && is3mf(file.file_name) && isLink(file.download_link)
        ? [
            {
              id: `f${String(file.file_id)}`,
              name: file.file_name,
              size: positive(file.file_size),
              link: file.download_link,
            },
          ]
        : [],
    ),
  ];
}

/** A name as its file list shows it: past `max` characters, its start and end with "..." between. */
export function shownName(name: string, max = 28): string {
  if (name.length <= max) return name;
  const keep = Math.floor((max - 3) / 1.3);
  return `${name.slice(0, keep)}...${name.slice(name.length - keep)}`;
}

/** The 3MF behind the row picked in its file list: the list it's in (print files first, where there are any) and the
 *  name it shows. None where the row is another kind of file. */
export function pickedFile(files: AdaptFile[], list: number, shown: string): AdaptFile | null {
  const prints = files.some((file) => file.id.startsWith("p"));
  const kind = prints && list === 0 ? "p" : "f";
  return files.find((file) => file.id.startsWith(kind) && shownName(file.name) === shown) ?? null;
}

async function readModel(modelId: string): Promise<Linked[]> {
  const res = await fetch(`${API}/model/get_model_detail`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ model_id: modelId }),
    credentials: "omit",
  });
  const body = (await res.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    data?: { model?: Record<string, unknown> } | null;
  } | null;
  if (res.status === 429 || body?.code === TOO_FAST)
    throw new Error(`${NAME} asks to slow down. Try again in a moment.`);
  if (body?.code === NO_MODEL) return [];
  if (body?.code !== 0) throw new Error(`${NAME} didn't say which files this model has. Try again in a moment.`);
  return modelFiles(body.data?.model);
}

const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);

export const EUFYMAKE_ADAPT: AdaptSite = {
  id: "eufymake",
  name: NAME,
  filesAre: "eufyMake's 3MFs come from eufyMake Studio, Bambu Studio and other apps",

  async files(pageUrl) {
    const modelId = parseEufymakeModelUrl(pageUrl)?.modelId;
    if (!modelId) return [];
    return (await readModel(modelId)).map(({ link: _link, ...file }) => file);
  },

  selected(files) {
    const row = document.querySelector<HTMLElement>(PICKED_ROW);
    const shown = row?.querySelector(ROW_NAME)?.textContent?.trim();
    if (!row || !shown) return null;
    const list = [...document.querySelectorAll(FILE_LIST)].findIndex((box) => box.contains(row));
    return pickedFile(files, list, shown);
  },

  async download(pageUrl, file, progress) {
    if (file.size && file.size > MAX_BYTES) throw tooBig(file.size, NAME);
    const modelId = parseEufymakeModelUrl(pageUrl)?.modelId;
    const stop = rotatePhrases(gettingFilePhrases, progress);
    let link: string | undefined;
    try {
      // Its links stop working a day after the model was read: a fresh one each time.
      if (modelId) link = (await readModel(modelId)).find((each) => each.id === file.id)?.link;
    } finally {
      stop();
    }
    if (!link)
      throw new Error(`Couldn't find this file among the model's on ${NAME}. Reload the page, then try again.`);
    // Its file host lets the page read a file, but gives no name: that's the file's own.
    const res = await fetch(link, { credentials: "omit" });
    if (!res.ok) throw new Error(`${NAME}'s file server refused the download (${res.status}). Try again in a moment.`);
    const declared = Number(res.headers.get("Content-Length")) || null;
    if (declared && declared > MAX_BYTES) {
      void res.body?.cancel();
      throw tooBig(declared, NAME);
    }
    const bytes = await readBody(res, declared, NAME, progress);
    return { bytes, filename: file.name.replace(/[\\/:*?"<>|]+/g, "_") };
  },

  // Its Open in Slicer and Download ("Make the same" on City Print and 3D Paint models), under the file list.
  anchor: () =>
    visible(
      document.querySelector<HTMLElement>('[class*="Files-module--fileContainer"] > [class*="Trigger-module--btnBox"]'),
    ),

  // A full-width row of its own between them and the likes, as far from each as they are from one another.
  place(host, anchor) {
    placeAfter(host, anchor, { spaced: true });
    host.style.margin = "0 0 10px";
  },

  // A deleted model's page, with no files and no buttons.
  unavailable: () => Boolean(document.querySelector('[class*="ModelDetail-module--emptyWrapper"]')),

  // It has only its dark look.
  dark: () => true,
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["class"] }),
};
