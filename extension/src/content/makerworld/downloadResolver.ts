// Resolves the MakerWorld file URL in the page instead of the backend, whose resolution calls are
// what trip MakerWorld's account-wide CAPTCHA. Same-origin fetches carry the real session and look
// like the page's own traffic. Returns null on any failure so the backend can resolve it instead,
// except a CAPTCHA or the daily download limit, which are thrown: the backend would only hit the
// same wall.

import type { ResolvedDownload } from "../../shared/messages";
import { providerCredentialRequest } from "../../shared/providerCredentialRequest";
import { send } from "../../shared/messages";
import { parseMakerworldModelUrl } from "../../shared/urls";
import { sleep } from "../runtime";
import { DOWNLOAD_3MF, DOWNLOAD_ALL, DOWNLOAD_OTHER, DOWNLOAD_STL, OPEN_IN_APP } from "./labels";
import {
  loadMakerworldDesignForPage,
  makerworldDesignForImport,
  pickMakerworldInstanceId,
  readMakerworldDesignForPage,
  type MakerworldDesign,
} from "./pageData";

// fetch() has no timeout, and some endpoints hold an interactive challenge open indefinitely.
const MAKERWORLD_API_FETCH_TIMEOUT_MS = 8000;

// What MakerWorld's own web client sends with its API calls; it answers 403 without them.
const MAKERWORLD_CLIENT_HEADERS = {
  "X-BBL-Client-Name": "MakerWorld",
  "X-BBL-Client-Type": "web",
  "X-BBL-Client-Version": "00.00.00.01",
  "X-BBL-App-Source": "makerworld",
};

/** {url|downloadUrl|download_url}, optionally nested under `data`. */
function extractDownloadUrl(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const candidates = [data as Record<string, unknown>];
  const inner = (data as Record<string, unknown>).data;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) candidates.push(inner as Record<string, unknown>);
  for (const obj of candidates) {
    for (const key of ["url", "downloadUrl", "download_url"]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

export const MAKERWORLD_CAPTCHA_MESSAGE =
  'MakerWorld is asking for a CAPTCHA ("confirm you are not a robot"). Open any model on MakerWorld, ' +
  'click the arrow next to "Open in Bambu Studio", choose "Download 3MF" and solve the puzzle, then ' +
  "retry the import.";

/** MakerWorld's anti-bot layer answers with HTTP 418 (sometimes 200) and a body naming a captcha.
 *  Thrown rather than returned as null so it isn't reported as "no file found". */
export class MakerworldCaptchaError extends Error {
  constructor() {
    super(MAKERWORLD_CAPTCHA_MESSAGE);
    this.name = "MakerworldCaptchaError";
  }
}

export const MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE =
  "MakerWorld daily download limit reached for this account. Try again tomorrow.";

/** The per-account daily cap: HTTP 400 with {"code":-1,"error":"You've reached your daily download
 *  limit."}. Every later download fails the same way until it resets. */
export class MakerworldDownloadLimitError extends Error {
  constructor() {
    super(MAKERWORLD_DOWNLOAD_LIMIT_MESSAGE);
    this.name = "MakerworldDownloadLimitError";
  }
}

/** Errors that end an import outright: retrying or falling back to the backend can't get past them. */
export function isMakerworldBlockingError(err: unknown): boolean {
  return err instanceof MakerworldCaptchaError || err instanceof MakerworldDownloadLimitError;
}

function looksLikeDownloadLimit(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const { error, message, msg } = data as Record<string, unknown>;
  return [error, message, msg].some((value) => typeof value === "string" && /download limit/i.test(value));
}

/** Only asked of a body without a download URL, whose filename could otherwise say "robot". */
function looksLikeCaptcha(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const text = JSON.stringify(data).toLowerCase();
  return text.includes("captcha") || text.includes("robot");
}

async function fetchMakerworldApiJson(url: string, nonce: string | null): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAKERWORLD_API_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: "application/json", ...MAKERWORLD_CLIENT_HEADERS };
    if (nonce) headers["X-Nonce"] = nonce;
    const res = await providerCredentialRequest("makerworld-extension", url, { headers, signal: controller.signal });
    if (res.status === 418) throw new MakerworldCaptchaError();
    const data: unknown = await res.json();
    if (extractDownloadUrl(data)) return data;
    if (looksLikeCaptcha(data)) throw new MakerworldCaptchaError();
    if (looksLikeDownloadLimit(data)) throw new MakerworldDownloadLimitError();
    return res.ok ? data : null;
  } catch (err) {
    if (isMakerworldBlockingError(err)) throw err;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const MENU_WAIT_MS = 2000;
// Matches background/downloadCapture.ts: MakerWorld fetches the file URL before it clicks.
const CAPTURE_TIMEOUT_MS = 8000;
// The raw-files dialog loads its file list before showing "Download all".
const DIALOG_WAIT_MS = 4000;

/** Polls until `find` returns something or `ms` passes; menus and dialogs render asynchronously. */
async function waitFor<T>(find: () => T | null, ms: number): Promise<T | null> {
  for (const end = Date.now() + ms; ; await sleep(150)) {
    const found = find();
    if (found || Date.now() >= end) return found;
  }
}

/** The visible element holding exactly one of `labels` as its text. */
function findByLabel(labels: Set<string>): HTMLElement | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (el && el.offsetParent !== null && labels.has((node.textContent || "").trim())) return el;
  }
  return null;
}

