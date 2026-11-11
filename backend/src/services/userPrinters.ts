// The printers a user prints on (Configuration > Printers), from the printer catalogue: adapted copies can be made
// for them (src/adapter/printer.ts). Suggestions come from the user's own library: the printer each of their prints
// was sliced for, and the one each 3MF project names. Their Bambu account's printers are read only when they ask.

import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  printerBrands,
  printerForName,
  printersForBambuCode,
  printerSummary,
  type PrinterSummary,
} from "../printers/catalogue";
import { printerPresetNames } from "../printers/targets";
import { extractMakerworldBearerToken, fetchBoundPrinters } from "../providers/makerworld/api";
import {
  getMakerworldConnection,
  getUserMakerworldCookie,
  markMakerworldCookieRejected,
} from "../providers/makerworld/session";
import { SLICER_IDS } from "./slicerPreferenceService";

export type UserPrinterView = {
  printer: PrinterSummary;
  /** The brand's name, "Bambu Lab". */
  brandName: string;
  nozzle: string;
  /** Each slicer's printer preset for it and its nozzle, null where the slicer has none. */
  presets: Record<string, string | null>;
};

export type PrinterSuggestion = {
  printer: PrinterSummary;
  brandName: string;
  nozzle: string | null;
  /** How many of the user's prints were sliced for it, and how many of their 3MF projects name it. */
  sliced: number;
  projects: number;
  declined: boolean;
};

const SLICERS = SLICER_IDS.filter((id) => id !== "other");

let brandNames: Map<string, string> | null = null;
function brandName(id: string): string {
  brandNames ??= new Map(printerBrands().map((brand) => [brand.id, brand.name]));
  return brandNames.get(id) ?? id;
}

/** The nozzle as the printer has it: `wanted` when it's one of its nozzles, else the nearest, else its first. */
function fitNozzle(summary: PrinterSummary, wanted: string | number | null | undefined): string {
  const nozzles = summary.nozzles.length ? summary.nozzles : ["0.4"];
  const n = Number(wanted);
  if (!Number.isFinite(n) || n <= 0) return nozzles.includes("0.4") ? "0.4" : nozzles[0];
  const exact = nozzles.find((x) => Math.abs(Number(x) - n) < 1e-6);
  if (exact) return exact;
  return nozzles.toSorted((a, b) => Math.abs(Number(a) - n) - Math.abs(Number(b) - n))[0];
}

function view(summary: PrinterSummary, nozzle: string): UserPrinterView {
  return {
    printer: summary,
    brandName: brandName(summary.brand),
    nozzle,
    presets: printerPresetNames(summary.id, nozzle, SLICERS),
  };
}

/** The user's printers, oldest first; one the catalogue no longer has is left out. */
export async function listUserPrinters(userId: string): Promise<UserPrinterView[]> {
  const rows = await prisma.userPrinter.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.flatMap((row) => {
    const summary = printerSummary(row.printerId);
    return summary ? [view(summary, row.nozzle)] : [];
  });
}

export class UnknownPrinterError extends Error {}

/** Adds the printer, or sets its nozzle when it's already theirs. A nozzle it doesn't take becomes its nearest. */
export async function putUserPrinter(
  userId: string,
  printerId: string,
  nozzle?: string | null,
): Promise<UserPrinterView> {
  const summary = printerSummary(printerId);
  if (!summary) throw new UnknownPrinterError(printerId);
  const existing = await prisma.userPrinter.findUnique({ where: { userId_printerId: { userId, printerId } } });
  const fitted = fitNozzle(summary, nozzle ?? existing?.nozzle);
  await prisma.userPrinter.upsert({
    where: { userId_printerId: { userId, printerId } },
    create: { userId, printerId, nozzle: fitted },
    update: { nozzle: fitted },
  });
  return view(summary, fitted);
}

/** Removes the printer and makes the slicers that made copies for it ask again. */
export async function removeUserPrinter(userId: string, printerId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    await tx.userPrinter.deleteMany({ where: { userId, printerId } });
    const user = await tx.user.findUnique({ where: { id: userId }, select: { slicerPrinters: true } });
    const map = user?.slicerPrinters;
    if (!map || typeof map !== "object" || Array.isArray(map)) return;
    const kept = Object.fromEntries(Object.entries(map).filter(([, value]) => value !== printerId));
    await tx.user.update({ where: { id: userId }, data: { slicerPrinters: kept } });
  });
}

/** Turns a suggestion down (it stays shown, as declined), or takes that back. */
export async function setPrinterDeclined(userId: string, printerId: string, declined: boolean): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { declinedPrinters: true } });
    const list = new Set(user?.declinedPrinters ?? []);
    if (declined) list.add(printerId);
    else list.delete(printerId);
    await tx.user.update({ where: { id: userId }, data: { declinedPrinters: [...list].toSorted() } });
  });
}

