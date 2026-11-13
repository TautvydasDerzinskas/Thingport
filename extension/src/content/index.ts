// Content script entry point (MakerWorld, Thingiverse, Printables, and the optional sites in optionalSites.ts once
// turned on). Network calls go through the background (see runtime.ts). Download adapted (adapted/) and MakerWorld's
// download resolution for the import button are wired in here, as the page's offline features and the button are
// every provider's.

import type { ImportStatus } from "../shared/api";
import { listen, send, type ContentMessages } from "../shared/messages";
import { bubbleLookOf } from "../shared/bubble";
import { ADAPT_CHANGE_KEYS, CONFIG_CHANGE_KEYS, STORAGE_KEYS } from "../shared/storage";
import { classifyUrl } from "../shared/urls";
import { libraryStateOf, setContext, type LibraryState } from "./context";
import {
  isMakerworldBlockingError,
  resolveMakerworldDownloadUrl,
  resolveMakerworldProfileDownload,
} from "../providers/makerworld/downloadResolver";
import {
  adaptedReveal,
  loadPageAdapt,
  mountAdaptBubble,
  mountAdaptedButton,
  unmountAdaptedButton,
  type PageAdapt,
} from "./adapted";
import { mountJobOverlay, mountPausedJobOverlay } from "./overlays";
import { loadPanel } from "./panels";
import { profileGap } from "./profiles";
import { captureProviderAccount } from "./providerAccount";
import { providerEnabled } from "./providerSettings";
import { CONTENT_MODULES } from "../providers/content";
import { trackViewedModel } from "./recentlyViewed";
import { errorHtml } from "./panels/results";
import { api, isOwnNavigation } from "./runtime";
import { closeSetupModal, openSetupModal, setupModalOpen } from "./setupModal";
import {
  SHARED_SCRIPT_EXPLAINER,
  SHARED_SCRIPT_NOTE_HTML,
  WITHHELD_SCRIPT_EXPLAINER,
  WITHHELD_SCRIPT_NOTE_HTML,
} from "./scriptNote";
import {
  mountFab,
  mountFabNote,
  mountHost,
  mountPanel,
  renderPanel,
  setBubbleLook,
  setPanelExtra,
  setPanelOpen,
  unmountHost,
} from "./shell";
import { providerOfHost } from "../providers/index.generated";

declare global {
  interface Window {
    thingportGrabInjected?: boolean;
  }
}

// Bumped on every re-init so stale in-flight checks don't mount an icon for the wrong URL.
let initToken = 0;

// How long Download adapted waits for the bubble to be ready for its copies: a Thingport instance that doesn't answer
// mustn't hold them back, so past this they go beside the site's button.
const BUBBLE_WAIT_MS = 6000;
// Not set up, with the copies in the bubble: how long its icon waits for them, rather than showing without them first.
const SETUP_ICON_WAIT_MS = 1000;
// Adapt 3MFs' settings change a click at a time as they're picked: how long a page waits for the next before it
// offers the copies anew.
const ADAPT_SETTLE_MS = 400;

function reportTabIconState(active: boolean): void {
  void send("SET_TAB_ICON_STATE", { active });
}

// Which provider's site this is, so the popup can put it above the rest -- it has no way to read the address itself
// (background/providerTab.ts). Said again whenever the tab comes back to the front, so the note is there even if
// something cleared it meanwhile. Not part of init(): it holds for every page of the site, importable or not,
// whether or not Grab is set up.
function reportProviderSite(): void {
  const provider = providerOfHost(location.hostname);
  if (provider) void send("NOTE_PROVIDER_TAB", { provider });
}

function unmount(): void {
  closeSetupModal();
  unmountAdaptedButton();
  unmountHost();
  setContext(null);
}

// Adapt 3MFs' settings changed, and the page hasn't offered the copies anew yet.
let adaptChanged = false;
let adaptSettle: ReturnType<typeof setTimeout> | undefined;

function reinit(): void {
  adaptChanged = false;
  clearTimeout(adaptSettle);
  unmount();
  void init();
}

/** Offers the copies anew once the settings have settled, and in a hidden tab once it's shown: otherwise every open
 *  page would start over at each click, hidden ones for nobody to see. */
