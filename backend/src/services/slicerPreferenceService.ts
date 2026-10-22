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
  "other",
] as const;
export type SlicerId = (typeof SLICER_IDS)[number];

/** `slicer` is the one a model's main button opens (the last one used), `slicers` the ones installed. */
export type SlicerSettings = { slicer: SlicerId | null; slicers: SlicerId[] };

function isSlicerId(value: string): value is SlicerId {
  return (SLICER_IDS as readonly string[]).includes(value);
}

/** Keeps `slicer` one of `slicers`: a new current slicer joins the list, and dropping the current one moves to
 *  the first left. Ordered as SLICER_IDS, so the menu doesn't reshuffle. */
function normalize(slicer: string | null, slicers: string[]): SlicerSettings {
  const current = slicer && isSlicerId(slicer) ? slicer : null;
  const installed = new Set(slicers.filter(isSlicerId));
  if (current) installed.add(current);
  const list = SLICER_IDS.filter((id) => installed.has(id));
  return { slicer: current ?? list[0] ?? null, slicers: list };
}

export async function getUserSlicerSettings(userId: string): Promise<SlicerSettings> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { slicer: true, slicers: true } });
  return normalize(user?.slicer ?? null, user?.slicers ?? []);
}

/** A field left undefined keeps its value. A `slicers` list without the current slicer moves it to the first
 *  one left, unless the same call names a new current one. */
export async function setUserSlicerSettings(
  userId: string,
  patch: { slicer?: string | null; slicers?: string[] },
): Promise<SlicerSettings> {
  // Locks the user's row, so two changes at once (two tabs, two devices) can't each undo the other's.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { slicer: true, slicers: true } });
    const existing = normalize(user?.slicer ?? null, user?.slicers ?? []);
    const slicers = patch.slicers ?? existing.slicers;
    let slicer = patch.slicer !== undefined ? patch.slicer : existing.slicer;
    if (patch.slicer === undefined && slicer && !slicers.includes(slicer as SlicerId)) slicer = null;
    const next = normalize(slicer, slicers);
    await tx.user.update({ where: { id: userId }, data: next });
    return next;
  });
}
