// eufyMake's Make it Real for Download adapted (content/adapted/): its print files are eufyMake Studio projects, and
// a model's own 3MFs come from wherever they were made, Bambu Studio mostly. Both are in its public model data, with
// links signed for a day that its file host lets the page read: no sign-in needed, as for Thingport's own imports.
// The button goes under its Open in Slicer and Download, for the 3MF picked in its file list.

import { MAX_BYTES, fetchFile, safeFilename, tooBig } from "../../content/adapted/download";
import { placeAfter, visible, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { t } from "../../shared/i18n";
import { parseEufymakeModelUrl } from "./urls.generated";

const API = "https://aiot-wapi-eu.ankermake.com/web/modelbase";
const NAME = "eufyMake";
const HEADERS = { "Content-Type": "application/json", "App-Name": "makeitreal", "Model-Type": "WEB" };
// Its answers for a model it doesn't have (deleted, or never was), and for asking too often.
const NO_MODEL = 220001;
const TOO_FAST = 220010;
// Its page's parts, by the start of their class names: the end is a hash that changes with each release.
const FILE_LIST = '[class*="Files-module--filesBox"]';
const ROW = '[class*="Files-module--fileItem"]';
const PICKED_ROW = `${ROW}[class*="Files-module--active"]`;

/** A 3MF with its link, which works for a day after the model data was read, and the row its file list shows it in:
 *  "<box>:<place>", as the rows show only names, which files can share. */
type Linked = AdaptFile & { link: string; row: string };

const positive = (value: unknown) => (typeof value === "number" && value > 0 ? Math.round(value) : null);
const is3mf = (name: unknown): name is string => typeof name === "string" && /\.3mf$/i.test(name);
const isLink = (url: unknown): url is string => typeof url === "string" && url.startsWith("https://");

/** The 3MFs its model data lists, as the page lists them: the print files (`p<id>`), then the model files
 *  (`f<id>`). The zip of everything isn't one. */
export function modelFiles(model: Record<string, unknown> | null | undefined): Linked[] {
  const prints = Array.isArray(model?.model_print_infos) ? (model.model_print_infos as Record<string, unknown>[]) : [];
  // The page's boxes: every print file, then the model files of this type, each in its order.
  const own = (Array.isArray(model?.model_file) ? (model.model_file as Record<string, unknown>[]) : []).filter(
    (file) => file?.file_type === 1,
  );
  const ownBox = prints.length ? 1 : 0;
  return [
    ...prints.flatMap((print, place) =>
      print?.info_id != null && is3mf(print.print_name) && isLink(print.file_3mf_key)
        ? [
            {
              id: `p${String(print.info_id)}`,
              name: print.print_name,
              size: positive(print.print_size),
              link: print.file_3mf_key,
              row: `0:${place}`,
            },
          ]
        : [],
    ),
    ...own.flatMap((file, place) =>
      file.file_id != null && is3mf(file.file_name) && isLink(file.download_link)
        ? [
            {
              id: `f${String(file.file_id)}`,
              name: file.file_name,
              size: positive(file.file_size),
              link: file.download_link,
              row: `${ownBox}:${place}`,
            },
          ]
        : [],
    ),
  ];
}

/** The 3MF behind the row picked in its file list, by the row's box and place ("<box>:<place>"): "other" where that
 *  row is another kind of file. */
export function pickedFile(files: AdaptFile[], row: string): AdaptFile | "other" {
  return files.find((file) => "row" in file && file.row === row) ?? "other";
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
  if (res.status === 429 || body?.code === TOO_FAST) throw new Error(t("adaptSite.slowDown", { site: NAME }));
  if (body?.code === NO_MODEL) return [];
  if (body?.code !== 0) throw new Error(t("adaptSite.noFileList", { site: NAME }));
  return modelFiles(body.data?.model);
}

export const EUFYMAKE_ADAPT: AdaptSite = {
  id: "eufymake",
  name: NAME,
  get filesAre() {
    return t("adaptSite.threeMfsComeFrom", { site: NAME, slicer: "eufyMake Studio", otherSlicer: "Bambu Studio" });
  },

  async files(pageUrl) {
    const modelId = parseEufymakeModelUrl(pageUrl)?.modelId;
    if (!modelId) return [];
    return (await readModel(modelId)).map(({ link: _link, ...file }) => file);
  },

  selected(files) {
    const picked = document.querySelector<HTMLElement>(PICKED_ROW);
    const boxes = [...document.querySelectorAll(FILE_LIST)];
    const box = picked ? boxes.findIndex((each) => each.contains(picked)) : -1;
    if (!picked || box < 0) return null;
    return pickedFile(files, `${box}:${[...boxes[box].querySelectorAll(ROW)].indexOf(picked)}`);
  },

  async download(pageUrl, file, progress) {
    if (file.size && file.size > MAX_BYTES) throw tooBig(file.size, NAME);
    const modelId = parseEufymakeModelUrl(pageUrl)?.modelId;
    const stop = rotatePhrases(gettingFilePhrases(NAME), progress);
    let link: string | undefined;
    try {
      // Its links stop working a day after the model was read: a fresh one each time.
      if (modelId) link = (await readModel(modelId)).find((each) => each.id === file.id)?.link;
    } finally {
      stop();
    }
    if (!link) throw new Error(t("adaptSite.fileNotFound", { site: NAME }));
    // Its file host lets the page read a file, but gives no name: that's the file's own.
    const { bytes } = await fetchFile(link, NAME, progress, { init: { credentials: "omit" } });
    return { bytes, filename: safeFilename(file.name) };
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
