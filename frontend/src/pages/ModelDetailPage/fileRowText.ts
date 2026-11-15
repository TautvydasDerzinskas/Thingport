import type { TFunction } from "i18next";
import { extOf, stemOf } from "../../utils/fileExtensions";
import { folderLabel } from "../../utils/fileFolders";

/** e.g. "Body" / "File 2 · STL", or "Body" / "Supported · STL" for one in a folder (Plate.folder), which tells it from
 *  a file of the same name in another. `shortName` is its name as the model's lists show a folder's files
 *  (utils/fileFolders.ts shortNames), so a file reads the same in each. */
export function fileRowText(
  t: TFunction,
  filename: string,
  index: number,
  folder?: string | null,
  shortName?: string,
): { primary: string; secondary: string } {
  const type = extOf(filename).toUpperCase();
  if (folder) {
    return {
      primary: shortName ?? stemOf(filename),
      secondary: [folderLabel(folder), type].filter(Boolean).join(" · "),
    };
  }
  return {
    primary: stemOf(filename),
    secondary: type
      ? t("models:detail.fileMeta", { n: index + 1, type })
      : t("models:detail.fileLabel", { n: index + 1 }),
  };
}