function reinitForAdapt(): void {
  adaptChanged = true;
  clearTimeout(adaptSettle);
  if (!document.hidden) adaptSettle = setTimeout(reinit, ADAPT_SETTLE_MS);
}

async function init(): Promise<void> {
  const myToken = ++initToken;
  const isStale = () => myToken !== initToken;

  // A guided collection import takes over the whole page.
  const jobRes = await send("GET_MAKERWORLD_JOB");
  if (isStale()) return;
  if (jobRes?.ok && jobRes.data.job) {
    const job = jobRes.data.job;
    if (job.paused) mountPausedJobOverlay(mountHost(), job);
    else mountJobOverlay(mountHost(), job);
    reportTabIconState(true);
    return;
  }

  const stateRes = await send("GET_STATE");
  if (isStale()) return;
  if (!stateRes?.ok || stateRes.data.disabled) {
    reportTabIconState(false);
    return;
  }
  // Before any bubble is mounted, so it comes up in its own style and corner.
  setBubbleLook(stateRes.data.bubble);
  // On every page, importable or not: the header shows who's signed in everywhere.
  if (stateRes.data.configured) captureProviderAccount(location.hostname);

  const url = location.href;
  const classification = classifyUrl(url);
  if (!classification) {
    reportTabIconState(false);
    return;
  }

  if (classification.kind === "single") void trackViewedModel(url, isStale);

  // Download adapted: beside the site's own button, or in the bubble where the settings say so and this page's bubble
  // can hold it (`adaptHost`, set below by the bubble that can); where none can, beside the site's button after all.
  // Where the site's button never shows, in the bubble that can hold the copies, or else in one that only can when
  // it must (`adaptFallback`: one that can't reach the instance, say).
  const adapting =
    classification.kind === "single" && stateRes.data.offlineFeatures.normalizeMakerworld
      ? loadPageAdapt(classification.provider, url)
      : Promise.resolve(null);
  let adaptHost: ((page: PageAdapt) => void) | null = null;
  let adaptFallback: ((page: PageAdapt) => void) | null = null;
  let bubbleSettled!: () => void;
  const settled = new Promise<void>((resolve) => (bubbleSettled = resolve));
  const settledOrLate = Promise.race([settled, new Promise((resolve) => setTimeout(resolve, BUBBLE_WAIT_MS))]);
  void Promise.all([adapting, settledOrLate]).then(([page]) => {
    if (!page || isStale()) return;
    if (page.offer.placement === "bubble" && adaptHost) {
      adaptHost(page);
      return;
    }
    mountAdaptedButton(page, url, () => {
      const offer = adaptHost ?? adaptFallback;
      if (isStale() || !offer) return false;
      offer(page);
      return true;
    });
  });

  try {
    // Not set up: still show a grayed-out icon on importable pages so the extension is discoverable. Where Download
    // adapted goes in the bubble, the bubble offers its copies with setting imports up under them: waited for a
    // moment, else they take the icon's place when they come.
    if (!stateRes.data.configured) {
      const page =
        stateRes.data.adaptPlacement === "bubble"
          ? await Promise.race([
              adapting,
              new Promise<null>((resolve) => setTimeout(() => resolve(null), SETUP_ICON_WAIT_MS)),
            ])
          : null;
      if (isStale()) return;
      const adaptBubble = (offered: PageAdapt) => {
        // The set-up dialog would go with the icon it was opened from.
        if (setupModalOpen()) return;
        unmountHost();
        const root = mountHost();
        mountAdaptBubble(root, classification.provider, url, offered, {
          text: "Want it in your Thingport library as well? ",
          action: "Set up Grab",
          onClick: () => openSetupModal(root),
        });
      };
      if (page?.offer.placement === "bubble") {
        adaptBubble(page);
        adaptHost = () => undefined;
      } else {
        const root = mountHost();
        mountFab(root, {
          variant: "inactive",
          label: "Set up Thingport Grab to import this",
          title: "Thingport Grab isn't set up yet",
          onClick: () => openSetupModal(root),
        });
        adaptHost = adaptBubble;
      }
      reportTabIconState(false);
      return;
    }

    // Until the instance answers, which may be never: the copies on their own where the site's button doesn't show,
    // as they're this browser's own. Where they were, what the answer brings takes their place and offers them again.
    let early: PageAdapt | null = null;
    adaptFallback = (page) => {
      early = page;
      mountAdaptBubble(mountHost(), classification.provider, url, page, null);
    };
    const replaceEarly = (): PageAdapt | null => {
      const page = early;
      early = null;
      if (page) unmountHost();
      return page;
    };
    // Before anything else asks the instance, so a stale password or a down instance shows as such
    // rather than as every model looking new.
    const connectionRes = await send("CHECK_CONNECTION");
    if (isStale()) return;
    if (connectionRes?.ok && !connectionRes.data.connected) {
      const problem = connectionRes.data;
      const signIn = (root: ShadowRoot) =>
        openSetupModal(root, {
          problem,
          instanceUrl: stateRes.data.instanceUrl,
          // A failed check isn't cached, so this signs in again.
          onRetry: reinit,
        });
      const offered = replaceEarly();
      const root = mountHost();
      mountFab(root, {
        variant: "disconnected",
        label: "Thingport Grab can't sign in to your Thingport instance",
        title: "Thingport Grab can't sign in to your Thingport instance",
        onClick: () => signIn(root),
      });
      // Only where the site's button never shows: the copies, with the way to sign in again under them.
      adaptFallback = (page) => {
        closeSetupModal();
        unmountHost();
        const adaptRoot = mountHost();
        mountAdaptBubble(adaptRoot, classification.provider, url, page, {
          text: "Thingport Grab can't sign in to your Thingport instance. ",
          action: "Sign in again",
          onClick: () => signIn(adaptRoot),
        });
      };
      if (offered) adaptFallback(offered);
      reportTabIconState(false);
      return;
    }

    // An admin turned this provider off for the whole instance: nothing from here would be accepted.
    const enabled = await providerEnabled(classification.provider);
    if (isStale()) return;
    if (!enabled) {
      // Imports aren't, but the copies are this browser's own: where the site's button never shows, a bubble of them.
      const offered = replaceEarly();
      adaptFallback = (page) => mountAdaptBubble(mountHost(), classification.provider, url, page, null);
      if (offered) adaptFallback(offered);
      reportTabIconState(false);
      return;
    }

    // Some lists only their owner sees, and the instance reads them as the user: offered on their own page alone.
    let pageUrl = url;
    if (classification.kind === "batch") {
      const own = await CONTENT_MODULES[classification.provider].ownList?.(url, classification.type);
      if (isStale()) return;
      if (own === null) {
        reportTabIconState(false);
        return;
      }
      pageUrl = own ?? url;
    }

    let library: LibraryState | null = null;
    // Of the page's print profiles, how many the library's model hasn't got, when the page's own is on it.
    let missingProfiles = 0;
    if (classification.kind === "single") {
      try {
        const status = await api<ImportStatus>("GET", `/import/status?url=${encodeURIComponent(url)}`);
        if (isStale()) return;
        // Which of the page's print profiles the library's model lacks, for a model it has.
        const gap =
          status.already_imported && status.print_id
            ? await profileGap(classification.provider, url, status.imported_profile_ids)
            : "none";
        if (isStale()) return;
        missingProfiles = gap && gap !== "none" ? gap.all.length : 0;
        library = libraryStateOf(status, gap);
      } catch {
        // Show the icon anyway; the panel surfaces the real error.
      }
    }
    if (isStale()) return;

    setContext({
      url: pageUrl,
      instanceUrl: stateRes.data.instanceUrl,
      classification,
      library,
      canQueue: stateRes.data.canQueue,
      importQueue: stateRes.data.importQueue,
    });
    const offered = replaceEarly();
    const root = mountHost();
    const togglePanel = mountPanel(root, () => void loadPanel());
    // Under the import, as an extra: a quiet button that shows the copies when it's clicked.
    adaptHost = (page) => setPanelExtra(adaptedReveal(page, url));
    if (offered) adaptHost(offered);
    mountFab(root, {
      // A plus while there's something to add to the library's model, a tick once there's nothing.
      variant: !library ? undefined : library.state === "complete" ? "complete" : "in-library",
      label: !library
        ? "Import to Thingport"
        : library.state === "complete"
          ? "Imported to Thingport: open it there"
          : missingProfiles
            ? `Add the ${missingProfiles} missing print profile${missingProfiles === 1 ? "" : "s"} to Thingport`
            : library.state === "imported"
              ? "Fetch this model's missing details into Thingport"
              : "Add this print profile to Thingport",
      onClick: togglePanel,
    });
    reportTabIconState(true);

    // A model built from a script says under the icon whether the script comes with it, before anyone opens the
    // panel and finds out. Best-effort and last: a page that won't say is treated as any other model.
    if (classification.kind === "single") {
      void CONTENT_MODULES[classification.provider]
        .scriptState?.(pageUrl)
        .then((script) => {
          if (!script || isStale()) return;
          const [html, explainer] = script.withheld
            ? [WITHHELD_SCRIPT_NOTE_HTML, WITHHELD_SCRIPT_EXPLAINER]
            : [SHARED_SCRIPT_NOTE_HTML, SHARED_SCRIPT_EXPLAINER];
          mountFabNote(root, html, explainer);
        })
        .catch(() => undefined);
    }

    // A guided import that stopped early lands back here, so show why.
    if (jobRes?.ok && jobRes.data.error) {
      const { message, imported, total } = jobRes.data.error;
      setPanelOpen(true);
      renderPanel(errorHtml(new Error(`Guided import stopped after ${imported} of ${total} models: ${message}`)));
    }
  } finally {
    bubbleSettled();
  }
}

