// A site Download adapted works on: how a model's 3MFs are listed and downloaded there with the user's own sign-in,
// where its own buttons are and how its theme shows. What its 3MFs can be is its manifest's `adapted3mfs`
// (formats.ts). MakerWorld's and Printables' are in their providers/<id>/adaptSite.ts, listed in sites.ts.

import type { ProviderId } from "../../providers/index.generated";
import type { AdaptTarget } from "../../shared/adaptTargets";
import type { AdaptOffer } from "../../shared/messages";

/** One of a model's 3MFs, by the site's own id for it; `size` in bytes. */
export type AdaptFile = { id: string; name: string; size: number | null };

export type AdaptSite = {
  /** Its provider: the button takes the site's look by it (styles/adapted.scss). */
  id: ProviderId;
  name: string;
  /** What its 3MFs are, as the explanation starts ("MakerWorld's files are Bambu Studio projects"). */
  filesAre: string;
  /** The page's model's 3MFs, in the site's order: MakerWorld's selected print profile, every 3MF Printables lists. */
  files(pageUrl: string): Promise<AdaptFile[]>;
  /** Downloads one of them as the site's own button would, saying how it's going through `progress`. */
  download(
    pageUrl: string,
    file: AdaptFile,
    progress: (text: string) => void,
  ): Promise<{ bytes: ArrayBuffer; filename: string }>;
  /** The site's main open or download button, or null while it isn't on the page. */
  anchor(): HTMLElement | null;
  /** Puts the button's host beside `anchor`. */
  place(host: HTMLElement, anchor: HTMLElement): void;
  /** Where the site lists each file with buttons of its own (Printables' Files tab): the button each of `files` shown
   *  now gets its own copy button under, which `placeInRow` puts there. */
  fileRows?(files: AdaptFile[]): { anchor: HTMLElement; file: AdaptFile }[];
  placeInRow?(host: HTMLElement, anchor: HTMLElement): void;
  /** Whether the site shows its dark theme, and what to watch for that changing. */
  dark(): boolean;
  themeWatch(): { target: Node; attributeFilter: string[] };
};

/** What a model page offers: its site, its 3MFs, the copies they get, and the settings' place for the button. */
export type PageAdapt = { site: AdaptSite; files: AdaptFile[]; targets: AdaptTarget[]; offer: AdaptOffer };

/** Puts `host` after `el`: beside it where their parent lays them out in a row, otherwise underneath at full width,
 *  saying whether a gap already spaces them (styles/adapted.scss). */
export function placeAfter(host: HTMLElement, el: HTMLElement): void {
  el.after(host);
  const parent = getComputedStyle(el.parentElement!);
  const inRow = /flex/.test(parent.display) && parent.flexDirection.startsWith("row");
  const gap = inRow ? parent.columnGap : parent.rowGap;
  host.toggleAttribute("data-below", !inRow);
  host.toggleAttribute("data-gapped", Boolean(gap) && gap !== "normal" && gap !== "0px");
}
