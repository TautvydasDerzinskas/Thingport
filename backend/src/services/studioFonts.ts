import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "opentype.js";
import { addFont, fontsIn, hasFont, type TextFont } from "../studio/text.generated";

// The fonts a design's text uses, read from the server's copies (scripts/sync-studio.mjs puts them in assets/) and
// parsed once: before a command with text is carried out, and in the worker before a design is made. Each thread has
// its own, as a parsed font can't be passed between them.

// From src/services or dist/services alike.
const FONT_DIR = path.resolve(__dirname, "../../assets/studio-fonts");

const loading = new Map<string, Promise<void>>();

function load(id: string): Promise<void> {
  let pending = loading.get(id);
  if (!pending) {
    pending = (async () => {
      const bytes = await fs.readFile(path.join(FONT_DIR, `${id}.ttf`));
      addFont(id, parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) as TextFont);
    })();
    pending.catch(() => loading.delete(id));
    loading.set(id, pending);
  }
  return pending;
}

/** Loads the fonts the text in `value` (a design, or a command's arguments) uses. */
export async function loadFontsFor(value: unknown): Promise<void> {
  await Promise.all(
    fontsIn(value)
      .filter((id) => !hasFont(id))
      .map(load),
  );
}
