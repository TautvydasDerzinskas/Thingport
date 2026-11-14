// Resolves the MakerWorld file URL in the page instead of the backend, whose resolution calls are
// what trip MakerWorld's account-wide CAPTCHA. Same-origin fetches carry the real session and look
// like the page's own traffic. Returns null on any failure so the backend can resolve it instead,
// except a CAPTCHA or the daily download limit, which are thrown: the backend would only hit the
// same wall.

import type { ResolvedDownload } from "../../shared/messages";
import { t } from "../../shared/i18n";
import { providerCredentialRequest } from "../../shared/providerCredentialRequest";
import { send } from "../../shared/messages";
import { parseMakerworldModelUrl } from "./urls.generated";
import { holdingNavigation, sleep } from "../../content/runtime";
import { DOWNLOAD_3MF, DOWNLOAD_ALL, DOWNLOAD_OTHER, DOWNLOAD_STL, OPEN_IN_APP } from "./labels";
import {
  loadMakerworldDesignForPage,
  makerworldDesignForImport,
  pickMakerworldInstanceId,
  readMakerworldDesignForPage,
  type MakerworldDesign,
} from "./pageData";
import { MANIFESTS } from "../index.generated";

const MAKERWORLD_API = MANIFESTS.makerworld.endpoints.api;

// fetch() has no timeout, and some endpoints hold an interactive challenge open indefinitely.
const MAKERWORLD_API_FETCH_TIMEOUT_MS = 8000;

