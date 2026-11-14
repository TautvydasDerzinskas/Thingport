// Printables for Download adapted (content/adapted/): its 3MFs are PrusaSlicer projects, Bambu Studio ones or plain
// ones. A model's are listed and downloaded through Printables' API as its own Download does, signed in where the
// user is, since a club's or a bought model's files need that. Its buttons are found by their test ids: the
// sidebar's Download, and each file's own on the Files tab, where every 3MF gets a button of its own too.

import { MAX_BYTES, fetchFile, sourceFilename, tooBig } from "../../content/adapted/download";
import { placeAfter, visible, type AdaptFile, type AdaptSite } from "../../content/adapted/site";
import { gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { t } from "../../shared/i18n";
import { providerCredentialRequest } from "../../shared/providerCredentialRequest";
import { MANIFESTS } from "../index.generated";
import { printablesToken } from "./content";
import { parsePrintablesModelUrl } from "./urls.generated";

const GRAPHQL_URL = MANIFESTS.printables.endpoints.graphql;

const FILES_QUERY = "query ($id: ID!) { print(id: $id) { id stls { id name fileSize } } }";
// What the site's own Download asks for one file; model files, 3MFs among them, are its "stl" kind.
const LINK_MUTATION =
  "mutation ($printId: ID!, $source: DownloadSourceEnum!, $files: [DownloadFileInput!]) { getDownloadLink(printId: $printId, source: $source, files: $files) { ok errors { messages } output { files { id link } } } }";

type Answer = { data?: Record<string, unknown> | null; errors?: { message?: string }[] };

async function ask(query: string, variables: Record<string, unknown>, token: string | null): Promise<Answer> {
  const res = await providerCredentialRequest("printables-api", GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(t("adaptSite.answeredHttp", { site: "Printables", status: res.status }));
  return (await res.json()) as Answer;
}

/** Signed in where the user is; a session Printables no longer takes is left out, as it would refuse everything. */
async function graphql(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await printablesToken();
  let answer = await ask(query, variables, token).catch((err: unknown) => (token ? null : Promise.reject(err)));
  if (token && !answer?.data) answer = await ask(query, variables, null);
  if (!answer?.data) throw new Error(answer?.errors?.[0]?.message || t("printablesNoData"));
  return answer.data;
}

/** The model's 3MFs, from the files Printables lists for it. */
export function threeMfFiles(data: Record<string, unknown>): AdaptFile[] {
  const print = data.print as { stls?: { id?: unknown; name?: unknown; fileSize?: unknown }[] } | null;
  return (print?.stls ?? []).flatMap((file) =>
    typeof file.name === "string" && /\.3mf$/i.test(file.name) && file.id != null
      ? [{ id: String(file.id), name: file.name, size: typeof file.fileSize === "number" ? file.fileSize : null }]
      : [],
  );
}

const nameKey = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The 3MF rows of the Files tab, matched to the model's files by name, which a row shows without its extension and
 *  names that in a badge. Files of the same name match in the page's order. */
export function matchFileRows<T>(
  rows: { item: T; name: string; badge: string }[],
  files: AdaptFile[],
): { item: T; file: AdaptFile }[] {
  const left = files.map((file) => ({ file, name: nameKey(file.name.replace(/\.3mf$/i, "")) }));
  return rows.flatMap((row) => {
    if (nameKey(row.badge) !== "3mf") return [];
    const name = nameKey(row.name);
    const at = left.findIndex((candidate) => candidate.name === name);
    if (at < 0) return [];
    return [{ item: row.item, file: left.splice(at, 1)[0].file }];
  });
}

export const PRINTABLES_ADAPT: AdaptSite = {
  id: "printables",
  name: "Printables",
  get filesAre() {
    return t("adaptSite.threeMfsComeFrom", {
      site: "Printables",
      slicer: "PrusaSlicer",
      otherSlicer: "Bambu Studio",
    });
  },

  async files(pageUrl) {
    const modelId = parsePrintablesModelUrl(pageUrl)?.modelId;
    return modelId ? threeMfFiles(await graphql(FILES_QUERY, { id: modelId })) : [];
  },

  async download(pageUrl, file, progress) {
    if (file.size && file.size > MAX_BYTES) throw tooBig(file.size, "Printables");
    const printId = parsePrintablesModelUrl(pageUrl)?.modelId;
    if (!printId) throw new Error(t("adaptSite.unknownModel", { site: "Printables" }));
    const stop = rotatePhrases(gettingFilePhrases("Printables"), progress);
    const data = await graphql(LINK_MUTATION, {
      printId,
      source: "model_detail",
      files: [{ fileType: "stl", ids: [file.id] }],
    }).finally(stop);
    const answer = data.getDownloadLink as {
      ok?: boolean;
      errors?: { messages?: string[] }[];
      output?: { files?: { link?: string }[] };
    } | null;
    const link = answer?.output?.files?.[0]?.link;
    if (!answer?.ok || !link || !link.startsWith("https://")) {
      const why = answer?.errors?.flatMap((error) => error.messages ?? []).join(" ");
      throw new Error(
        why
          ? t("adaptSite.fileNotGivenSignInReason", { site: "Printables", reason: why })
          : t("adaptSite.fileNotGivenSignIn", { site: "Printables" }),
      );
    }
    const { res, bytes } = await fetchFile(link, "Printables", progress);
    return { bytes, filename: sourceFilename(res, link) };
  },

  anchor: () => visible(document.querySelector<HTMLElement>('[data-testid="show-download-files"]')),

  // Under the sidebar's Download, as its own row of the column it's in, not in the Download's row (a paid model's
  // has the club's and the store's buttons beside it).
  place: (host, anchor) => placeAfter(host, anchor.closest<HTMLElement>(".checkout-buttons") ?? anchor),

  fileRows(files) {
    const rows = [...document.querySelectorAll<HTMLElement>(".download-item")].flatMap((item) => {
      const button = visible(item.querySelector<HTMLElement>('[data-testid="download-file"]'));
      const title = item.querySelector("h5");
      return button && title
        ? [
            {
              item: button,
              name: title.querySelector(".shrink")?.textContent ?? "",
              badge: title.querySelector(".badge")?.textContent ?? "",
            },
          ]
        : [];
    });
    return matchFileRows(rows, files).map(({ item, file }) => ({ anchor: item, file }));
  },

  // The last of the file's stacked buttons (EasyPrint, Slice, Download), in the same grid.
  placeInRow: (host, anchor) => anchor.after(host),

  // A class on <html>: "theme-dark", "theme-light", or neither, following the system.
  dark() {
    const html = document.documentElement.classList;
    if (html.contains("theme-dark")) return true;
    return !html.contains("theme-light") && matchMedia("(prefers-color-scheme: dark)").matches;
  },
  themeWatch: () => ({ target: document.documentElement, attributeFilter: ["class"] }),
};
