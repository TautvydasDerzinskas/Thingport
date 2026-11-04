import { TOOL_FONT_URLS } from "../../sdk/fonts";
import { addFont, fontsIn, hasFont, type TextFont } from "../../studio/text";

// The fonts a design's text uses, fetched and parsed the first time they're needed, on the page and in the geometry
// worker alike: each has its own copy, as nothing parsed can be sent between them.

const loading = new Map<string, Promise<void>>();

function load(id: string): Promise<void> {
  let pending = loading.get(id);
  if (!pending) {
    pending = (async () => {
      const url = TOOL_FONT_URLS.get(id);
      if (!url) throw new Error(`Thingport has no font called "${id}"`);
      const [module, response] = await Promise.all([import("opentype.js"), fetch(url)]);
      if (!response.ok) throw new Error(`The ${id} font didn't load (${response.status})`);
      // Its ES build exports parse by name, with no default.
      const { parse } = (module as { default?: { parse: (data: ArrayBuffer) => unknown } }).default ?? module;
      addFont(id, parse(await response.arrayBuffer()) as TextFont);
    })();
    // One that failed to arrive is tried again next time.
    pending.catch(() => loading.delete(id));
    loading.set(id, pending);
  }
  return pending;
}

/** Loads the fonts the text in `value` (a design, or a command's arguments) uses; done at once when they're in. */
export async function loadFontsFor(value: unknown): Promise<void> {
  const wanted = fontsIn(value).filter((id) => !hasFont(id));
  await Promise.all(wanted.map(load));
}

/** Whether every font the text in `value` uses is in, so it can be drawn now. */
export function fontsLoadedFor(value: unknown): boolean {
  return fontsIn(value).every(hasFont);
}

/** Loads one font, for a picker to show it in its own face before anything uses it. */
export function loadFont(id: string): Promise<void> {
  return hasFont(id) ? Promise.resolve() : load(id);
}