// What MakerWorld's own web client sends with its API calls; it answers 403 without them.
const MAKERWORLD_CLIENT_HEADERS = {
  "X-BBL-Client-Name": "MakerWorld",
  "X-BBL-Client-Type": "web",
  "X-BBL-Client-Version": "00.00.00.01",
  "X-BBL-App-Source": MANIFESTS.makerworld.id,
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

/** MakerWorld's anti-bot layer answers with HTTP 418 (sometimes 200) and a body naming a captcha.
 *  Thrown rather than returned as null so it isn't reported as "no file found". */
export class MakerworldCaptchaError extends Error {
  constructor() {
    super(t("makerworldCaptchaMessage"));
    this.name = "MakerworldCaptchaError";
  }
}

/** The per-account daily cap: HTTP 400 with {"code":-1,"error":"You've reached your daily download
 *  limit."}. Every later download fails the same way until it resets. */
export class MakerworldDownloadLimitError extends Error {
  constructor() {
    super(t("makerworldDownloadLimit"));
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
async function captureViaRealClick(
  profileOnly: boolean,
  stillWanted?: () => boolean,
): Promise<{ url: string; isProfile: boolean } | null> {
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
  // The menu downloads for whichever model and profile the page shows when it's clicked: ones the user went to
  // meanwhile would be taken for those asked for.
  if (stillWanted && !stillWanted()) {
    link.stop();
    void send("DISARM_DOWNLOAD_CAPTURE");
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
  const apiUrl = `${MAKERWORLD_API}/design-service/instance/${instanceId}/f3mf?type=download&fileType=&devModelName=${devModelName}`;
  return extractDownloadUrl(await fetchMakerworldApiJson(apiUrl, null));
}

/** Same two steps as the backend: instance-scoped endpoint, then model-scoped. `picked` is the profile the page showed,
 *  which its link needn't name. */
async function resolveFromPageApi(pageUrl: string, picked: string | null = null): Promise<ResolvedDownload | null> {
  // Fetched when the tab's own page data is stale, i.e. after clicking through MakerWorld.
  const page = await loadMakerworldDesignForPage(pageUrl);
  if (!page) return null; // the backend resolves from the URL
  const { design, nonce } = page;
  const instanceId = picked ?? pickMakerworldInstanceId(design, page.requestedInstanceId);
  if (instanceId) {
    const downloadUrl = await fetchInstanceDownloadUrl(design, instanceId);
    if (downloadUrl) return { downloadUrl, instanceId, design: makerworldDesignForImport(design) };
  }
  // Model-level, i.e. the default profile's file.
  const apiUrl = `${MAKERWORLD_API}/models/${String(design.id)}/download`;
  const downloadUrl = extractDownloadUrl(await fetchMakerworldApiJson(apiUrl, nonce));
  return downloadUrl
    ? { downloadUrl, instanceId: pickMakerworldInstanceId(design, null), design: makerworldDesignForImport(design) }
    : null;
}

/** The page open now shows `pageUrl`'s model. One the user went on to has profiles of its own, perhaps named alike. */
function onModelOf(pageUrl: string): boolean {
  const wanted = parseMakerworldModelUrl(pageUrl)?.designId;
  return Boolean(wanted && parseMakerworldModelUrl(location.href)?.designId === wanted);
}

/** `pageUrl` is captured by the caller before any await. */
/** `profileOnly` skips the raw-files zip, for callers that need the 3MF itself. */
export async function resolveMakerworldDownloadUrl(
  pageUrl: string,
  { profileOnly = false } = {},
): Promise<ResolvedDownload | null> {
  // "Download 3MF" gives the page's selected profile, which follows the URL hash, so it's read before the click and
  // held to; the raw-files zip belongs to no profile. Only on the model's own page: another has its own.
  const page = readMakerworldDesignForPage(pageUrl);
  const onModel = () => onModelOf(pageUrl);
  const picked = page && onModel() ? pageSelectedInstanceId(page.design) : null;
  const stillWanted = () => onModel() && (!page || !picked || pageSelectedInstanceId(page.design) === picked);
  const viaClick = onModel() ? await captureViaRealClick(profileOnly, stillWanted).catch(() => null) : null;
  if (viaClick) {
    const requested = parseMakerworldModelUrl(pageUrl)?.requestedInstanceId ?? null;
    const instanceId = !viaClick.isProfile
      ? null
      : page
        ? (picked ?? pickMakerworldInstanceId(page.design, page.requestedInstanceId))
        : requested;
    return page
      ? { downloadUrl: viaClick.url, instanceId, design: makerworldDesignForImport(page.design) }
      : { downloadUrl: viaClick.url, instanceId };
  }
  return resolveFromPageApi(pageUrl, picked).catch((err) => {
    if (isMakerworldBlockingError(err)) throw err;
    return null;
  });
}

// How long a clicked profile's card may take to show as picked, on a slow page.
const PROFILE_SELECT_WAIT_MS = 4000;

/** The title of the profile's card in the page's list of print profiles. `config_title` is the page's own class name,
 *  unlike its hashed ones. Matched by the card's picture, whose address carries the profile id, and by its title only
 *  where no other card shares it. */
function findProfileTitle(design: MakerworldDesign, instanceId: string): HTMLElement | null {
  const instance = design.instances?.find((inst) => inst && String(inst.id) === instanceId);
  if (!instance) return null;
  const picturePath = instance.profileId != null ? `/${instance.profileId}/instance/` : null;
  const titles = [...document.querySelectorAll<HTMLElement>(".config_title")];
  const byPicture = picturePath
    ? titles.find((title) => cardOf(title)?.querySelector(`img[src*="${picturePath}"]`))
    : undefined;
  if (byPicture) return byPicture;
  const named = titles.filter((title) => (title.textContent || "").trim() === (instance.title || "").trim());
  return named.length === 1 ? named[0] : null;
}

/** A card is the closest box holding its picture as well as its title. */
function cardOf(title: HTMLElement): HTMLElement | null {
  for (let el = title.parentElement; el; el = el.parentElement) {
    if (el.querySelector("img")) return el;
  }
  return null;
}

/** The profile the page shows picked, by its card. On an address naming none, MakerWorld picks the first it lists,
 *  which needn't be the design's `defaultInstanceId`. Read afresh: the page may render the list again on a pick. */
function pageSelectedInstanceId(design: MakerworldDesign): string | null {
  const picked = design.instances?.find((inst) => {
    if (!inst || inst.id == null) return false;
    const title = findProfileTitle(design, String(inst.id));
    return Boolean(title && cardOf(title)?.classList.contains("active"));
  });
  return picked ? String(picked.id) : null;
}

/** Clicks the profile in the page's list, as a person picking it would, unless it's the one already picked. False
 *  when the page doesn't list it, or doesn't take the click. */
async function selectProfileOnPage(design: MakerworldDesign, instanceId: string): Promise<boolean> {
  const title = findProfileTitle(design, instanceId);
  if (!title) return false;
  const selected = () => pageSelectedInstanceId(design) === instanceId;
  if (selected()) return true;
  title.scrollIntoView({ block: "nearest" });
  title.click();
  return Boolean(await waitFor(() => (selected() ? true : null), PROFILE_SELECT_WAIT_MS));
}

/**
 * Picks the profile on the page as a person would, then downloads it with the page's own "Download 3MF". Where the page
 * doesn't list it (a community profile behind "more") or won't pick it, the request that button sends instead.
 */
export async function resolveMakerworldProfileDownload(
  pageUrl: string,
  instanceId: string,
): Promise<ResolvedDownload | null> {
  const page = await loadMakerworldDesignForPage(pageUrl);
  if (!page) return null;
  const design = makerworldDesignForImport(page.design);
  // On another model's page, a card named like this profile would be one of that model's.
  const onModel = () => onModelOf(pageUrl);
  const viaClick = onModel()
    ? await holdingNavigation(async () =>
        (await selectProfileOnPage(page.design, instanceId))
          ? captureViaRealClick(true, () => onModel() && pageSelectedInstanceId(page.design) === instanceId).catch(
              () => null,
            )
          : null,
      )
    : null;
  if (viaClick) return { downloadUrl: viaClick.url, instanceId, design };
  const downloadUrl = await fetchInstanceDownloadUrl(page.design, instanceId).catch((err) => {
    if (isMakerworldBlockingError(err)) throw err;
    return null;
  });
  return downloadUrl ? { downloadUrl, instanceId, design } : null;
}
