// Adapt 3MFs' settings in the background. Grab keeps its own (shared/adaptSettings.ts); once connected, the Thingport
// instance's slicers and printers (its Configuration → Slicer and Printers) take their place. On connecting, Grab
// offers its own to an instance that has none yet, once per account.

import { adaptSettingsOf, adaptUpdate, knownSlicers, type AdaptSettings } from "../shared/adaptSettings";
import type { AdaptView, ThingportAdapt, ThingportPrinter } from "../shared/messages";
import { STORAGE_KEYS, type StoredConfig } from "../shared/storage";
import { ApiError, apiCall } from "./api";
import { getStoredConfig, isConfigured, type ConfiguredConfig } from "./config";

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

/** The slicers the account has picked, Grab's ids or not. */
const pickedSlicers = (settings: SlicerSettings) => settings.slicers ?? (settings.slicer ? [settings.slicer] : []);

function installedSlicers(settings: SlicerSettings): string[] {
  return knownSlicers(pickedSlicers(settings));
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

// Long enough for an instance that's up; past it, Grab's own settings stand in, as for one out of reach.
const INSTANCE_WAIT_MS = 5000;

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

const sameAccount = (a: StoredConfig, b: StoredConfig) => a.instanceUrl === b.instanceUrl && a.email === b.email;

export async function getAdaptView(): Promise<AdaptView> {
  const config = await getStoredConfig();
  const own = adaptSettingsOf(config);
  if (!isConfigured(config) || config.disabled) return { own, thingport: null, instanceUrl: "" };
  const { instanceUrl } = config;
  let thingport: AdaptView["thingport"];
  try {
    thingport = await thingportAdapt();
  } catch (err) {
    thingport = { error: err instanceof Error ? err.message : String(err) };
  }
  // Connected to another account meanwhile: what came back may be either's, so it's asked again.
  if (!sameAccount(await getStoredConfig(), config)) return getAdaptView();
  return { own, thingport, instanceUrl };
}

export async function setAdaptSettings(change: Partial<AdaptSettings>): Promise<AdaptSettings> {
  await chrome.storage.local.set(adaptUpdate(change));
  return adaptSettingsOf(await getStoredConfig());
}

type CarrySection = "slicers" | "printers";
type Carried = { settled: CarrySection[]; printersSent?: string[] };

function carriedOf(config: StoredConfig): Record<string, Carried> {
  const stored = config.adaptCarriedTo;
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

/** The instance turned down one printer or its nozzle (it doesn't know it), rather than the request failing. */
const printerRefused = (err: unknown) => err instanceof ApiError && (err.status === 404 || err.status === 400);

/**
 * Grab's own picks, to the account connected now: its slicers where the account has picked none, and its printers
 * where it had none when they first went. Every request goes to that account, should the connection change meanwhile.
 * What has gone is written down as it goes, so a failure leaves only the rest to try on the next connection, and
 * nothing is sent twice: what the user removed there since isn't brought back.
 */
async function carry(): Promise<void> {
  const config = await getStoredConfig();
  if (!isConfigured(config)) return;
  const account = `${config.instanceUrl}|${config.email}`;
  const stored = carriedOf(config)[account];
  const carried: Carried = { settled: [...(stored?.settled ?? [])], printersSent: stored?.printersSent };
  const save = async () => {
    const all = carriedOf(await getStoredConfig());
    await chrome.storage.local.set({ [STORAGE_KEYS.adaptCarriedTo]: { ...all, [account]: carried } });
  };
  const settle = async (section: CarrySection) => {
    carried.settled.push(section);
    await save();
  };
  const own = adaptSettingsOf(config);
  try {
    if (!carried.settled.includes("slicers")) {
      // Slicers an older Grab doesn't know are still the user's picks.
      if (own.slicers.length && !pickedSlicers(await slicerSettings(config)).length) {
        // `slicer` too, for an instance from before there were several.
        await apiCall("PATCH", "/settings/slicer", { slicer: own.slicers[0], slicers: own.slicers }, config);
      }
      await settle("slicers");
    }
    if (!carried.settled.includes("printers")) {
      const there = await thingportPrinters(config);
      // An instance from before printers: they go once it has them.
      if (there === null) return;
      // Begun on an earlier connection, when the account had none: the rest of them, as its own may be among them now.
      if (own.printers.length && (carried.printersSent || !there.length)) {
        const present = new Set(there.map((printer) => printer.id));
        const sent = new Set(carried.printersSent ?? []);
        carried.printersSent = [...sent];
        await save();
        for (const { id, nozzle } of own.printers) {
          if (present.has(id) || sent.has(id)) continue;
          // One it doesn't know is left out; anything else stops here, to be tried again.
          await apiCall("PUT", `/me/printers/${encodeURIComponent(id)}`, { nozzle }, config).catch((err: unknown) => {
            if (!printerRefused(err)) throw err;
          });
          sent.add(id);
          carried.printersSent = [...sent];
          await save();
        }
      }
      await settle("printers");
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