// The sites are SPAs, so this script runs once per tab and has to notice the address changing under it. A content
// script can't hook the page's own history.pushState -- it runs in a JavaScript world of its own, so replacing
// History's methods there only catches calls made from this script, of which there are none -- so popstate covers
// going back and forward, and a poll covers the links.
function installNavigationWatcher(): void {
  let lastHref = location.href;
  const onLocationChange = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (isOwnNavigation()) return;
    // Said again because the browser treats this as a navigation and drops what it knows about the tab, the note
    // the popup features the site from included (background/providerTab.ts).
    reportProviderSite();
    reinit();
  };
  window.addEventListener("popstate", onLocationChange);
  setInterval(onLocationChange, 1000);
}

if (!window.thingportGrabInjected) {
  window.thingportGrabInjected = true;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    // A new look in the popup's Appearance tab moves the bubble showing now, its panel open or not.
    if (STORAGE_KEYS.bubbleStyle in changes || STORAGE_KEYS.bubblePlace in changes) {
      void chrome.storage.local.get([STORAGE_KEYS.bubbleStyle, STORAGE_KEYS.bubblePlace]).then(
        (stored) => setBubbleLook(bubbleLookOf(stored)),
        () => undefined,
      );
    }
    if (CONFIG_CHANGE_KEYS.some((key) => key in changes)) reinit();
    else if (ADAPT_CHANGE_KEYS.some((key) => key in changes)) reinitForAdapt();
  });

  listen<ContentMessages>({
    // A CAPTCHA or the daily download limit comes back as an error reply so the guided import can
    // say so.
    RESOLVE_MAKERWORLD_DOWNLOAD_URL: () =>
      resolveMakerworldDownloadUrl(location.href).catch((err) => {
        if (isMakerworldBlockingError(err)) throw err;
        return null;
      }),
    READ_MAKERWORLD_PROFILES: async ({ scope }) =>
      (await CONTENT_MODULES.makerworld.loadProfiles?.(location.href))?.(scope) ?? null,
    RESOLVE_MAKERWORLD_PROFILE_DOWNLOAD: ({ instanceId }) =>
      resolveMakerworldProfileDownload(location.href, instanceId).catch((err) => {
        if (isMakerworldBlockingError(err)) throw err;
        return null;
      }),
    MAKERWORLD_JOB_UPDATED: () => {
      reinit();
      return null;
    },
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    reportProviderSite();
    if (adaptChanged) reinit();
  });

  installNavigationWatcher();
  reportProviderSite();
  void init();
}