/** The arrow beside "Open in Bambu Studio" (or Suite/Handy) that opens the download menu. */
function findMenuArrow(): HTMLElement | null {
  const label = findByLabel(OPEN_IN_APP);
  if (!label) return null;
  let el = label.parentElement;
  for (let depth = 0; el && depth < 4; depth++, el = el.parentElement) {
    const arrow = [...el.children].find((child) => !child.contains(label) && child.querySelector("svg"));
    if (arrow) return arrow as HTMLElement;
  }
  return null;
}

async function armCapture(): Promise<boolean> {
  const armed = await send("ARM_DOWNLOAD_CAPTURE");
  return Boolean(armed && armed.ok);
}

// A model file on MakerWorld's file host, as opposed to any other link the page might click.
const FILE_LINK = /\.(3mf|zip|stl|step|stp|obj)$/i;

/** MakerWorld starts a download by clicking a temporary link to the file. Taking that click first
 *  reads the URL with no browser download at all (no download bubble, no "Save as" dialog). */
function interceptFileLink(timeoutMs: number): { url: Promise<string | null>; stop: () => void } {
  let resolveUrl!: (found: string | null) => void;
  const url = new Promise<string | null>((resolve) => (resolveUrl = resolve));
  const onClick = (event: MouseEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || !/^https?:/i.test(link.href)) return;
    if (!link.hasAttribute("download") && !FILE_LINK.test(new URL(link.href).pathname)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(link.href);
  };
  const timer = setTimeout(() => finish(null), timeoutMs);
  function finish(found: string | null): void {
    clearTimeout(timer);
    window.removeEventListener("click", onClick, true);
    resolveUrl(found);
  }
  window.addEventListener("click", onClick, true);
  return { url, stop: () => finish(null) };
}

/** The first URL either source finds, or null once both give up. */
function firstUrl(sources: Promise<string | null>[]): Promise<string | null> {
  return new Promise((resolve) => {
    let pending = sources.length;
    for (const source of sources) {
      void source.then((url) => {
        if (url) resolve(url);
        else if (--pending === 0) resolve(null);
      });
    }
  });
}

