import { prisma } from "../db";

// Some route through the Thingport Bridge instead of their own protocol (see the frontend's
// utils/slicerLaunch.ts). Anything else is "other".
export const SLICER_IDS = [
  "bambustudio",
  "orcaslicer",
  "prusaslicer",
  "cura",
  "crealityprintlink",
  "anycubicslicernext",
  "elegooslicer",
  "snapmaker-orca",
  "eufystudio3d",
  "other",
] as const;
export type SlicerId = (typeof SLICER_IDS)[number];

// Those that download a link themselves, through a protocol of their own. Each can go through the Bridge instead, for
// when it can't download from this instance (a certificate it doesn't trust, say); the others always do.
export const BRIDGEABLE_SLICER_IDS = [
  "orcaslicer",
  "crealityprintlink",
  "elegooslicer",
  "snapmaker-orca",
  "eufystudio3d",
] as const satisfies readonly SlicerId[];

/** `slicer` is the one a model's main button opens (the last one used), `slicers` the ones installed, `bridged` those
 *  of BRIDGEABLE_SLICER_IDS opened through the Bridge, installed or not. `unadapted` open a model's file as it is,
 *  never an adapted copy, and `printers` is the printer (a catalogue id of one of the user's) each slicer's adapted
 *  copies are made for; a slicer not in it asks. */
export type SlicerSettings = {
  slicer: SlicerId | null;
  slicers: SlicerId[];
  bridged: SlicerId[];
  unadapted: SlicerId[];
  printers: Partial<Record<SlicerId, string>>;
};

function isSlicerId(value: string): value is SlicerId {
  return (SLICER_IDS as readonly string[]).includes(value);
}

function bridgedList(ids: string[]): SlicerId[] {
  const chosen = new Set(ids);
  return BRIDGEABLE_SLICER_IDS.filter((id) => chosen.has(id));
}

function printersMap(value: unknown): Partial<Record<SlicerId, string>> {
  const out: Partial<Record<SlicerId, string>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const id of SLICER_IDS) {
    const printer = (value as Record<string, unknown>)[id];
    if (typeof printer === "string" && printer) out[id] = printer;
  }
  return out;
}

type Stored = {
  slicer: string | null;
  slicers: string[];
  bridgedSlicers: string[];
  unadaptedSlicers: string[];
  slicerPrinters: unknown;
};

/** Keeps `slicer` one of `slicers`: a new current slicer joins the list, and dropping the current one moves to
 *  the first left. Ordered as SLICER_IDS, so the menu doesn't reshuffle. */
function normalize(stored: Stored): SlicerSettings {
  const current = stored.slicer && isSlicerId(stored.slicer) ? stored.slicer : null;
  const installed = new Set(stored.slicers.filter(isSlicerId));
  if (current) installed.add(current);
  const list = SLICER_IDS.filter((id) => installed.has(id));
  const unadapted = new Set(stored.unadaptedSlicers);
  return {
    slicer: current ?? list[0] ?? null,
    slicers: list,
    bridged: bridgedList(stored.bridgedSlicers),
    unadapted: SLICER_IDS.filter((id) => unadapted.has(id)),
    printers: printersMap(stored.slicerPrinters),
  };
}

const SELECT = {
  slicer: true,
  slicers: true,
  bridgedSlicers: true,
  unadaptedSlicers: true,
  slicerPrinters: true,
} as const;

const NONE: Stored = { slicer: null, slicers: [], bridgedSlicers: [], unadaptedSlicers: [], slicerPrinters: null };

export async function getUserSlicerSettings(userId: string): Promise<SlicerSettings> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: SELECT });
  return normalize(user ?? NONE);
}

/** Thrown for a printer that isn't one of the user's. */
export class NotYourPrinterError extends Error {}

/** A field left undefined keeps its value. `enable` and `disable` switch one slicer on or off in the list as it is
 *  now, so two devices switching different slicers both count; `slicers` replaces the whole list. A list without the
 *  current slicer moves it to the first one left, unless the same call names a new current one. `bridge` and
 *  `unbridge` likewise send one of BRIDGEABLE_SLICER_IDS through the Bridge or back to its own protocol; `adapt` and
 *  `unadapt` switch a slicer's "Open adapted" on or off. `printer` sets the printer a slicer's copies are made for, one
 *  of the user's printers, or with null makes it ask. */
export async function setUserSlicerSettings(
  userId: string,
  patch: {
    slicer?: string | null;
    slicers?: string[];
    enable?: string;
    disable?: string;
    bridge?: string;
    unbridge?: string;
    adapt?: string;
    unadapt?: string;
    printer?: { slicer: string; printer: string | null };
  },
): Promise<SlicerSettings> {
  // The row lock makes changes that arrive at once apply one after the other, each to the other's result.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: SELECT });
    const existing = normalize(user ?? NONE);
    let slicers: string[] = patch.slicers ?? existing.slicers;
    if (patch.enable) slicers = [...slicers, patch.enable];
    if (patch.disable) slicers = slicers.filter((id) => id !== patch.disable);
    let slicer = patch.slicer !== undefined ? patch.slicer : existing.slicer;
    if (patch.slicer === undefined && slicer && !slicers.includes(slicer)) slicer = null;
    let bridged: string[] = existing.bridged;
    if (patch.bridge) bridged = [...bridged, patch.bridge];
    if (patch.unbridge) bridged = bridged.filter((id) => id !== patch.unbridge);
    let unadapted: string[] = existing.unadapted;
    if (patch.unadapt) unadapted = [...unadapted, patch.unadapt];
    if (patch.adapt) unadapted = unadapted.filter((id) => id !== patch.adapt);
    const printers: Record<string, string> = { ...existing.printers };
    if (patch.printer && isSlicerId(patch.printer.slicer)) {
      const chosen = patch.printer.printer;
      if (chosen) {
        const owned = await tx.userPrinter.findUnique({ where: { userId_printerId: { userId, printerId: chosen } } });
        if (!owned) throw new NotYourPrinterError(chosen);
        printers[patch.printer.slicer] = chosen;
      } else delete printers[patch.printer.slicer];
    }
    const next = normalize({
      slicer,
      slicers,
      bridgedSlicers: bridged,
      unadaptedSlicers: unadapted,
      slicerPrinters: printers,
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        slicer: next.slicer,
        slicers: next.slicers,
        bridgedSlicers: next.bridged,
        unadaptedSlicers: next.unadapted,
        slicerPrinters: next.printers,
      },
    });
    return next;
  });
}
