import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { repairZipDirectory } from "../../src/providers/qidimaker/zipRepair";
import { extractZipEntryToFile, listZipEntries } from "../../src/utils/zipReader";

// QIDI Maker's zips of a model's files, most of which lack their central directory: written as a stream, each entry
// with a data descriptor after it, that never got to its end. No database.

const made: string[] = [];

async function file(bytes: Buffer): Promise<string> {
  const filePath = path.join(os.tmpdir(), `qidimaker-zip-${made.length}-${process.pid}.zip`);
  await fs.writeFile(filePath, bytes);
  made.push(filePath);
  return filePath;
}

afterEach(async () => {
  await Promise.all(made.splice(0).map((filePath) => fs.rm(filePath, { force: true })));
});

/** A zip as the site writes it: each entry's sizes after its data, as a stream writes them. */
async function streamed(entries: Record<string, Buffer>, compression: "DEFLATE" | "STORE" = "DEFLATE") {
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(entries)) zip.file(name, bytes);
  return zip.generateAsync({ type: "nodebuffer", compression, streamFiles: true });
}

/** The same, cut off where its central directory starts. */
const withoutDirectory = (whole: Buffer) => whole.subarray(0, whole.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));

async function contents(zipPath: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await listZipEntries(zipPath)) {
    if (entry.isDirectory) continue;
    const target = `${zipPath}.entry`;
    await extractZipEntryToFile(zipPath, entry.name, target, 1e9);
    out[entry.name] = await fs.readFile(target, "utf8");
    await fs.rm(target, { force: true });
  }
  return out;
}

describe("QIDI Maker zip repair", () => {
  const entries = {
    "model_1_stl_files/2026-09-29_0b02060ac4bd04.stl": Buffer.from("solid a\n".repeat(5000)),
    "model_1_stl_files/2026-09-29_9ce434e9a4ae8d.step": Buffer.from("ISO-10303-21;\n".repeat(300)),
    "model_1_stl_files/名字.3mf": Buffer.from("PK binary-ish \u0000 data"),
  };
  const expected = Object.fromEntries(Object.entries(entries).map(([name, bytes]) => [name, bytes.toString("utf8")]));

  it("puts back the directory of a zip that lost it, each entry whole", async () => {
    const zipPath = await file(withoutDirectory(await streamed(entries)));
    await expect(listZipEntries(zipPath)).rejects.toThrow(/end of central directory/i);
    expect(await repairZipDirectory(zipPath)).toBe(true);
    expect(await contents(zipPath)).toEqual(expected);
  });

  it("does so for stored entries too", async () => {
    const zipPath = await file(withoutDirectory(await streamed(entries, "STORE")));
    expect(await repairZipDirectory(zipPath)).toBe(true);
    expect(await contents(zipPath)).toEqual(expected);
  });

  // A binary STL's header can be anything: here a descriptor's signature, a CRC, and sizes of nothing.
  const lookalike = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 4]),
    Buffer.alloc(8),
    Buffer.alloc(64, 32),
    Buffer.from("facet ".repeat(500)),
  ]);
  const PART = "model_1_stl_files/part.stl";
  // Three bytes of the directory a stream was cut off in.
  const CUT_DIRECTORY = Buffer.from([0x50, 0x4b, 0x01]);
  const text = (files: Record<string, Buffer>) =>
    Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString("utf8")]));

  it("isn't misled by a stored file whose own bytes look like a descriptor", async () => {
    const first = { [PART]: lookalike, ...entries };
    const zipPath = await file(withoutDirectory(await streamed(first, "STORE")));
    expect(await repairZipDirectory(zipPath)).toBe(true);
    expect(await contents(zipPath)).toEqual(text(first));
  });

  it("keeps the last entry where a directory cut short too soon to tell follows it", async () => {
    const zipPath = await file(Buffer.concat([withoutDirectory(await streamed(entries)), CUT_DIRECTORY]));
    expect(await repairZipDirectory(zipPath)).toBe(true);
    expect(await contents(zipPath)).toEqual(expected);
  });

  it("keeps such a file whole as the last entry too, before a directory cut short", async () => {
    const last = { ...entries, [PART]: lookalike };
    const zipPath = await file(Buffer.concat([withoutDirectory(await streamed(last, "STORE")), CUT_DIRECTORY]));
    expect(await repairZipDirectory(zipPath)).toBe(true);
    expect(await contents(zipPath)).toEqual(text(last));
  });

  it("drops a last entry nothing it knows follows, rather than cut it short", async () => {
    const last = { ...entries, [PART]: lookalike };
    const zipPath = await file(
      Buffer.concat([withoutDirectory(await streamed(last, "STORE")), Buffer.from("not a zip")]),
    );
    expect(await repairZipDirectory(zipPath)).toBe(true);
    expect(await contents(zipPath)).toEqual(expected);
  });

  it("drops an entry cut off before its end, keeping the ones before it", async () => {
    const broken = withoutDirectory(await streamed(entries));
    const zipPath = await file(broken.subarray(0, broken.length - 40));
    expect(await repairZipDirectory(zipPath)).toBe(true);
    expect(Object.keys(await contents(zipPath))).toEqual(Object.keys(entries).slice(0, 2));
  });

  it("leaves a whole zip as it is", async () => {
    const whole = await streamed(entries);
    const zipPath = await file(whole);
    expect(await repairZipDirectory(zipPath)).toBe(false);
    expect(await fs.readFile(zipPath)).toEqual(whole);
  });

  it("refuses what isn't a zip at all", async () => {
    const zipPath = await file(Buffer.from("<html>Not found</html>"));
    await expect(repairZipDirectory(zipPath)).rejects.toThrow("Not a zip");
  });
});
