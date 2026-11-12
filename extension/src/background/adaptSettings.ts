// Adapt 3MFs' settings in the background. Grab keeps its own (shared/adaptSettings.ts); once connected, the Thingport
// instance's slicers and printers (its Configuration → Slicer and Printers) take their place. On connecting, Grab
// offers its own to an instance that has none yet, once per account.

import type { PrinterChoice } from "../adapter/plan.generated";
import type { PrinterRecipe } from "../adapter/printer.generated";
import { printerCatalogue } from "../printers/catalogue";
import {
  adaptSettingsOf,
  adaptUpdate,
  knownSlicers,
  type AdaptPrinter,
  type AdaptSettings,
} from "../shared/adaptSettings";
import { adaptInUse, adaptTargets, type TargetPrinter } from "../shared/adaptTargets";
import type { AdaptOffer, AdaptView, ThingportAdapt, ThingportPrinter } from "../shared/messages";
import { STORAGE_KEYS, type StoredConfig } from "../shared/storage";
import { ApiError, apiCall } from "./api";
import { getStoredConfig, isConfigured, type ConfiguredConfig } from "./config";

// Long enough for an instance that's up; past it, Grab's own settings stand in, as for one out of reach.
const INSTANCE_WAIT_MS = 5000;

const catalogue = printerCatalogue();

/** `GET /settings/slicer`, as any version answers it: one `slicer` before there were several. */
type SlicerSettings = {
  slicer?: string | null;
  slicers?: string[];
  unadapted?: string[];
  printers?: Record<string, unknown>;
};

/** One of `GET /me/printers`'s printers. */
type UserPrinterView = {
  printer: {
    id: string;
    model: string;
    bed: ThingportPrinter["bed"];
    height: number | null;
    extruders: number;
  };
  brandName: string;
  nozzle: string;
};

/** `account`: the connection to ask, rather than whichever is stored when the request goes. */
async function slicerSettings(account?: ConfiguredConfig): Promise<SlicerSettings> {
  return (await apiCall<SlicerSettings | null>("GET", "/settings/slicer", undefined, account)) ?? {};
}

function installedSlicers(settings: SlicerSettings): string[] {
  return knownSlicers(settings.slicers ?? (settings.slicer ? [settings.slicer] : []));
}

/** The user's printers there; null on an instance from before printers. */
async function thingportPrinters(account?: ConfiguredConfig): Promise<ThingportPrinter[] | null> {
  let listed: { printers?: UserPrinterView[] } | null;
  try {
    listed = await apiCall("GET", "/me/printers", undefined, account);
  } catch (err) {
    // No such route, or the web app answering for one it doesn't know.
    if ((err instanceof ApiError && err.status === 404) || err instanceof SyntaxError) return null;
    throw err;
  }
  if (!Array.isArray(listed?.printers)) return null;
  return listed.printers.map(({ printer, brandName, nozzle }) => ({
    id: printer.id,
    brandName,
    model: printer.model,
    nozzle,
    bed: printer.bed ? { shape: printer.bed.shape, x: printer.bed.x, y: printer.bed.y } : null,
    height: printer.height,
    extruders: printer.extruders,
  }));
}

