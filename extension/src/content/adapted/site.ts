// A site Download adapted works on: how a model's 3MFs are listed and downloaded there with the user's own sign-in,
// where its own buttons are and how its theme shows. What its 3MFs can be is its manifest's `adapted3mfs`
// (formats.ts), or the site's own typical files. Each is in its provider's providers/<id>/adaptSite.ts, listed in
// sites.ts.

import type { ThreeMfFormat } from "../../adapter/index.generated";
import type { ProviderId } from "../../providers/index.generated";
import type { AdaptTarget } from "../../shared/adaptTargets";
import type { AdaptOffer } from "../../shared/messages";

/** One of a model's 3MFs, by the site's own id for it: its file name, `title` where the site shows it by another (a
 *  print profile's name), and `size` in bytes. */
export type AdaptFile = { id: string; name: string; title?: string; size: number | null };

export type AdaptSite = {
  /** Its provider: the button takes the site's look by it (styles/adapted.scss). */
  id: ProviderId;
  name: string;
  /** What its 3MFs are, as the explanation starts ("MakerWorld's files are Bambu Studio projects"). */
  filesAre: string;
  /** Typical files of the site, where the kinds its manifest lists aren't close enough to say which slicers get a
   *  copy: one written by the app most of its files come from. */
  formats?: ThreeMfFormat[];
  /** The page's model's 3MFs, in the site's order: MakerWorld's selected print profile, every 3MF Printables lists. */
  files(pageUrl: string): Promise<AdaptFile[]>;
  /** Where the page picks one of them itself (a print profile chosen on it): which one now, null where it hasn't
   *  picked one (the first, then), or "other" where it picked a file that isn't one of them, an STL say, which has no
   *  copy. The button beside the site's own makes its copy of that one, asked again each time, rather than offering
   *  the files to pick from. */
  selected?(files: AdaptFile[]): AdaptFile | null | "other";
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
  /** Whether the page says the model can't be downloaded here yet (paid, or for members): then, with the site's own
   *  button gone, the copies aren't offered elsewhere either. */
  unavailable?(): boolean;
  /** Where the site lists each file with buttons of its own (Printables' Files tab): the button each of `files` shown
   *  now gets its own copy button under, which `placeInRow` puts there. A row's button is one of a stack of the
   *  site's, as Printables' are, unless `placeInRow` marks it `data-row="pill"`: a small one beside the site's. */
  fileRows?(files: AdaptFile[]): { anchor: HTMLElement; file: AdaptFile }[];
  placeInRow?(host: HTMLElement, anchor: HTMLElement): void;
  /** Whether the site shows its dark theme, and what to watch for that changing. */
  dark(): boolean;
  themeWatch(): { target: Node; attributeFilter: string[] };
};

/** What a model page offers: its site, its 3MFs, the copies they get, and the settings' place for the button. */
export type PageAdapt = { site: AdaptSite; files: AdaptFile[]; targets: AdaptTarget[]; offer: AdaptOffer };

/** Puts `host` after `el`: beside it where their parent lays them out in a row, otherwise underneath at full width
 *  (styles/adapted.scss), spaced from it unless a gap of the parent's, or `spaced` (a parent that spaces its children
 *  some other way), already does. The spacing is the host's own style: a page's reset of every element's margin would
 *  win over its shadow root's. */
export function placeAfter(host: HTMLElement, el: HTMLElement, { spaced = false } = {}): void {
  el.after(host);
  const parent = getComputedStyle(el.parentElement!);
  const inRow = /flex/.test(parent.display) && parent.flexDirection.startsWith("row");
  const gap = inRow ? parent.columnGap : parent.rowGap;
  const gapped = spaced || (Boolean(gap) && gap !== "normal" && gap !== "0px");
  host.toggleAttribute("data-below", !inRow);
  host.style.margin = gapped ? "0" : inRow ? "0 0 0 8px" : "12px 0 0";
}

/** `el` where it's on the page and shown, else null. */
export const visible = (el: HTMLElement | null) => (el && el.offsetParent !== null ? el : null);

/** A cookie of the page's, as its own scripts read it: null when it isn't set (signed out, on sites that keep the
 *  sign-in in one). */
export function pageCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) {
      const value = part.slice(at + 1).trim();
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return value || null;
      }
    }
  }
  return null;
}

/** Downloading needs the user signed in to the site, as its own Download does. */
export const signInFirst = (site: string) =>
  new Error(`Sign in to ${site} to download its files, then try again. Its own Download needs that too.`);
