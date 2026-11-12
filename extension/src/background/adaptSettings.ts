// Adapt 3MFs' settings in the background. Grab keeps its own (shared/adaptSettings.ts); once connected, the Thingport
// instance's slicers and printers (its Configuration → Slicer and Printers) take their place. On connecting, Grab
// offers its own to an instance that has none yet, once per account.

import { adaptSettingsOf, adaptUpdate, knownSlicers, type AdaptSettings } from "../shared/adaptSettings";
import type { AdaptView, ThingportAdapt, ThingportPrinter } from "../shared/messages";
import { STORAGE_KEYS } from "../shared/storage";
import { ApiError, apiCall } from "./api";
import { getStoredConfig, isConfigured } from "./config";

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

async function slicerSettings(): Promise<SlicerSettings> {
  return (await apiCall<SlicerSettings | null>("GET", "/settings/slicer")) ?? {};
}

function installedSlicers(settings: SlicerSettings): string[] {
  return knownSlicers(settings.slicers ?? (settings.slicer ? [settings.slicer] : []));
}

/** The user's printers there; null on an instance from before printers. */
async function thingportPrinters(): Promise<ThingportPrinter[] | null> {
  let listed: { printers?: UserPrinterView[] } | null;
  try {
    listed = await apiCall("GET", "/me/printers");
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
  const [settings, printers] = await Promise.all([slicerSettings(), thingportPrinters()]);
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

async function carry(): Promise<void> {
  const config = await getStoredConfig();
  if (!isConfigured(config)) return;
  const account = `${config.instanceUrl}|${config.email}`;
  if (config.adaptCarriedTo === account) return;
  const own = adaptSettingsOf(config);
  try {
    if (own.slicers.length && !installedSlicers(await slicerSettings()).length) {
      // `slicer` too, for an instance from before there were several.
      await apiCall("PATCH", "/settings/slicer", { slicer: own.slicers[0], slicers: own.slicers });
    }
    if (own.printers.length && (await thingportPrinters())?.length === 0) {
      for (const { id, nozzle } of own.printers) {
        // One its catalogue doesn't know is left out.
        await apiCall("PUT", `/me/printers/${encodeURIComponent(id)}`, { nozzle }).catch(() => undefined);
      }
    }
  } catch (err) {
    console.warn("[adapt] Grab's slicers and printers didn't go to the instance:", err);
  } finally {
    await chrome.storage.local.set({ [STORAGE_KEYS.adaptCarriedTo]: account });
  }
}

let carrying: Promise<void> | null = null;

/**
 * On connecting: Grab's own slicers go to the instance when it has none, and its printers when it has no printers.
 * Only the first time Grab connects to that account, so ones the user removed there later aren't brought back.
 */
export function carryAdaptPicks(): Promise<void> {
  carrying ??= carry().finally(() => {
    carrying = null;
  });
  return carrying;
}
