// Which kind of 3MF a plate is (src/adapter/format.ts), read from its small files when it's stored and kept on the
// plate, so a model page knows which slicers want an adapted copy without opening anything.

import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { Prisma, type Plate } from "@prisma/client";
import { prisma } from "../db";
import { classify3mf, storedFormat, type PlainModelScan, type ThreeMfFormat } from "../adapter";
import { listZipEntries, readZipEntry, readZipEntryHead, walkZipEntries } from "../utils/zipReader";

const SMALL_FILE_LIMIT = 16 * 1024 * 1024;
// Far more than the Application and OrcaSlicer tags at the top of a model file take.
const MODEL_HEAD_BYTES = 64 * 1024;

// A plain 3MF's colours can be anywhere in its models, after meshes; past this much it's left uncounted.
const PLAIN_SCAN_BYTES = 512 * 1024 * 1024;
const COLOUR_RE = /<(?:[\w-]+:)?(?:color\b[^>]*?\bcolor|base\b[^>]*?\bdisplaycolor)\s*=\s*"#?([0-9a-f]{6})/gi;
const TRIANGLE_RE = /<(?:[\w-]+:)?triangle\b[^>]*>/gi;
const PAINT_RE = /\b(?:slic3rpe:mmu_segmentation|paint_color)\s*=\s*"[0-9a-f]/i;

/** A plain 3MF's models read through once, the root's and those its objects come from: how many colours they define,
 *  and whether every triangle is painted. Null for one too big to read through. */
async function scanPlainModel(filePath: string): Promise<PlainModelScan | null> {
  const colours = new Set<string>();
  let triangles = 0;
  let painted = 0;
  let read = 0;
  let tooBig = false;
  await walkZipEntries(
    filePath,
    (entry) => /\.model$/i.test(entry.name),
    async (_entry, stream) => {
      const decoder = new StringDecoder("utf8");
      // The text after a chunk's last whole tag, read with the next.
      let carry = "";
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        read += chunk.length;
        if (read > PLAIN_SCAN_BYTES) {
          tooBig = true;
          (stream as Readable).destroy();
          return;
        }
        const text = carry + decoder.write(chunk);
        const end = text.lastIndexOf(">") + 1;
        const whole = text.slice(0, end);
        carry = text.slice(end);
        for (const m of whole.matchAll(COLOUR_RE)) colours.add(m[1].toUpperCase());
        for (const m of whole.matchAll(TRIANGLE_RE)) {
          triangles++;
          if (PAINT_RE.test(m[0])) painted++;
        }
      }
    },
  );
  return tooBig ? null : { colours: colours.size, painted: triangles > 0 && painted === triangles };
}

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
  const files = {
    entries,
    modelHead: head ? head.toString("utf-8") : null,
    projectSettings,
    modelSettings,
    prusaConfig,
  };
  const format = classify3mf(files);
  if (format.kind !== "plain" || !root) return format;
  const plainModel = await scanPlainModel(filePath).catch(() => null);
  return classify3mf({ ...files, plainModel });
}

/** The file a format was read from, as it was, kept beside it: one changed in place since (a file kept where it was
 *  imported from can be) is read again. */
type FileStamp = { size: number; mtimeMs: number };

function stampIn(value: unknown): FileStamp | null {
  const file = value && typeof value === "object" ? (value as { file?: Partial<FileStamp> }).file : null;
  return file && typeof file.size === "number" && typeof file.mtimeMs === "number"
    ? { size: file.size, mtimeMs: file.mtimeMs }
    : null;
}

async function stampOf(filePath: string): Promise<FileStamp | null> {
  try {
    const { size, mtimeMs } = await fs.stat(filePath);
    return { size, mtimeMs: Math.floor(mtimeMs) };
  } catch {
    return null;
  }
}

/** Reads and keeps the plate's format. Never throws: a format it can't read is left for the next look. */
export async function storePlateFormat(
  plateId: string,
  filename: string,
  filePath: string,
): Promise<ThreeMfFormat | null> {
  if (!isThreeMfFile(filename)) return null;
  try {
    const file = await stampOf(filePath);
    const format = await readThreeMfFormat(filePath);
    if (!format || !file) return null;
    const stored = { ...format, file } as unknown as Prisma.InputJsonValue;
    await prisma.plate.update({ where: { id: plateId }, data: { format: stored } });
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

/** The stored format when it was read from the file at `filePath` as it is now. */
async function currentFormat(plate: Pick<Plate, "format">, filePath: string): Promise<ThreeMfFormat | null> {
  const format = plateFormatOf(plate);
  const was = stampIn(plate.format);
  if (!format || !was) return null;
  const now = await stampOf(filePath);
  return now && now.size === was.size && now.mtimeMs === was.mtimeMs ? format : null;
}

// Each is a few small reads, but a model can have dozens of files; the rest are read on its next open.
const FILL_PER_REQUEST = 40;

/** Reads the formats of the plates `where` finds that have none from their file as it is now: 3MFs stored before
 *  formats were, or changed since. */
export async function fillPlateFormats(
  where: Prisma.PlateWhereInput,
  resolveFile: (plate: Pick<Plate, "storagePath" | "sourcePath">) => string | null,
): Promise<void> {
  const plates = await prisma.plate.findMany({
    where,
    select: { id: true, filename: true, format: true, storagePath: true, sourcePath: true },
  });
  let read = 0;
  for (const plate of plates) {
    if (read >= FILL_PER_REQUEST) break;
    if (!isThreeMfFile(plate.filename)) continue;
    const filePath = resolveFile(plate);
    if (!filePath || (await currentFormat(plate, filePath))) continue;
    await storePlateFormat(plate.id, plate.filename, filePath);
    read++;
  }
}

/** The plate's format, read and kept first when it has none from the file as it is now. */
export async function ensurePlateFormat(
  plate: Pick<Plate, "id" | "filename" | "format">,
  filePath: string,
): Promise<ThreeMfFormat | null> {
  return (await currentFormat(plate, filePath)) ?? (await storePlateFormat(plate.id, plate.filename, filePath));
}
