// "Download normalized" next to MakerWorld's own download/open button, for people whose slicer mis-reads
// Bambu Studio projects. Whether it is offered is the popup's "Normalize MakerWorld 3MFs" switch alone
// (content/index.ts): the slicer the instance has picked only words the explanation, since plenty of people slice
// with something other than the one Thingport knows about. The file is downloaded and converted in this tab; it
// never goes anywhere else.

import { createIcon } from "../../shared/icon";
import { NORMALIZE_3MF_SLICERS } from "../../shared/slicers";
import { api } from "../../content/runtime";
import css from "../../content/styles/normalized.scss?inline";
import { gettingFilePhrases, normalizingPhrases, rotatePhrases } from "../../content/panels/funStatus";
import { resolveMakerworldDownloadUrl } from "./downloadResolver";
import { DOWNLOAD_3MF, DOWNLOAD_OTHER, DOWNLOAD_STL, OPEN_IN_APP } from "./labels";
import { normalizeBambu3mf } from "./normalize";

// Converting holds the file, its unzipped model XML and the result in memory at once.
const MAX_BYTES = 50 * 1024 * 1024;
const MB = 1024 * 1024;
const HOST_ID = "thingport-grab-normalized";
const LABEL = "Download normalized";
const DONE_RESET_MS = 3000;
const ERROR_SHOW_MS = 10000;

// Material Design "Lightbulb" (Apache 2.0), the web app's icon for the same option.
const BULB_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7"/></svg>';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

function bulbIcon(): Element {
  return document.importNode(new DOMParser().parseFromString(BULB_SVG, "image/svg+xml").documentElement, true);
}

let host: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let themeObserver: MutationObserver | null = null;
let bubbleTimer: ReturnType<typeof setTimeout> | undefined;

function explanation(slicerLabel: string | null): string {
  const slicers = slicerLabel ? `${slicerLabel} often opens` : "PrusaSlicer, Cura and other slicers often open";
  return (
    `MakerWorld files are Bambu Studio projects, which ${slicers} without their colors or print ` +
    "settings. This downloads a converted copy that keeps painted colors, filament colors, plates and the " +
    "designer's settings (walls, layer height, infill, supports). Heads up: multi-part objects may be merged into " +
    "one, per-object overrides and layer color changes are dropped, and you pick your own printer profile. " +
    "Converted in your browser by Thingport Grab."
  );
}

function tooBig(bytes: number): Error {
  return new Error(
    `This file is ${Math.round(bytes / MB)} MB, too big to normalize in the browser (the limit is ${MAX_BYTES / MB} MB). ` +
      "Use MakerWorld's regular Download instead.",
  );
}

async function readBody(
  res: Response,
  declared: number | null,
  onProgress: (text: string) => void,
): Promise<ArrayBuffer> {
  const reader = res.body?.getReader();
  if (!reader) return res.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      void reader.cancel();
      throw tooBig(declared ?? received);
    }
    chunks.push(value);
    const got = (received / MB).toFixed(1);
    onProgress(declared ? `Downloading ${got} of ${(declared / MB).toFixed(1)} MB…` : `Downloading ${got} MB…`);
  }
  return new Blob(chunks as BlobPart[]).arrayBuffer();
}

