// The typefaces a tool can letter a model with.
//
// Thingport carries them so a tool doesn't have to: a font parser's worth of outlines is far more than a tool's
// script budget, and a tool that fetched one from a type foundry at runtime would stop working offline, which the
// tools are meant not to do. They sit in `assets/toolFonts`, under the Open Font License, with the notices and the
// reason they are all static fonts in that folder's README; the list below is only the names and the grouping the
// pickers show.

import type { SdkFont, SdkFonts } from "./types";

/** A typeface on offer: `id` is the file's name without its extension. */
export type ToolFont = SdkFont;

/** In the order a picker should show them: the plain faces first, then the loud ones, then handwriting. */
export const TOOL_FONTS: readonly ToolFont[] = [
  { id: "pt-sans", name: "PT Sans", group: "Sans" },
  { id: "fira-sans", name: "Fira Sans", group: "Sans" },
  { id: "fjalla-one", name: "Fjalla One", group: "Condensed" },
  { id: "bebas-neue", name: "Bebas Neue", group: "Condensed" },
  { id: "staatliches", name: "Staatliches", group: "Condensed" },
  { id: "pt-serif", name: "PT Serif", group: "Serif" },
  { id: "arvo", name: "Arvo", group: "Serif" },
  { id: "abril-fatface", name: "Abril Fatface", group: "Serif" },
  { id: "alfa-slab-one", name: "Alfa Slab One", group: "Serif" },
  { id: "anton", name: "Anton", group: "Heavy" },
  { id: "archivo-black", name: "Archivo Black", group: "Heavy" },
  { id: "bowlby-one", name: "Bowlby One", group: "Heavy" },
  { id: "sigmar-one", name: "Sigmar One", group: "Heavy" },
  { id: "titan-one", name: "Titan One", group: "Rounded" },
  { id: "concert-one", name: "Concert One", group: "Rounded" },
  { id: "patua-one", name: "Patua One", group: "Display" },
  { id: "bungee", name: "Bungee", group: "Display" },
  { id: "righteous", name: "Righteous", group: "Display" },
  { id: "russo-one", name: "Russo One", group: "Display" },
  { id: "lobster", name: "Lobster", group: "Script" },
  { id: "pacifico", name: "Pacifico", group: "Script" },
];

/** What OpenSCAD draws a typeface Thingport doesn't carry in: the plainest, rather than whichever it finds first. */
export const FALLBACK_TOOL_FONT = TOOL_FONTS[0];

// Addresses only: the bundler emits each file as its own asset and nothing is fetched until a tool asks for one.
const files = import.meta.glob("../assets/toolFonts/*.ttf", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/**
 * Each font file's address, by its id.
 *
 * Exported so a test can check it against the list above: a glob that matches nothing is not an error anywhere
 * else, and the tools would only find out at the moment someone asks for a typeface.
 */
export const TOOL_FONT_URLS: ReadonlyMap<string, string> = new Map(
  Object.entries(files).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1, -".ttf".length), url]),
);

/** What a tool gets from `library("fonts")`. */
export type ToolFontLibrary = SdkFonts;

export function toolFontLibrary(opentype: () => Promise<unknown>): ToolFontLibrary {
  const downloads = new Map<string, Promise<ArrayBuffer>>();
  const parsed = new Map<string, Promise<unknown>>();

  const remember = <T>(cache: Map<string, Promise<T>>, id: string, make: () => Promise<T>) => {
    let held = cache.get(id);
    if (!held) {
      held = make();
      cache.set(id, held);
      // A font that failed to arrive is tried again next time rather than staying broken for the session.
      held.catch(() => cache.delete(id));
    }
    return held;
  };

  const address = (id: string) => {
    const url = TOOL_FONT_URLS.get(id);
    if (!url)
      throw new Error(`Thingport has no font called "${id}". It has: ${TOOL_FONTS.map((f) => f.id).join(", ")}`);
    return url;
  };

  const bytes = (id: string) =>
    remember(downloads, id, async () => {
      const response = await fetch(address(id));
      if (!response.ok) throw new Error(`The ${id} font didn't load (${response.status}).`);
      return response.arrayBuffer();
    });

  return {
    list: TOOL_FONTS,
    bytes,
    load: (id: string) =>
      remember(parsed, id, async () => {
        const [library, data] = await Promise.all([opentype(), bytes(id)]);
        return (library as { parse: (buffer: ArrayBuffer) => unknown }).parse(data);
      }),
  };
}
