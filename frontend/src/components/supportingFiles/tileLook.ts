import type { ContentKind, FileView } from "../../api/prints";

export type TileTone = "error" | "info" | "success" | "warning" | "accent" | "neutral";
export type TileGlyph =
  "pdf" | "table" | "picture" | "code" | "text" | "document" | "design" | "mesh" | "sliced" | "archive" | "file";

/** How a file's tile looks, from what the server says it is and how it shows: a colour and a glyph, so a list reads at
 *  a glance. A file from an older backend, with neither, gets the plain one. */
export function tileLook(
  kind: ContentKind | undefined,
  view: FileView | null | undefined,
): { tone: TileTone; glyph: TileGlyph } {
  if (view === "pdf") return { tone: "error", glyph: "pdf" };
  if (view === "table") return { tone: "success", glyph: "table" };
  if (view === "image" || kind === "picture") return { tone: "info", glyph: "picture" };
  if (kind === "script") return { tone: "accent", glyph: "code" };
  if (view === "markdown" || view === "text") return { tone: "neutral", glyph: "text" };
  switch (kind) {
    case "document":
      return { tone: "info", glyph: "document" };
    case "cad":
    case "laser":
      return { tone: "accent", glyph: "design" };
    case "mesh":
    case "scene-part":
    case "cg-scene":
      return { tone: "accent", glyph: "mesh" };
    case "sliced":
      return { tone: "accent", glyph: "sliced" };
    case "archive":
      return { tone: "warning", glyph: "archive" };
    default:
      return { tone: "neutral", glyph: "file" };
  }
}
