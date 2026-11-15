// MakerWorld's puzzle box as the page shows it: Geetest's, whose class names are its own and stable, unlike the site's
// hashed ones.

import { sleep } from "../../content/runtime";

const BOX = ".geetest_box_wrap, .geetest_box";

/** The puzzle MakerWorld is showing, if it's showing one. Geetest hides a closed box rather than removing it. */
export function puzzleBox(): HTMLElement | null {
  for (const box of document.querySelectorAll<HTMLElement>(BOX)) {
    const rect = box.getBoundingClientRect();
    const style = getComputedStyle(box);
    if (rect.width && rect.height && style.visibility !== "hidden" && Number(style.opacity) > 0) return box;
  }
  return null;
}

/** True once the page shows its puzzle, false if it hasn't by `ms` or `stop` says to give up. */
export async function puzzleOpens(ms: number, stop: () => boolean = () => false): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end && !stop(); await sleep(200)) {
    if (puzzleBox()) return true;
  }
  return false;
}

/** Once the page shows no puzzle, solved or closed, or `ms` has passed. */
export async function puzzleGone(ms: number): Promise<void> {
  for (const end = Date.now() + ms; puzzleBox() && Date.now() < end;) await sleep(250);
}
