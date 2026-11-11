// Which kind of 3MF a plate is (src/adapter/format.ts), read from its small files when it's stored and kept on the
// plate, so a model page knows which slicers want an adapted copy without opening anything.

import path from "node:path";
import { Prisma, type Plate } from "@prisma/client";
import { prisma } from "../db";
import { classify3mf, storedFormat, type ThreeMfFormat } from "../adapter";
import { listZipEntries, readZipEntry, readZipEntryHead } from "../utils/zipReader";

const SMALL_FILE_LIMIT = 16 * 1024 * 1024;
// Far more than the Application and OrcaSlicer tags at the top of a model file take.
const MODEL_HEAD_BYTES = 64 * 1024;

export function isThreeMfFile(filename: string): boolean {
  return path.extname(filename).toLowerCase() === ".3mf";
}

/** What kind of 3MF the file at `filePath` is, or null for one that isn't a zip. */
export async function readThreeMfFormat(filePath: string): Promise<ThreeMfFormat | null> {
  let entries: string[];
  try {
    entries = (await listZipEntries(filePath)).filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  } catch {
    return null;
  }
  const named = (name: string) => entries.find((entry) => entry.toLowerCase() === name) ?? null;
  const read = async (name: string): Promise<string | null> => {
    const entry = named(name);
    if (!entry) return null;
    const buf = await readZipEntry(filePath, entry, SMALL_FILE_LIMIT).catch(() => null);
    return buf ? buf.toString("utf-8") : null;
  };
  const root = named("3d/3dmodel.model");
  const head = root ? await readZipEntryHead(filePath, root, MODEL_HEAD_BYTES).catch(() => null) : null;
  const [projectSettings, modelSettings, prusaConfig] = await Promise.all([
    read("metadata/project_settings.config"),
    read("metadata/model_settings.config"),
    read("metadata/slic3r_pe.config"),
  ]);
  return classify3mf({
    entries,
    modelHead: head ? head.toString("utf-8") : null,
    projectSettings,
    modelSettings,
    prusaConfig,
  });
}

/** Reads and keeps the plate's format. Never throws: a format it can't read is left for the next look. */
export async function storePlateFormat(
  plateId: string,
  filename: string,
  filePath: string,
): Promise<ThreeMfFormat | null> {
  if (!isThreeMfFile(filename)) return null;
  try {
    const format = await readThreeMfFormat(filePath);
    if (!format) return null;
    await prisma.plate.update({ where: { id: plateId }, data: { format: format as unknown as Prisma.InputJsonValue } });
    return format;
  } catch (err) {
    console.warn(`Reading the 3MF format of plate ${plateId} failed:`, err);
    return null;
  }
}

/** The plate's format as stored, when it's from the current classification. */
export function plateFormatOf(plate: Pick<Plate, "format">): ThreeMfFormat | null {
  return storedFormat(plate.format);
}

// Each is a few small reads, but a model can have dozens of files; the rest are read on its next open.
const FILL_PER_REQUEST = 40;

/** Reads the formats of the plates `where` finds that have none yet: 3MFs stored before formats were. */
export async function fillPlateFormats(
  where: Prisma.PlateWhereInput,
  resolveFile: (plate: Pick<Plate, "storagePath" | "sourcePath">) => string | null,
): Promise<void> {
  const plates = await prisma.plate.findMany({
    where,
    select: { id: true, filename: true, format: true, storagePath: true, sourcePath: true },
  });
  const missing = plates.filter((plate) => isThreeMfFile(plate.filename) && !plateFormatOf(plate));
  for (const plate of missing.slice(0, FILL_PER_REQUEST)) {
    const filePath = resolveFile(plate);
    if (filePath) await storePlateFormat(plate.id, plate.filename, filePath);
  }
}

/** The plate's format, read and kept first for one stored before formats were (or by an older classification). */
export async function ensurePlateFormat(
  plate: Pick<Plate, "id" | "filename" | "format">,
  filePath: string,
): Promise<ThreeMfFormat | null> {
  return plateFormatOf(plate) ?? (await storePlateFormat(plate.id, plate.filename, filePath));
}
