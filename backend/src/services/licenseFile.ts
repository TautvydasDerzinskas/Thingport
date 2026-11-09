// LICENSE.txt beside a model's files: who made it, where it's from, its licence and what that allows, and the line
// to credit it with. A real file, so it's there in any copy of the folder, over a network share and in the storage
// browser. It's a PrintFile of its own role, so the storage move, deleting and merging take it along like any file;
// only Thingport writes it, from the model's licence, and it's never listed as one of the model's own files.

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Prisma, type Author, type Print, type PrintFile } from "@prisma/client";
import { prisma } from "../db";
import { createLogger } from "../logger";
import { withStorageLock } from "../utils/storageLock";
import { buildImportSourceUrl } from "./importService";
import { licenseOut, providerName, storedLicense, type LicenseOut } from "./licenseService";
import { managedPrintFilePath } from "./printFileService";
import { printFilePathFree, pruneEmptyStorageDirs, renderPrintFileStoragePath } from "./printService";
import { getLicenseFiles } from "./settingsService";

const log = createLogger("license-file");

export const LICENSE_FILENAME = "LICENSE.txt";

export type LicensedPrint = Pick<
  Print,
  "title" | "name" | "creator" | "sourceProvider" | "sourceExternalId" | "license" | "licenseReadAt"
> & { author?: Pick<Author, "name" | "handle"> | null };

const ACTION_WORDS: Record<string, string> = {
  share: "share the files as they are",
  remix: "change it",
  commercial: "use it commercially, selling prints included",
};

/** Who made it, named as the model page names them. */
function madeBy(print: LicensedPrint): string | null {
  return print.author?.name?.trim() || print.author?.handle?.trim() || print.creator?.trim() || null;
}

function sentence(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The credit line the licence asks for, or one that's good manners where it doesn't. */
export function creditLine(print: LicensedPrint, license: LicenseOut | null): string {
  const title = print.title?.trim() || print.name;
  const maker = madeBy(print);
  const by = maker ? ` by ${maker}` : "";
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
  const maker = madeBy(print);
  if (maker) lines.push(`by ${maker}`);
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

// Under the storage lock, rows read inside it: a storage move renames files and saves their new paths under it, so a
// path read before it could be one the file has just left.
function syncNow(printId: string): Promise<void> {
  return withStorageLock(async () => {
    const print = await prisma.print.findUnique({
      where: { id: printId },
      include: { author: { select: { name: true, handle: true } }, files: { where: { role: "LICENSE" } } },
    });
    if (!print) return;
    // The one at LICENSE.txt itself first: a merge brings the other models' along, renamed beside it.
    const [current, ...extra] = print.files.toSorted(
      (a, b) => Number(!isCanonical(a)) - Number(!isCanonical(b)) || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const text = (await getLicenseFiles()) ? licenseFileText(print) : null;
    for (const file of text ? extra : print.files) await removeLicenseFile(file);
    if (!text) return;

    const body = Buffer.from(text, "utf8");
    if (current) await rewrite(current, body);
    else await create(print, body);
  });
}

const isCanonical = (file: Pick<PrintFile, "storagePath">) => path.basename(file.storagePath) === LICENSE_FILENAME;

async function rewrite(found: PrintFile, body: Buffer): Promise<void> {
  const file = isCanonical(found) ? found : await backToCanonical(found);
  const destination = managedPrintFilePath(file);
  const existing = await fs.readFile(destination).catch(() => null);
  const same = existing?.equals(body) ?? false;
  if (!same) await writeAtomically(destination, body);
  // Also when the bytes are already right: a write whose row update failed left the row saying what was there before.
  const sha = crypto.createHash("sha256").update(body).digest("hex");
  const stale = !same || file.size !== body.length || (file.contentSha256 !== null && file.contentSha256 !== sha);
  if (!stale) return;
  await prisma.printFile.update({
    where: { id: file.id },
    data: { size: body.length, contentSha256: null, reuseIno: null, reuseCtimeNs: null },
  });
}

/** A LICENSE.txt numbered aside because another file had the name, moved back once the name is free. */
async function backToCanonical(file: PrintFile): Promise<PrintFile> {
  const wanted = path.join(path.dirname(file.storagePath), LICENSE_FILENAME);
  if (!(await printFilePathFree(wanted, file.id))) return file;
  const from = managedPrintFilePath(file);
  const to = managedPrintFilePath({ storagePath: wanted });
  // One that's gone is written at the new place.
  const moved = await fs.rename(from, to).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return false;
      throw err;
    },
  );
  try {
    return await prisma.printFile.update({ where: { id: file.id }, data: { storagePath: wanted } });
  } catch (err) {
    if (moved) await fs.rename(to, from).catch(() => undefined);
    throw err;
  }
}

async function create(print: Print, body: Buffer): Promise<void> {
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
    await writeAtomically(managedPrintFilePath(created), body);
  } catch (err) {
    await prisma.printFile.delete({ where: { id: created.id } }).catch(() => undefined);
    throw err;
  }
}

async function writeAtomically(destination: string, body: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, body);
    await fs.rename(temp, destination);
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** The file first, then its row: either failing throws, and the row left behind is removed by the next sync. */
async function removeLicenseFile(file: PrintFile): Promise<void> {
  const filePath = managedPrintFilePath(file);
  await fs.rm(filePath, { force: true });
  await prisma.printFile.deleteMany({ where: { id: file.id } });
  await pruneEmptyStorageDirs(path.dirname(filePath)).catch(() => undefined);
}

/** After an author's name or handle changes, or models are linked to it: LICENSE.txt names it, whoever's models they
 *  are. */
export async function syncAuthorLicenseFiles(authorId: string): Promise<void> {
  const prints = await prisma.print.findMany({
    where: { authorId, OR: [{ license: { not: Prisma.DbNull } }, { files: { some: { role: "LICENSE" } } }] },
    select: { id: true },
  });
  for (const { id } of prints) {
    await syncLicenseFile(id).catch((err) => log.warn("couldn't sync LICENSE.txt", { print: id, err }));
  }
}

let sweeping: Promise<void> | null = null;
let waiting: Promise<void> | null = null;

/** After the admin setting is saved: writes LICENSE.txt for every model with a licence, or removes them all. Local
 *  files only; nothing is asked of any site. Never rejects: it runs in the background. One runs at a time, and at most
 *  one waits, as a sweep that starts after a save covers it. */
export function syncAllLicenseFiles(): Promise<void> {
  if (sweeping) {
    waiting ??= sweeping.then(() => {
      waiting = null;
      return syncAllLicenseFiles();
    });
    return waiting;
  }
  sweeping = sweep().finally(() => {
    sweeping = null;
  });
  return sweeping;
}

async function sweep(): Promise<void> {
  try {
    const prints = await prisma.print.findMany({
      where: { OR: [{ license: { not: Prisma.DbNull } }, { files: { some: { role: "LICENSE" } } }] },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    for (const { id } of prints) {
      await syncLicenseFile(id).catch((err) => log.warn("couldn't sync LICENSE.txt", { print: id, err }));
    }
  } catch (err) {
    log.warn("couldn't bring LICENSE.txt files in line", { err });
  }
}