// A sliced print names the printer it's for, so one is enough; a project names its designer's printer, which is the
// user's only if they made it, so a few are wanted before it's suggested.
const PROJECTS_TO_SUGGEST = 2;
const MAX_SUGGESTIONS = 8;

type NameCount = { name: string | null; nozzle: string | null; count: bigint | number };

/** Printers the user's library points at that aren't theirs yet: those their prints were sliced for first. */
export async function printerSuggestions(userId: string): Promise<PrinterSuggestion[]> {
  const [mine, user, sliced, projects] = await Promise.all([
    prisma.userPrinter.findMany({ where: { userId }, select: { printerId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { declinedPrinters: true } }),
    prisma.$queryRaw<NameCount[]>(Prisma.sql`
      SELECT "preparedMetadata"->>'printer' AS name, NULL AS nozzle, count(*) AS count
      FROM "Print" WHERE "userId" = ${userId} AND "preparedMetadata"->>'printer' IS NOT NULL
      GROUP BY 1`),
    prisma.$queryRaw<NameCount[]>(Prisma.sql`
      SELECT p.format->>'printer' AS name, p.format->>'nozzle' AS nozzle, count(*) AS count
      FROM "Plate" p JOIN "Print" pr ON pr.id = p."printId"
      WHERE pr."userId" = ${userId} AND p.format->>'kind' = 'bambu' AND p.format->>'printer' IS NOT NULL
      GROUP BY 1, 2`),
  ]);
  const owned = new Set(mine.map((row) => row.printerId));
  const declined = new Set(user?.declinedPrinters ?? []);
  const found = new Map<
    string,
    { summary: PrinterSummary; sliced: number; projects: number; nozzles: Map<string, number> }
  >();
  const count = (rows: NameCount[], field: "sliced" | "projects") => {
    for (const row of rows) {
      const hit = printerForName(row.name);
      if (!hit || owned.has(hit.printer.id)) continue;
      const entry = found.get(hit.printer.id) ?? { summary: hit.printer, sliced: 0, projects: 0, nozzles: new Map() };
      const n = Number(row.count);
      entry[field] += n;
      const nozzle = hit.nozzle ?? row.nozzle;
      if (nozzle) entry.nozzles.set(String(nozzle), (entry.nozzles.get(String(nozzle)) ?? 0) + n);
      found.set(hit.printer.id, entry);
    }
  };
  count(sliced, "sliced");
  count(projects, "projects");
  return [...found.values()]
    .filter((e) => e.sliced > 0 || e.projects >= PROJECTS_TO_SUGGEST)
    .toSorted((a, b) => b.sliced - a.sliced || b.projects - a.projects || a.summary.id.localeCompare(b.summary.id))
    .slice(0, MAX_SUGGESTIONS)
    .map((e) => {
      const nozzle = [...e.nozzles].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        printer: e.summary,
        brandName: brandName(e.summary.brand),
        nozzle: nozzle ? fitNozzle(e.summary, nozzle) : null,
        sliced: e.sliced,
        projects: e.projects,
        declined: declined.has(e.summary.id),
      };
    });
}

/** Whether to offer finding their printers in their Bambu account: signed in to MakerWorld, which is that account,
 *  and with no printer chosen yet. */
export async function offersBambuAccount(userId: string, printers: number): Promise<boolean> {
  return printers === 0 && (await getMakerworldConnection(userId)) === "connected";
}

export class BambuAccountError extends Error {
  constructor(readonly reason: "signed-out" | "rejected" | "unavailable") {
    super(reason);
  }
}

/** Adds the printers bound to the user's Bambu account (those the catalogue knows) and returns them, ones they had
 *  already among them. Nothing about a printer but its model and nozzle is read. */
export async function addBambuAccountPrinters(userId: string): Promise<UserPrinterView[]> {
  const cookie = await getUserMakerworldCookie(userId);
  const token = extractMakerworldBearerToken(cookie);
  if (!cookie || !token) throw new BambuAccountError("signed-out");
  const bound = await fetchBoundPrinters(token);
  if (bound === "rejected") {
    await markMakerworldCookieRejected(userId, cookie);
    throw new BambuAccountError("rejected");
  }
  if (!bound) throw new BambuAccountError("unavailable");
  const added = new Map<string, UserPrinterView>();
  for (const device of bound) {
    const summary =
      printersForBambuCode(device.model)[0] ??
      (device.product ? printerForName(`Bambu Lab ${device.product}`)?.printer : undefined);
    if (!summary || added.has(summary.id)) continue;
    const existing = await prisma.userPrinter.findUnique({
      where: { userId_printerId: { userId, printerId: summary.id } },
    });
    added.set(
      summary.id,
      existing ? view(summary, existing.nozzle) : await putUserPrinter(userId, summary.id, String(device.nozzle ?? "")),
    );
  }
  return [...added.values()];
}
