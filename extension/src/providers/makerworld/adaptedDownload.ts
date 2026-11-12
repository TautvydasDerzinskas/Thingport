// "Download adapted" next to MakerWorld's own download/open button: the model's 3MF as a copy made for the slicer
// the instance has picked (the one the web app's "Open adapted" opens), or, with no instance, for PrusaSlicer and
// the other slicers that mis-read Bambu Studio projects. Offered where the popup's "Adapt MakerWorld 3MFs" switch is on
// and that slicer doesn't open MakerWorld's files as they are. The file is downloaded and converted in this tab; it
// never goes anywhere else.

import { FORMAT_VERSION, type AdaptPlan, type ThreeMfFormat } from "../../adapter/index.generated";
import { planFor } from "../../adapting/run";
import { createIcon } from "../../shared/icon";
import { t } from "../../shared/i18n";
import { SLICER_LABELS } from "../../shared/slicers";
import { api } from "../../content/runtime";
import css from "../../content/styles/adapted.scss?inline";
import { adaptingPhrases, gettingFilePhrases, rotatePhrases } from "../../content/panels/funStatus";
import { resolveMakerworldDownloadUrl } from "./downloadResolver";
import { DOWNLOAD_3MF, DOWNLOAD_OTHER, DOWNLOAD_STL, OPEN_IN_APP } from "./labels";
import { adaptMakerworld3mf } from "./adapt";

// Converting holds the file, its unzipped model XML and the result in memory at once.
const MAX_BYTES = 50 * 1024 * 1024;
const MB = 1024 * 1024;
const HOST_ID = "thingport-grab-adapted";
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

// What MakerWorld's files are, for deciding before one is downloaded: Bambu Studio projects from a recent version,
// with its names for settings. The downloaded file itself decides what its copy is.
const MAKERWORLD_FORMAT: ThreeMfFormat = {
  v: FORMAT_VERSION,
  kind: "bambu",
  app: "BambuStudio",
  appVersion: "02.08.00.00",
  orcaTag: null,
  printer: null,
  nozzle: null,
  filaments: null,
  plates: null,
  dialect: "bambu",
};

/** Which slicer the copy is for: the instance's (null when it has none picked), or not known yet. */
export type Target = { known: true; slicer: string | null } | { known: false };

function explanation(target: Target, output: AdaptPlan["output"]): string {
  const slicer = target.known ? target.slicer : null;
  const name = slicer ? (SLICER_LABELS[slicer] ?? null) : null;
  if (!target.known) {
    return t("adaptedDownloadExplanationUnknown");
  }
  if (output === "bambu" && slicer === "crealityprintlink") {
    return t("adaptedDownloadExplanationCreality");
  }
  if (output === "bambu") {
    return t("adaptedDownloadExplanationBambu", { slicer: name ?? t("yourSlicer") });
  }
  if (output === "cura") {
    return t("adaptedDownloadExplanationCura");
  }
  return t("adaptedDownloadExplanationOther", {
    slicers: name ? t("adaptedDownloadKnownSlicer", { slicer: name }) : t("adaptedDownloadOtherSlicers"),
  });
}

