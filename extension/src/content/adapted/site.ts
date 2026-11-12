// A site Download adapted works on: what its 3MFs are, how its own button is found and its theme told, and how a
// model's 3MF is downloaded there with the user's own sign-in. MakerWorld's is providers/makerworld/adaptSite.ts.

import type { ThreeMfFormat } from "../../adapter/index.generated";

export type AdaptSite = {
  /** The provider's id: the button takes the site's look by it (styles/adapted.scss). */
  id: string;
  name: string;
  /** What its 3MFs are, before one is downloaded: whether a slicer gets a copy of them at all. */
  format: ThreeMfFormat;
  /** What its files are, as the button's explanation starts ("MakerWorld's files are Bambu Studio projects"). */
  filesAre: string;
  /** Downloads the page's model's 3MF as the site's own button would, saying how it's going through `progress`. */
  download(pageUrl: string, progress: (text: string) => void): Promise<{ bytes: ArrayBuffer; filename: string }>;
  /** The site's own open or download button, or null while it isn't on the page. */
  anchor(): HTMLElement | null;
  /** Puts the button's host beside `anchor`. */
  place(host: HTMLElement, anchor: HTMLElement): void;
  /** Whether the site shows its dark theme, and what to watch for that changing. */
  dark(): boolean;
  themeWatch(): { target: Node; attributeFilter: string[] };
};
