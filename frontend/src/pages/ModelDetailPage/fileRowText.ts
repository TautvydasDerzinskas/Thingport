import type { TFunction } from "i18next";
import { extOf, stemOf } from "../../utils/fileExtensions";

/** How one of a model's files is labeled in a list (3D preview, download picker): its name, with
 *  its position and type as the secondary line -- e.g. "Body" / "File 2 · STL". */
export function fileRowText(t: TFunction, filename: string, index: number): { primary: string; secondary: string } {
  const type = extOf(filename).toUpperCase();
  return {
    primary: stemOf(filename),
    secondary: type ? t("models:detail.fileMeta", { n: index + 1, type }) : t("models:detail.fileLabel", { n: index + 1 }),
  };
}
