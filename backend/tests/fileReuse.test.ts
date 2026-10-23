import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sha256OfFile, shareStoredCopy, type StoredCopy, type StoredCopyFinder } from "../src/services/fileReuse";
import { setFileReuse } from "../src/services/settingsService";
import { prisma } from "../src/db";

let dir: string;

function file(name: string, contents: string): string {
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, contents);
  return abs;
}

/** A stored copy at `abs`, with its `changed` call recorded. */
const copyAt = (abs: string): StoredCopy & { changed: ReturnType<typeof vi.fn<() => Promise<void>>> } => ({
  path: abs,
  changed: vi.fn<() => Promise<void>>(async () => undefined),
});

const dest = () => path.join(dir, "out", `${crypto.randomBytes(6).toString("hex")}.stl`);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-reuse-"));
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "file_reuse" } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("shareStoredCopy", () => {
  it("neither reads the file nor looks for copies when turned off", async () => {
    await setFileReuse("off");
    const find = vi.fn<StoredCopyFinder>(async () => []);
    expect(await shareStoredCopy(file("off.stl", "off"), dest(), find)).toEqual({ contentSha256: null, shared: false });
    expect(find).not.toHaveBeenCalled();
  });

  it("looks copies up by hash and size, and links the first one that's still there", async () => {
    await setFileReuse("hardlink");
    const stored = file("stored.stl", "same");
    const from = file("from.stl", "same");
    const gone = copyAt(path.join(dir, "gone.stl"));
    const find = vi.fn<StoredCopyFinder>(async () => [gone, copyAt(stored)]);
    const target = dest();

    const result = await shareStoredCopy(from, target, find);
    const contentSha256 = await sha256OfFile(from);
    expect(find).toHaveBeenCalledWith({ contentSha256, size: 4 });
    expect(result).toEqual({ contentSha256, shared: true });
    expect(fs.statSync(target).ino).toBe(fs.statSync(stored).ino);
    expect(fs.existsSync(from)).toBe(true);
  });

  it("reports the hash but no share when there's no stored copy", async () => {
    await setFileReuse("hardlink");
    const from = file("alone.stl", "alone");
    const target = dest();
    expect(await shareStoredCopy(from, target, async () => [])).toEqual({
      contentSha256: await sha256OfFile(from),
      shared: false,
    });
    expect(fs.existsSync(target)).toBe(false);
  });

  it("clones a copy where the filesystem can, and leaves nothing behind where it can't", async () => {
    await setFileReuse("reflink");
    const stored = file("clone-source.stl", "clone");
    const target = dest();
    const { shared } = await shareStoredCopy(file("clone.stl", "clone"), target, async () => [copyAt(stored)]);
    const placed = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    expect(placed).toBe(shared ? "clone" : null);
  });

  it("doesn't keep a copy whose content changed since it was hashed, and reports it", async () => {
    await setFileReuse("hardlink");
    const stale = copyAt(file("stale.stl", "SAME"));
    const target = dest();
    expect((await shareStoredCopy(file("fresh.stl", "same"), target, async () => [stale])).shared).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    expect(stale.changed).toHaveBeenCalledOnce();
  });

  it("skips a copy whose size changed without reading it", async () => {
    await setFileReuse("hardlink");
    const grown = copyAt(file("grown.stl", "same, and more"));
    const target = dest();
    expect((await shareStoredCopy(file("small.stl", "same"), target, async () => [grown])).shared).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    expect(grown.changed).toHaveBeenCalledOnce();
  });

  it("stores as usual on any error it can't share past, not just known ones", async () => {
    await setFileReuse("hardlink");
    const notADir = copyAt(path.join(file("plain.stl", "same"), "inside.stl"));
    expect((await shareStoredCopy(file("err.stl", "same"), dest(), async () => [notADir])).shared).toBe(false);
  });

  it("never replaces a file already at the destination", async () => {
    await setFileReuse("hardlink");
    const stored = file("taken-source.stl", "taken");
    const target = dest();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "someone else's");
    await expect(
      shareStoredCopy(file("taken.stl", "taken"), target, async () => [copyAt(stored)]),
    ).rejects.toMatchObject({
      status: 409,
    });
    expect(fs.readFileSync(target, "utf8")).toBe("someone else's");
  });
});