async function thingportAdapt(): Promise<ThingportAdapt> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("it didn't answer in time")), INSTANCE_WAIT_MS);
  });
  const [settings, printers] = await Promise.race([Promise.all([slicerSettings(), thingportPrinters()]), late]).finally(
    () => clearTimeout(timer),
  );
  const slicerPrinters = Object.fromEntries(
    Object.entries(settings.printers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return { slicers: installedSlicers(settings), printers, slicerPrinters, unadapted: knownSlicers(settings.unadapted) };
}

export async function getAdaptView(): Promise<AdaptView> {
  const config = await getStoredConfig();
  const own = adaptSettingsOf(config);
  if (!isConfigured(config) || config.disabled) return { own, thingport: null, instanceUrl: "" };
  const { instanceUrl } = config;
  try {
    return { own, thingport: await thingportAdapt(), instanceUrl };
  } catch (err) {
    return { own, thingport: { error: err instanceof Error ? err.message : String(err) }, instanceUrl };
  }
}

export async function setAdaptSettings(change: Partial<AdaptSettings>): Promise<AdaptSettings> {
  await chrome.storage.local.set(adaptUpdate(change));
  return adaptSettingsOf(await getStoredConfig());
}

type CarrySection = "slicers" | "printers";

function carriedOf(config: StoredConfig): Record<string, CarrySection[]> {
  const stored = config.adaptCarriedTo;
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

/** The instance turned down one printer or its nozzle (it doesn't know it), rather than the request failing. */
const printerRefused = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 400);

/** Grab's own picks, to the account connected now. Every request goes to that account, should the connection change
 *  meanwhile. Each part is marked as gone once it's settled, so a failure leaves only what's left to try on the next
 *  connection, and none is sent twice: ones the user removed there since aren't brought back. */
async function carry(): Promise<void> {
  const config = await getStoredConfig();
  if (!isConfigured(config)) return;
  const account = `${config.instanceUrl}|${config.email}`;
  const done = new Set(carriedOf(config)[account] ?? []);
  const settled = async (section: CarrySection) => {
    done.add(section);
    const carried = carriedOf(await getStoredConfig());
    await chrome.storage.local.set({ [STORAGE_KEYS.adaptCarriedTo]: { ...carried, [account]: [...done] } });
  };
  const own = adaptSettingsOf(config);
  try {
    if (!done.has("slicers")) {
      if (own.slicers.length && !installedSlicers(await slicerSettings(config)).length) {
        // `slicer` too, for an instance from before there were several.
        await apiCall("PATCH", "/settings/slicer", { slicer: own.slicers[0], slicers: own.slicers }, config);
      }
      await settled("slicers");
    }
    if (!done.has("printers")) {
      if (own.printers.length && (await thingportPrinters(config))?.length === 0) {
        for (const { id, nozzle } of own.printers) {
          // One it doesn't know is left out; anything else stops here, to be tried again.
          await apiCall("PUT", `/me/printers/${encodeURIComponent(id)}`, { nozzle }, config).catch((err: unknown) => {
            if (!printerRefused(err)) throw err;
          });
        }
      }
      await settled("printers");
    }
  } catch (err) {
    console.warn("[adapt] Grab's slicers and printers didn't all go to the instance; the rest goes next time:", err);
  }
}

let carrying: Promise<void> = Promise.resolve();

/**
 * On connecting: Grab's own slicers go to the instance when it has none, and its printers when it has no printers.
 * Only the first time Grab connects to that account, so ones the user removed there later aren't brought back. One
 * after another: a connection made while one is going waits for it, then goes to its own account.
 */
export function carryAdaptPicks(): Promise<void> {
  carrying = carrying.then(carry).catch((err: unknown) => console.warn("[adapt] Couldn't read Grab's settings:", err));
  return carrying;
}

/** Grab's own printers as the catalogue describes them; one it no longer has keeps its id for a name. */
async function describeOwn(): Promise<(printer: AdaptPrinter) => TargetPrinter> {
  const index = await catalogue.index().catch(() => null);
  const brands = new Map(index?.brands.map((brand) => [brand.id, brand.name]) ?? []);
  return ({ id, nozzle }) => {
    const known = index?.byId.get(id);
    if (!known) return { id, brandName: "", model: id, nozzle, bed: null, height: null, extruders: 1 };
    const { model, bed, height, extruders } = known;
    return { id, brandName: brands.get(known.brand) ?? known.brand, model, nozzle, bed, height, extruders };
  };
}

export async function getAdaptOffer(): Promise<AdaptOffer> {
  const [view, describe, stored] = await Promise.all([getAdaptView(), describeOwn(), getStoredConfig()]);
  return {
    targets: adaptTargets(adaptInUse(view, describe)),
    placement: view.own.placement,
    lastKey: stored.adaptLastTarget ?? null,
    connected: view.thingport !== null,
  };
}

export async function setAdaptLast(key: string): Promise<null> {
  await chrome.storage.local.set({ [STORAGE_KEYS.adaptLastTarget]: String(key) });
  return null;
}

export function printerRecipeFor(
  slicer: string,
  printerId: string,
  nozzle: string,
): Promise<{ choice: PrinterChoice; recipe: PrinterRecipe } | null> {
  return catalogue.recipe(slicer, printerId, nozzle);
}

/** The popup, opened at Adapt 3MFs' settings: it reads the flag as it opens. A tab says so in its address. */
export async function openAdaptSettings(): Promise<"popup" | "tab"> {
  await chrome.storage.local.set({ [STORAGE_KEYS.adaptOpenSettings]: Date.now() });
  try {
    await chrome.action.openPopup();
    return "popup";
  } catch {
    await chrome.storage.local.remove(STORAGE_KEYS.adaptOpenSettings);
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=adapt") });
    return "tab";
  }
}