function tooBig(bytes: number): Error {
  return new Error(
    t("adaptedDownloadTooBig", { size: Math.round(bytes / MB), limit: MAX_BYTES / MB }),
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
    onProgress(
      declared
        ? t("adaptedDownloadProgress", { received: got, total: (declared / MB).toFixed(1) })
        : t("adaptedDownloadProgressUnknown", { received: got }),
    );
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

function adaptedFilename(source: string): string {
  return `${source.replace(/\.3mf$/i, "")}-adapted.3mf`;
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

/** Saves the copy made for `slicer`, or the file itself when it needs none; which of them it saved. */
async function downloadAdapted(
  pageUrl: string,
  slicer: string | null,
  onProgress: (text: string) => void,
): Promise<AdaptPlan["output"] | null> {
  let stopRotation = rotatePhrases(gettingFilePhrases, onProgress);
  // The adapter reads the 3MF project, never the raw-files zip.
  const resolved = await resolveMakerworldDownloadUrl(pageUrl, { profileOnly: true }).finally(stopRotation);
  if (!resolved) {
    throw new Error(
      t("couldNotGetMakerworldFile"),
    );
  }
  const res = await fetch(resolved.downloadUrl);
  if (!res.ok) throw new Error(t("makerworldFileServerRefused", { status: res.status }));
  const declared = Number(res.headers.get("Content-Length")) || null;
  if (declared && declared > MAX_BYTES) {
    void res.body?.cancel();
    throw tooBig(declared);
  }
  const input = await readBody(res, declared, onProgress);
  stopRotation = rotatePhrases(adaptingPhrases, onProgress);
  let adapted: Awaited<ReturnType<typeof adaptMakerworld3mf>>;
  try {
    adapted = await adaptMakerworld3mf(input, slicer).finally(stopRotation);
  } catch (err) {
    throw new Error(t("couldNotAdaptMakerworldFile"), {
      cause: err,
    });
  }
  const source = sourceFilename(res, resolved.downloadUrl);
  saveFile(adapted.bytes, adapted.output ? adaptedFilename(source) : source);
  return adapted.output;
}

function buildHost(pageUrl: string, firstTarget: Target, firstOutput: AdaptPlan["output"]): HTMLElement {
  // Settled on the first click when the instance didn't answer before.
  let target = firstTarget;
  let output = firstOutput;
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
  label.textContent = t("downloadAdapted");
  const icon = element("span", "tg-nd__info");
  icon.append(bulbIcon());
  button.append(logo, label, icon);
  const bubble = element("div", "tg-nd-bubble");
  bubble.id = "tg-nd-info";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  root.append(style, button, bubble);

  // An error, or a note on what was saved: shown for a while, not only while hovered.
  let held = false;
  const showBubble = (text: string, error = false, note = false) => {
    clearTimeout(bubbleTimer);
    held = error || note;
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
    if (held) bubbleTimer = setTimeout(hideBubble, ERROR_SHOW_MS);
  };
  const hideBubble = () => {
    clearTimeout(bubbleTimer);
    held = false;
    bubble.hidden = true;
  };
  const showInfo = () => {
    if (bubble.hidden) showBubble(explanation(target, output));
  };
  icon.addEventListener("mouseenter", showInfo);
  // An error or a note stays its while: moving away hides only the explanation.
  icon.addEventListener("mouseleave", () => !held && hideBubble());
  button.addEventListener("focus", () => button.matches(":focus-visible") && showInfo());
  button.addEventListener("blur", () => !held && hideBubble());

  // Once the instance says its user wants that slicer's files as they are, the button stays off until it goes.
  let switchedOff = false;

  button.addEventListener("click", async () => {
    hideBubble();
    button.disabled = true;
    icon.replaceChildren(element("span", "tg-nd__spinner"));
    try {
      let note: string | null = null;
      if (!target.known) {
        label.textContent = t("askingInstance");
        const answer = await instanceSlicer(SLICER_RETRY_MS);
        if (answer?.adapted === false) {
          // Its user wants that slicer's files as they are: no copy, and no button once they've read why.
          switchedOff = true;
          showBubble(t("adaptedDownloadOff"), false, true);
          setTimeout(() => host === el && unmountAdaptedDownload(), ERROR_SHOW_MS);
          return;
        }
        if (answer) {
          target = { known: true, slicer: answer.slicer };
          output = planFor(MAKERWORLD_FORMAT, answer.slicer)?.output ?? output;
        } else {
          note = t("adaptedDownloadNoAnswer");
        }
      }
      const slicer = target.known ? target.slicer : null;
      const saved = await downloadAdapted(pageUrl, slicer, (text) => (label.textContent = text));
      if (!saved) note = t("adaptedDownloadOriginal");
      label.textContent = t("downloaded");
      if (note) showBubble(note, false, true);
      await new Promise((resolve) => setTimeout(resolve, DONE_RESET_MS));
      // Not offered to a slicer that needs no copy, now that it's known; only this button, if the page moved on.
      if (host === el && target.known && !planFor(MAKERWORLD_FORMAT, slicer)) unmountAdaptedDownload();
    } catch (err) {
      showBubble(err instanceof Error ? err.message : String(err), true);
    } finally {
      button.disabled = switchedOff;
      icon.replaceChildren(bulbIcon());
      label.textContent = t("downloadAdapted");
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

function mount(pageUrl: string, target: Target, output: AdaptPlan["output"]): void {
  unmountAdaptedDownload();
  host = buildHost(pageUrl, target, output);
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

export function unmountAdaptedDownload(): void {
  observer?.disconnect();
  observer = null;
  themeObserver?.disconnect();
  themeObserver = null;
  host?.remove();
  host = null;
  anchor = null;
  clearTimeout(bubbleTimer);
}

// Long enough for an instance that's up, short enough that the button doesn't seem missing; a click waits longer.
const SLICER_LOOKUP_MS = 5000;
const SLICER_RETRY_MS = 15000;

/** The instance's answer (its slicer, null for none picked), or null when it can't say in time. `adapted` is false
 *  when its user switched "Open adapted" off for that slicer; an instance from before the switch doesn't say. */
export async function instanceSlicer(
  waitMs = SLICER_LOOKUP_MS,
): Promise<{ slicer: string | null; adapted?: false } | null> {
  const lookup = api<{ slicer: string | null; unadapted?: string[] }>("GET", "/settings/slicer")
    .then((res) => ({
      slicer: res.slicer,
      ...(res.slicer && res.unadapted?.includes(res.slicer) ? { adapted: false as const } : {}),
    }))
    .catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs));
  return Promise.race([lookup, timeout]);
}

/** What the button offers for the instance's answer: nothing when its slicer opens MakerWorld's files as they are or
 *  its user wants them as they are, and a button that asks again when it didn't answer, rather than taking that as no
 *  slicer. */
export function offerFor(
  answer: { slicer: string | null; adapted?: false } | null,
): { target: Target; output: AdaptPlan["output"] } | null {
  if (!answer) return { target: { known: false }, output: "prusa" };
  if (answer.adapted === false) return null;
  const plan = planFor(MAKERWORLD_FORMAT, answer.slicer);
  return plan ? { target: { known: true, slicer: answer.slicer }, output: plan.output } : null;
}

/** Offered where the popup's switch is on, unless the instance's slicer opens MakerWorld's files as they are. */
export async function offerAdaptedDownload(
  pageUrl: string,
  configured: boolean,
  isStale: () => boolean,
): Promise<void> {
  if (isStale()) return;
  const offer = offerFor(configured ? await instanceSlicer() : { slicer: null });
  if (isStale() || !offer) return;
  mount(pageUrl, offer.target, offer.output);
}