/** Escape, sent where MakerWorld's dialog listens: it traps focus inside itself. */
function closeFilesDialog(): void {
  (document.activeElement ?? document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

/** Clicks through MakerWorld's own download UI the way a person would: "Download 3MF" (the
 *  selected profile) from the menu under "Open in Bambu Studio", else the model's raw files (a
 *  zip, via the dialog's "Download all"), else any other download item. The browser download that
 *  starts is captured and cancelled (see background/downloadCapture.ts). Null means try the API
 *  fallback -- also what a CAPTCHA looks like here, since MakerWorld shows it instead of
 *  downloading. */
async function captureViaRealClick(profileOnly: boolean): Promise<{ url: string; isProfile: boolean } | null> {
  const arrow = findMenuArrow();
  arrow?.click();
  const fileItem = () => findByLabel(DOWNLOAD_3MF) ?? (profileOnly ? null : findByLabel(DOWNLOAD_STL));
  const found = arrow ? await waitFor(fileItem, MENU_WAIT_MS) : fileItem();
  const item = found ?? (profileOnly ? null : findByLabel(DOWNLOAD_OTHER));
  if (!item) return null;
  const isProfile = DOWNLOAD_3MF.has((item.textContent || "").trim());
  // The link intercept is what normally answers; the browser-download capture only backs it up,
  // should MakerWorld ever start a download some other way.
  const link = interceptFileLink(CAPTURE_TIMEOUT_MS);
  if (!(await armCapture())) {
    link.stop();
    return null;
  }
  item.click();
  if (!isProfile) {
    // Raw-file items open a dialog listing the files instead of downloading.
    const downloadAll = await waitFor(() => findByLabel(DOWNLOAD_ALL), DIALOG_WAIT_MS);
    if (downloadAll) {
      if (!(await armCapture())) {
        link.stop();
        return null;
      }
      downloadAll.click();
    }
  }
  const captured = send("AWAIT_DOWNLOAD_CAPTURE").then((res) => (res && res.ok ? res.data : null));
  const url = await firstUrl([link.url, captured]);
  link.stop();
  // Otherwise the still-armed capture would swallow the user's next real download.
  void send("DISARM_DOWNLOAD_CAPTURE");
  if (!isProfile) closeFilesDialog();
  return url ? { url, isProfile } : null;
}

/** The printer the profile was made for, which MakerWorld's own download request names. */
function instanceDevModelName(design: MakerworldDesign, instanceId: string): string {
  const instance = design.instances?.find((inst) => inst && String(inst.id) === instanceId) as
    Record<string, unknown> | undefined;
  const extension = instance?.extention as { modelInfo?: { compatibility?: { devModelName?: unknown } } } | undefined;
  const name = extension?.modelInfo?.compatibility?.devModelName;
  return typeof name === "string" ? name : "";
}

/** Sent exactly as MakerWorld's own "Download 3MF" sends it. */
async function fetchInstanceDownloadUrl(design: MakerworldDesign, instanceId: string): Promise<string | null> {
  const devModelName = encodeURIComponent(instanceDevModelName(design, instanceId));
  const apiUrl = `https://makerworld.com/api/v1/design-service/instance/${instanceId}/f3mf?type=download&fileType=&devModelName=${devModelName}`;
  return extractDownloadUrl(await fetchMakerworldApiJson(apiUrl, null));
}

/** Same two steps as the backend: instance-scoped endpoint, then model-scoped. */
async function resolveFromPageApi(pageUrl: string): Promise<ResolvedDownload | null> {
  // Fetched when the tab's own page data is stale, i.e. after clicking through MakerWorld.
  const page = await loadMakerworldDesignForPage(pageUrl);
  if (!page) return null; // the backend resolves from the URL
  const { design, nonce } = page;
  const instanceId = pickMakerworldInstanceId(design, page.requestedInstanceId);
  if (instanceId) {
    const downloadUrl = await fetchInstanceDownloadUrl(design, instanceId);
    if (downloadUrl) return { downloadUrl, instanceId, design: makerworldDesignForImport(design) };
  }
  // Model-level, i.e. the default profile's file.
  const apiUrl = `https://makerworld.com/api/v1/models/${String(design.id)}/download`;
  const downloadUrl = extractDownloadUrl(await fetchMakerworldApiJson(apiUrl, nonce));
  return downloadUrl
    ? { downloadUrl, instanceId: pickMakerworldInstanceId(design, null), design: makerworldDesignForImport(design) }
    : null;
}

/** `pageUrl` is captured by the caller before any await. */
/** `profileOnly` skips the raw-files zip, for callers that need the 3MF itself. */
export async function resolveMakerworldDownloadUrl(
  pageUrl: string,
  { profileOnly = false } = {},
): Promise<ResolvedDownload | null> {
  const viaClick = await captureViaRealClick(profileOnly).catch(() => null);
  if (viaClick) {
    // "Download 3MF" gives the page's selected profile, which follows the URL hash; the raw-files
    // zip belongs to no profile.
    const page = readMakerworldDesignForPage(pageUrl);
    const requested = parseMakerworldModelUrl(pageUrl)?.requestedInstanceId ?? null;
    const instanceId = !viaClick.isProfile
      ? null
      : page
        ? pickMakerworldInstanceId(page.design, page.requestedInstanceId)
        : requested;
    return page
      ? { downloadUrl: viaClick.url, instanceId, design: makerworldDesignForImport(page.design) }
      : { downloadUrl: viaClick.url, instanceId };
  }
  return resolveFromPageApi(pageUrl).catch((err) => {
    if (isMakerworldBlockingError(err)) throw err;
    return null;
  });
}

/** The Download button only gives the selected profile, so other profiles resolve via the API. */
export async function resolveMakerworldProfileDownload(
  pageUrl: string,
  instanceId: string,
): Promise<ResolvedDownload | null> {
  const page = await loadMakerworldDesignForPage(pageUrl);
  if (!page) return null;
  const downloadUrl = await fetchInstanceDownloadUrl(page.design, instanceId).catch((err) => {
    if (err instanceof MakerworldDownloadLimitError) throw err;
    return null;
  });
  return downloadUrl ? { downloadUrl, instanceId, design: makerworldDesignForImport(page.design) } : null;
}
