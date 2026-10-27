// The heavy libraries a widget or a tool can ask for, loaded the first time one does and shared from then on.
//
// A widget or a tool is a single script with a size limit, and the review reads it before it is merged, so it
// can't carry something like a font parser or a solid modelling kernel of its own — one is most of the budget,
// the other is a binary a reviewer could never read. These are Thingport's own copies instead: fetched only when
// something asks, and handed to everything after that from the same promise, so two tools in two windows and a
// panel on the dashboard share one instance and one download.

import { toolFontLibrary } from "./fonts";

/** The promise for each library, kept for the life of the page: asking twice never loads twice. */
const loading = new Map<string, Promise<unknown>>();

const loaders: Record<string, () => Promise<unknown>> = {
  /** Three.js, which Thingport draws models with. */
  three: async () => {
    const [core, utils] = await Promise.all([
      import("three"),
      import("three/examples/jsm/utils/BufferGeometryUtils.js"),
    ]);
    return { ...core, mergeGeometries: utils.mergeGeometries, mergeVertices: utils.mergeVertices };
  },
  /**
   * opentype.js: reads a TTF or OTF and gives a glyph's real outline, counters and all. Its ES build exports
   * `parse` and the rest by name with no default, so the namespace itself is what a tool wants.
   */
  opentype: async () => {
    const module = await import("opentype.js");
    return module.default ?? module;
  },
  /**
   * Manifold: solid modelling that keeps its results watertight, and the 2D cross-sections and offsetting that go
   * with it. It is WebAssembly, so it has to be started before use; that happens here, once.
   */
  manifold: async () => {
    const [{ default: Module }, { default: wasm }] = await Promise.all([
      import("manifold-3d"),
      import("manifold-3d/manifold.wasm?url"),
    ]);
    const manifold = await Module({ locateFile: () => wasm });
    manifold.setup();
    return manifold;
  },
  /**
   * The typefaces in `assets/toolFonts`, as a list to show and a loader per font. Each font is fetched the first
   * time any tool asks for it, and parsed by the opentype above, so the same `Font` is handed out after that.
   */
  fonts: async () => toolFontLibrary(() => library("opentype")),
};

export const LIBRARIES = Object.keys(loaders);

/**
 * One of the libraries above, by name. The same promise comes back every time, so the download and the start-up
 * happen once however many tools ask.
 */
export function library(name: string): Promise<unknown> {
  const loader = loaders[name];
  if (!loader) throw new Error(`Thingport has no library called "${name}". It has: ${LIBRARIES.join(", ")}`);
  let loaded = loading.get(name);
  if (!loaded) {
    loaded = loader();
    loading.set(name, loaded);
    // A library that fails to load is tried afresh next time rather than failing for the rest of the session.
    loaded.catch(() => loading.delete(name));
  }
  return loaded;
}
