// LICENSE.txt beside a model's files: who made it, where it's from, its licence and what that allows, and the line
// to credit it with. A real file, so it's there in any copy of the folder, over a network share and in the storage
// browser. It's a PrintFile of its own role, so the storage move, deleting and merging take it along like any file;
// only Thingport writes it, from the model's licence, and it's never listed as one of the model's own files.

import fs from "node:fs/promises";
import path from "node:path";
import { Prisma, type Print } from "@prisma/client";
import { STORAGE } from "../config";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { withStorageLock } from "../utils/storageLock";
import { buildImportSourceUrl } from "./importService";
import { licenseOut, providerName, storedLicense, type LicenseOut } from "./licenseService";
import { managedPrintFilePath } from "./printFileService";
import { pruneEmptyStorageDirs, renderPrintFileStoragePath } from "./printService";
import { getLicenseFiles } from "./settingsService";

const log = createLogger("license-file");

export const LICENSE_FILENAME = "LICENSE.txt";

type LicensedPrint = Pick<
  Print,
  "title" | "name" | "creator" | "sourceProvider" | "sourceExternalId" | "license" | "licenseReadAt"
>;

const ACTION_WORDS: Record<string, string> = {
  share: "share the files as they are",
  remix: "change it",
  commercial: "use it commercially, selling prints included",
};

function sentence(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The credit line the licence asks for, or one that's good manners where it doesn't. */
export function creditLine(print: LicensedPrint, license: LicenseOut | null): string {
  const title = print.title?.trim() || print.name;
  const by = print.creator?.trim() ? ` by ${print.creator.trim()}` : "";
  const source = buildImportSourceUrl(print.sourceProvider, print.sourceExternalId);
  const from = source ? ` (${source})` : "";
  const under = license ? ` is licensed under ${license.short}` : "";
  return `"${title}"${by}${from}${under}.`;
}

/** What LICENSE.txt says; null for a model with no licence. */
export function licenseFileText(print: LicensedPrint): string | null {
  const license = licenseOut(print);
  if (!license) return null;
  const stored = storedLicense(print.license);
  const site = providerName(stored?.provider ?? print.sourceProvider);
  const source = buildImportSourceUrl(print.sourceProvider, print.sourceExternalId);
  const lines: string[] = [print.title?.trim() || print.name];
  if (print.creator?.trim()) lines.push(`by ${print.creator.trim()}`);
  if (source) lines.push(`Source: ${source}`);
  lines.push("", `Licence: ${license.name}${license.short !== license.name ? ` (${license.short})` : ""}`);
  if (license.url) lines.push(license.url);

  if (license.family) {
    const not = ["share", "remix", "commercial"].filter((action) => !license.allows.includes(action as never));
    const must = [
      ...(license.requires.credit ? ["credit the creator and link the source"] : []),
      ...(license.requires.same_license && license.allows.includes("remix")
        ? ["share what you make from it under the same licence"]
        : []),
    ];
    lines.push("");
    if (license.allows.length) lines.push(`You may: ${sentence(license.allows.map((a) => ACTION_WORDS[a]))}.`);
    if (must.length) lines.push(`You must: ${sentence(must)}.`);
    if (not.length) lines.push(`You may not: ${sentence(not.map((a) => ACTION_WORDS[a]))}.`);
  }
  // Added to a standard licence by the site or its creator; a site's own licence is its terms.
  const added = license.source === "provider" && site && (license.family === "cc" || license.family === "open");
  if (license.terms) lines.push("", added ? `${site} adds:` : "Terms:", license.terms);
  lines.push("", "Credit line:", creditLine(print, license));

  const day = (print.licenseReadAt ?? new Date()).toISOString().slice(0, 10);
  lines.push(
    "",
    license.source === "user" || !site
      ? `Written by Thingport on ${day} from the licence the model's owner chose.`
      : `Written by Thingport on ${day} from what ${site} lists for this model.`,
    license.url ? "The licence's own text, at the link above, is what applies." : "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

// One write at a time per model, so a fill and an edit landing together don't both create one.
const writing = new Map<string, Promise<void>>();

/** Writes, rewrites or removes the model's LICENSE.txt to match its licence and the admin setting. */
export function syncLicenseFile(printId: string): Promise<void> {
  const next = (writing.get(printId) ?? Promise.resolve()).then(() => syncNow(printId));
  const settled = next.catch(() => undefined);
  writing.set(printId, settled);
  void settled.then(() => {
    if (writing.get(printId) === settled) writing.delete(printId);
  });
  return next;
}

async function syncNow(printId: string): Promise<void> {
  const print = await prisma.print.findUnique({
    where: { id: printId },
    include: { files: { where: { role: "LICENSE" } } },
  });
  if (!print) return;
  const [current, ...extra] = print.files;
  const text = (await getLicenseFiles()) ? licenseFileText(print) : null;
  for (const file of text ? extra : print.files) await removeLicenseFile(file);
  if (!text) return;

  const body = Buffer.from(text, "utf8");
  if (current) {
    const existing = await fs.readFile(managedPrintFilePath(current)).catch(() => null);
    if (existing?.equals(body)) return;
    await writeAtomically(managedPrintFilePath(current), body);
    await prisma.printFile.update({
      where: { id: current.id },
      data: { size: body.length, contentSha256: null, reuseIno: null, reuseCtimeNs: null },
    });
    return;
  }
  const storagePath = await renderPrintFileStoragePath(print, LICENSE_FILENAME);
  let created;
  try {
    created = await prisma.printFile.create({
      data: {
        printId: print.id,
        role: "LICENSE",
        filename: LICENSE_FILENAME,
        mime: "text/plain",
        size: body.length,
        storagePath,
      },
    });
  } catch (err) {
    // Another file took the path in the meantime: the next change writes it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
  try {
    await writeAtomically(path.join(STORAGE, storagePath), body);
  } catch (err) {
    await prisma.printFile.delete({ where: { id: created.id } }).catch(() => undefined);
    throw err;
  }
}

async function writeAtomically(destination: string, body: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temp, body);
  try {
    await withStorageLock(() => fs.rename(temp, destination));
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function removeLicenseFile(file: { id: string; storagePath: string }): Promise<void> {
  await prisma.printFile.delete({ where: { id: file.id } }).catch(() => undefined);
  const filePath = managedPrintFilePath(file);
  await fs.rm(filePath, { force: true }).catch(() => undefined);
  await pruneEmptyStorageDirs(path.dirname(filePath)).catch(() => undefined);
}

let sweeping: Promise<void> | null = null;

/** After the admin setting changes: writes LICENSE.txt for every model with a licence, or removes them all. Local
 *  files only; nothing is asked of any site. */
export function syncAllLicenseFiles(): Promise<void> {
  if (sweeping) return sweeping.then(() => syncAllLicenseFiles());
  sweeping = (async () => {
    const prints = await prisma.print.findMany({
      where: { OR: [{ license: { not: Prisma.DbNull } }, { files: { some: { role: "LICENSE" } } }] },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    for (const { id } of prints) {
      await syncLicenseFile(id).catch((err) => log.warn("couldn't sync LICENSE.txt", { print: id, err }));
    }
  })().finally(() => {
    sweeping = null;
  });
  return sweeping;
}