/** From Content-Disposition, else the URL's last path segment. */
function sourceFilename(res: Response, url: string): string {
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const encoded = disposition.match(/filename\*\s*=\s*[^']*'[^']*'([^;]+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1];
  let name = "";
  try {
    name = decodeURIComponent(encoded ?? plain ?? new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    name = plain ?? "";
  }
  return name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "model.3mf";
}

function normalizedFilename(source: string): string {
  return `${source.replace(/\.3mf$/i, "")}-normalized.3mf`;
}

function saveFile(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "model/3mf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function downloadNormalized(pageUrl: string, onProgress: (text: string) => void): Promise<void> {
  let stopRotation = rotatePhrases(gettingFilePhrases, onProgress);
  // The normalizer reads the 3MF project, never the raw-files zip.
  const resolved = await resolveMakerworldDownloadUrl(pageUrl, { profileOnly: true }).finally(stopRotation);
  if (!resolved) {
    throw new Error(
      "Couldn't get this model's file from MakerWorld. Make sure you're signed in to MakerWorld, then try again.",
    );
  }
  const res = await fetch(resolved.downloadUrl);
  if (!res.ok) throw new Error(`MakerWorld's file server refused the download (${res.status}). Try again in a moment.`);
  const declared = Number(res.headers.get("Content-Length")) || null;
  if (declared && declared > MAX_BYTES) {
    void res.body?.cancel();
    throw tooBig(declared);
  }
  const input = await readBody(res, declared, onProgress);
  stopRotation = rotatePhrases(normalizingPhrases, onProgress);
  let output: Uint8Array;
  try {
    output = await normalizeBambu3mf(input).finally(stopRotation);
  } catch (err) {
    throw new Error("Couldn't normalize this file: it doesn't look like a 3MF project MakerWorld's Download gives.", {
      cause: err,
    });
  }
  saveFile(output, normalizedFilename(sourceFilename(res, resolved.downloadUrl)));
}

function buildHost(pageUrl: string, slicerLabel: string | null): HTMLElement {
  const el = document.createElement("span");
  el.id = HOST_ID;
  const root = el.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  const button = element("button", "tg-nd");
  button.type = "button";
  button.setAttribute("aria-describedby", "tg-nd-info");
  const logo = element("span", "tg-nd__logo");
  logo.append(createIcon());
  const label = element("span", "tg-nd__label");
  label.textContent = LABEL;
  const icon = element("span", "tg-nd__info");
  icon.append(bulbIcon());
  button.append(logo, label, icon);
  const bubble = element("div", "tg-nd-bubble");
  bubble.id = "tg-nd-info";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  root.append(style, button, bubble);

  const showBubble = (text: string, error = false) => {
    clearTimeout(bubbleTimer);
    bubble.textContent = text;
    bubble.classList.toggle("tg-nd-bubble--error", error);
    bubble.hidden = false;
    // Fixed, so an ancestor's overflow can't clip it.
    const rect = button.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - bubble.offsetWidth - 8);
    bubble.style.left = `${left}px`;
    // Above when there's no room below, e.g. in MakerWorld's bottom-stuck action bar.
    const below = rect.bottom + 8 + bubble.offsetHeight <= window.innerHeight;
    bubble.style.top = `${below ? rect.bottom + 8 : Math.max(8, rect.top - 8 - bubble.offsetHeight)}px`;
    if (error) bubbleTimer = setTimeout(hideBubble, ERROR_SHOW_MS);
  };
  const hideBubble = () => {
    clearTimeout(bubbleTimer);
    bubble.hidden = true;
  };
  const showInfo = () => {
    if (bubble.hidden) showBubble(explanation(slicerLabel));
  };
  icon.addEventListener("mouseenter", showInfo);
  icon.addEventListener("mouseleave", () => !bubble.classList.contains("tg-nd-bubble--error") && hideBubble());
  button.addEventListener("focus", () => button.matches(":focus-visible") && showInfo());
  button.addEventListener("blur", () => !bubble.classList.contains("tg-nd-bubble--error") && hideBubble());

  button.addEventListener("click", async () => {
    hideBubble();
    button.disabled = true;
    icon.replaceChildren(element("span", "tg-nd__spinner"));
    try {
      await downloadNormalized(pageUrl, (text) => (label.textContent = text));
      label.textContent = "Downloaded";
      await new Promise((resolve) => setTimeout(resolve, DONE_RESET_MS));
    } catch (err) {
      showBubble(err instanceof Error ? err.message : String(err), true);
    } finally {
      button.disabled = false;
      icon.replaceChildren(bulbIcon());
      label.textContent = LABEL;
    }
  });
  return el;
}

// MakerWorld's main action, matched by label (class names are build hashes): usually the "Open in
// Bambu Studio" split button, whose menu holds "Download 3MF" and "Download STL/CAD Files". The
// English patterns also catch app names the translated sets don't list.
const ACTION_LABELS: ((text: string) => boolean)[] = [
  (text) => OPEN_IN_APP.has(text) || /^open in .+/i.test(text),
  (text) => DOWNLOAD_3MF.has(text) || DOWNLOAD_STL.has(text) || DOWNLOAD_OTHER.has(text) || /^download\b/i.test(text),
];
const MAX_LABEL_LENGTH = 40;

function findActionLabel(): HTMLElement | null {
  const candidates = [...document.querySelectorAll<HTMLElement>("button, a, span, div")].filter((el) => {
    if (el.childElementCount > 2 || el.offsetParent === null) return false;
    const text = (el.textContent || "").trim();
    return text.length <= MAX_LABEL_LENGTH && ACTION_LABELS.some((matches) => matches(text));
  });
  // Innermost, so wrappers repeating the same text don't win.
  const leaves = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));
  for (const matches of ACTION_LABELS) {
    const match = leaves.find((el) => matches((el.textContent || "").trim()));
    if (match) return match;
  }
  return null;
}

/** The clickable element around the label, then the outermost wrapper that's still just the
 *  control (e.g. both halves of the split button). */
function controlBox(label: HTMLElement): HTMLElement {
  let box = label.closest<HTMLElement>("button, a, [role=button]") ?? label;
  // The cursor is inherited, so the control is the outermost element that still has it.
  while (
    box.parentElement &&
    box.parentElement !== document.body &&
    getComputedStyle(box.parentElement).cursor === "pointer"
  )
    box = box.parentElement;
  const { width, height } = box.getBoundingClientRect();
  for (let parent = box.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    const rect = parent.getBoundingClientRect();
    // Grows only by the split button's arrow, never by a whole extra row.
    if (Math.abs(rect.height - height) > 1 || rect.width > width * 1.5) break;
    box = parent;
  }
  return box;
}

let anchor: HTMLElement | null = null;

/** Keeps the button next to MakerWorld's, which can render late or be re-rendered away. */
function place(): void {
  if (!host) return;
  if (host.isConnected && anchor?.isConnected && anchor.offsetParent !== null && host.previousElementSibling === anchor)
    return;
  const label = findActionLabel();
  if (!label) {
    host.remove();
    anchor = null;
    return;
  }
  anchor = controlBox(label);
  anchor.after(host);
  // Beside it in a row, otherwise underneath at full width; a gap already spaces it.
  const parent = getComputedStyle(anchor.parentElement!);
  const inRow = /flex/.test(parent.display) && parent.flexDirection.startsWith("row");
  const gap = inRow ? parent.columnGap : parent.rowGap;
  host.toggleAttribute("data-below", !inRow);
  host.toggleAttribute("data-gapped", Boolean(gap) && gap !== "normal" && gap !== "0px");
}

function mount(pageUrl: string, slicerLabel: string | null): void {
  unmountNormalizedDownload();
  host = buildHost(pageUrl, slicerLabel);
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      place();
    });
  };
  observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  // MakerWorld sets its theme as a class on <html>, which the shadow root's CSS can't see.
  const syncTheme = () => host?.toggleAttribute("data-dark", document.documentElement.classList.contains("dark"));
  themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  syncTheme();
  place();
}

export function unmountNormalizedDownload(): void {
  observer?.disconnect();
  observer = null;
  themeObserver?.disconnect();
  themeObserver = null;
  host?.remove();
  host = null;
  anchor = null;
  clearTimeout(bubbleTimer);
}

/** Offered wherever the popup's switch is on. The instance's slicer, where it can be asked for and is one Thingport
 *  knows mis-reads these files, only names it in the explanation. */
export async function offerNormalizedDownload(
  pageUrl: string,
  configured: boolean,
  isStale: () => boolean,
): Promise<void> {
  const slicer = configured
    ? await api<{ slicer: string | null }>("GET", "/settings/slicer")
        .then((res) => res.slicer)
        .catch(() => null)
    : null;
  if (!isStale()) mount(pageUrl, slicer ? (NORMALIZE_3MF_SLICERS[slicer] ?? null) : null);
}
