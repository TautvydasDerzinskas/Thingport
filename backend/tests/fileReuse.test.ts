import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MIN_SHARE_BYTES,
  sha256OfFile,
  shareStoredBytes,
  shareStoredCopy,
  type StoredCopy,
  type StoredCopyFinder,
} from "../src/services/fileReuse";
import { setFileReuse } from "../src/services/settingsService";
import { prisma } from "../src/db";

let dir: string;
let canClone: boolean;

// Smaller files are never shared (MIN_SHARE_BYTES), so every file here carries this after its distinguishing text.
const PAD = ".".repeat(MIN_SHARE_BYTES);

function file(name: string, contents: string, pad = true): string {
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, pad ? contents + PAD : contents);
  return abs;
}

/** A stored copy at `abs`, with its `changed` call recorded. */
const copyAt = (abs: string): StoredCopy & { changed: ReturnType<typeof vi.fn<() => Promise<void>>> } => ({
  path: abs,
  changed: vi.fn<() => Promise<void>>(async () => undefined),
});

const dest = () => path.join(dir, "out", `${crypto.randomBytes(6).toString("hex")}.stl`);

const { COPYFILE_EXCL, COPYFILE_FICLONE_FORCE } = fs.constants;
const realCopyFile = fsp.copyFile;

/** The file a clone was made from: it's cloned from the open handle, via /proc/self/fd, not by its path. */
const cloneSource = (src: unknown) => fs.readlinkSync(String(src));

/** The temp folder is tmpfs here, which can't clone, so a clone is simulated with a plain exclusive copy, as a
 *  reflink-capable filesystem would make it. `beforeClone` runs first, for a test to change the stored file. The
 *  files clones were made from are listed in `sources`. */
function simulateReflinks(beforeClone?: (src: string) => void) {
  const sources: string[] = [];
  const spy = vi.spyOn(fsp, "copyFile").mockImplementation(async (src, target, mode) => {
    if (mode !== undefined && mode & COPYFILE_FICLONE_FORCE) {
      sources.push(cloneSource(src));
      beforeClone?.(cloneSource(src));
      return realCopyFile(src, target, COPYFILE_EXCL);
    }
    return realCopyFile(src, target, mode);
  });
  return Object.assign(spy, { sources });
}

/** A clone attempt that fails with `code`, as copyFile reports it. */
function failClones(code: string) {
  return vi.spyOn(fsp, "copyFile").mockImplementation(async (src, target, mode) => {
    if (mode !== undefined && mode & COPYFILE_FICLONE_FORCE)
      throw Object.assign(new Error(`${code}: clone failed`), { code });
    return realCopyFile(src, target, mode);
  });
}

/** Whether `folder`'s filesystem can clone (btrfs, XFS, ...); tmpfs and ext4 can't. */
function canCloneIn(folder: string): boolean {
  const probe = fs.mkdtempSync(path.join(folder, ".reflink-probe-"));
  try {
    fs.writeFileSync(path.join(probe, "a"), "probe");
    fs.copyFileSync(path.join(probe, "a"), path.join(probe, "b"), COPYFILE_FICLONE_FORCE);
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
}

/** Opening a FIFO for reading blocks until a writer comes; should a test leave one blocked, this lets it go, so the
 *  worker can still exit. */
function unblockFifo(fifo: string) {
  try {
    fs.closeSync(fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
  } catch {
    // ENXIO: nothing was waiting on it.
  }
}

const hasMkfifo = (() => {
  try {
    execFileSync("mkfifo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-reuse-"));
  canClone = canCloneIn(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "file_reuse" } });
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("shareStoredCopy", () => {
  it("neither reads the file nor looks for copies when turned off", async () => {
    await setFileReuse("off");
    const find = vi.fn<StoredCopyFinder>(async () => []);
    const read = vi.spyOn(fs, "createReadStream");
    expect(await shareStoredCopy(file("off.stl", "off"), dest(), find)).toEqual({ contentSha256: null, shared: false });
    expect(find).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("looks copies up by hash and size, and clones one, leaving the imported file as it is", async () => {
    await setFileReuse("reflink");
    const copyFile = simulateReflinks();
    const stored = file("stored.stl", "same");
    const from = file("from.stl", "same");
    const find = vi.fn<StoredCopyFinder>(async () => [copyAt(stored)]);
    const target = dest();

    const result = await shareStoredCopy(from, target, find);
    const contentSha256 = await sha256OfFile(from);
    expect(find).toHaveBeenCalledWith({ contentSha256, size: 4 + MIN_SHARE_BYTES });
    expect(result).toEqual({ contentSha256, shared: true });
    expect(copyFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/proc\/self\/fd\/\d+$/),
      target,
      COPYFILE_EXCL | COPYFILE_FICLONE_FORCE,
    );
    expect(copyFile.sources).toEqual([stored]);
    expect(fs.readFileSync(target, "utf8")).toBe("same" + PAD);
    expect(fs.statSync(target).ino).not.toBe(fs.statSync(stored).ino);
    expect(fs.readFileSync(from, "utf8")).toBe("same" + PAD);
    expect(fs.readFileSync(stored, "utf8")).toBe("same" + PAD);
  });

  it("forgets a stored copy that's gone, and clones the next one", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const gone = copyAt(path.join(dir, "gone.stl"));
    const there = copyAt(file("there.stl", "next"));
    const target = dest();
    expect((await shareStoredCopy(file("next.stl", "next"), target, async () => [gone, there])).shared).toBe(true);
    expect(gone.changed).toHaveBeenCalledOnce();
    expect(there.changed).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, "utf8")).toBe("next" + PAD);
  });

  it("reports the hash but no share when there's no stored copy", async () => {
    await setFileReuse("reflink");
    const from = file("alone.stl", "alone");
    const target = dest();
    expect(await shareStoredCopy(from, target, async () => [])).toEqual({
      contentSha256: await sha256OfFile(from),
      shared: false,
    });
    expect(fs.existsSync(target)).toBe(false);
  });

  it.each([
    ["an empty", ""],
    ["a tiny", "tiny"],
    ["a just-under-a-block", "x".repeat(MIN_SHARE_BYTES - 1)],
  ])("doesn't look %s file up, but still reports its hash", async (_label, contents) => {
    await setFileReuse("reflink");
    const from = file("small.stl", contents, false);
    const find = vi.fn<StoredCopyFinder>(async () => []);
    expect(await shareStoredCopy(from, dest(), find)).toEqual({
      contentSha256: await sha256OfFile(from),
      shared: false,
    });
    expect(find).not.toHaveBeenCalled();
  });

  it("looks a file of exactly one block up", async () => {
    await setFileReuse("reflink");
    const find = vi.fn<StoredCopyFinder>(async () => []);
    await shareStoredCopy(file("block.stl", "x".repeat(MIN_SHARE_BYTES), false), dest(), find);
    expect(find).toHaveBeenCalledOnce();
  });

  it("doesn't change the permissions of a clone when none is given", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const stored = file("mode-source.jpg", "mode");
    fs.chmodSync(stored, 0o600);
    const chmod = vi.spyOn(fsp, "chmod");
    const target = dest();
    expect((await shareStoredBytes(Buffer.from("mode" + PAD), target, async () => [copyAt(stored)])).shared).toBe(true);
    expect(chmod).not.toHaveBeenCalled();
    // The clone keeps the stored file's permissions (simulated by copyFile, as libuv does).
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });

  it("clones a copy where the filesystem can, and leaves nothing behind where it can't", async () => {
    // The real copyFile: tmpfs can't clone, a reflink-capable filesystem can.
    await setFileReuse("reflink");
    const stored = file("clone-source.stl", "clone");
    const target = dest();
    const { shared } = await shareStoredCopy(file("clone.stl", "clone"), target, async () => [copyAt(stored)]);
    expect(shared).toBe(canClone);
    const placed = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    expect(placed).toBe(shared ? "clone" + PAD : null);
  });

  it("doesn't keep a clone of a copy whose content changed since it was hashed, and reports it", async () => {
    await setFileReuse("reflink");
    const copyFile = simulateReflinks();
    // Same size, other bytes: only reading the clone back tells.
    const stale = copyAt(file("stale.stl", "SAME"));
    const target = dest();
    expect((await shareStoredCopy(file("fresh.stl", "same"), target, async () => [stale])).shared).toBe(false);
    expect(copyFile).toHaveBeenCalledOnce();
    expect(fs.existsSync(target)).toBe(false);
    expect(stale.changed).toHaveBeenCalledOnce();
    expect(fs.readFileSync(stale.path, "utf8")).toBe("SAME" + PAD);
  });

  it("doesn't keep a clone of a copy edited while it was being cloned", async () => {
    await setFileReuse("reflink");
    const racing = copyAt(file("racing.stl", "same"));
    simulateReflinks((src) => fs.writeFileSync(src, "EDIT" + PAD));
    const target = dest();
    expect((await shareStoredCopy(file("calm.stl", "same"), target, async () => [racing])).shared).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    expect(racing.changed).toHaveBeenCalledOnce();
  });

  it("skips a copy whose size changed without reading or cloning it", async () => {
    await setFileReuse("reflink");
    const copyFile = simulateReflinks();
    const grown = copyAt(file("grown.stl", "same, and more"));
    const target = dest();
    expect((await shareStoredCopy(file("small.stl", "same"), target, async () => [grown])).shared).toBe(false);
    expect(copyFile).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
    expect(grown.changed).toHaveBeenCalledOnce();
  });

  it("never follows a link in place of a stored copy", async () => {
    await setFileReuse("reflink");
    const copyFile = simulateReflinks();
    const elsewhere = file("elsewhere.stl", "link");
    const link = path.join(dir, "link.stl");
    fs.symlinkSync(elsewhere, link);
    const target = dest();
    const linked = copyAt(link);
    // Same content and size behind the link: only O_NOFOLLOW keeps it from being cloned.
    expect((await shareStoredCopy(file("linked.stl", "link"), target, async () => [linked])).shared).toBe(false);
    expect(copyFile).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
    // A link isn't known to be stale, just not used.
    expect(linked.changed).not.toHaveBeenCalled();
  });

  // Timed out, rather than hanging the suite, if the open were to block on the FIFO.
  it.skipIf(!hasMkfifo)(
    "skips a FIFO in place of a stored copy without blocking on it",
    { timeout: 3000 },
    async () => {
      await setFileReuse("reflink");
      const copyFile = simulateReflinks();
      const fifo = path.join(dir, "fifo.stl");
      execFileSync("mkfifo", [fifo]);
      try {
        // A FIFO's size is 0, which an empty file is never looked up by, so a non-empty import still offers it. Not
        // forgetting it is what tells the isFile check ran: by size alone it would have been dropped as edited.
        const target = dest();
        const piped = copyAt(fifo);
        expect((await shareStoredCopy(file("piped.stl", "pipe"), target, async () => [piped])).shared).toBe(false);
        expect(copyFile).not.toHaveBeenCalled();
        expect(fs.existsSync(target)).toBe(false);
        expect(piped.changed).not.toHaveBeenCalled();
      } finally {
        unblockFifo(fifo);
      }
    },
  );

  it.skipIf(!hasMkfifo)(
    "doesn't block on a FIFO swapped in after the stored copy was looked up",
    { timeout: 3000 },
    async () => {
      await setFileReuse("reflink");
      const copyFile = simulateReflinks();
      const swapped = copyAt(file("swapped.stl", "swap"));
      const target = dest();
      try {
        const result = await shareStoredCopy(file("swap-in.stl", "swap"), target, async () => {
          // Found on record as a regular file, replaced before it's opened.
          fs.rmSync(swapped.path);
          execFileSync("mkfifo", [swapped.path]);
          return [swapped];
        });
        expect(result.shared).toBe(false);
        expect(copyFile).not.toHaveBeenCalled();
        expect(fs.existsSync(target)).toBe(false);
        expect(swapped.changed).not.toHaveBeenCalled();
      } finally {
        unblockFifo(swapped.path);
      }
    },
  );

  it("stores as usual on any error it can't share past, not just known ones", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const notADir = copyAt(path.join(file("plain.stl", "same"), "inside.stl"));
    expect((await shareStoredCopy(file("err.stl", "same"), dest(), async () => [notADir])).shared).toBe(false);
  });

  it.each(["EIO", "EACCES", "EXDEV"])(
    "stores as usual, keeping the stored copy on offer, when the clone fails with %s",
    async (code) => {
      await setFileReuse("reflink");
      const copyFile = failClones(code);
      const stored = copyAt(file(`fails-${code}.stl`, "fails"));
      const target = dest();
      const result = await shareStoredCopy(file(`failing-${code}.stl`, "fails"), target, async () => [stored]);
      expect(result.shared).toBe(false);
      expect(copyFile).toHaveBeenCalledOnce();
      expect(stored.changed).not.toHaveBeenCalled();
      expect(fs.existsSync(target)).toBe(false);
    },
  );

  it("doesn't forget a healthy copy when the clone's ENOENT comes from the destination's side", async () => {
    await setFileReuse("reflink");
    const target = dest();
    // The destination's folder pruned between it being made and the clone.
    const copyFile = simulateReflinks(() => fs.rmSync(path.dirname(target), { recursive: true, force: true }));
    const healthy = copyAt(file("healthy.stl", "healthy"));
    expect((await shareStoredCopy(file("pruned.stl", "healthy"), target, async () => [healthy])).shared).toBe(false);
    expect(copyFile).toHaveBeenCalledOnce();
    expect(healthy.changed).not.toHaveBeenCalled();
    expect(fs.readFileSync(healthy.path, "utf8")).toBe("healthy" + PAD);
  });

  it("forgets a copy deleted while it was being cloned", async () => {
    await setFileReuse("reflink");
    const deleted = copyAt(file("deleted.stl", "deleted"));
    // /proc/self/fd would still reopen the deleted file, so the ENOENT is made up; the open handle shows it's gone.
    vi.spyOn(fsp, "copyFile").mockImplementation(async (src, target, mode) => {
      if (mode === undefined || !(mode & COPYFILE_FICLONE_FORCE)) return realCopyFile(src, target, mode);
      fs.rmSync(deleted.path);
      throw Object.assign(new Error("ENOENT: gone"), { code: "ENOENT" });
    });
    expect((await shareStoredCopy(file("deleting.stl", "deleted"), dest(), async () => [deleted])).shared).toBe(false);
    expect(deleted.changed).toHaveBeenCalledOnce();
  });

  it("doesn't keep or forget a copy when the clone can't be read back", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const target = dest();
    const realOpen = fsp.open;
    vi.spyOn(fsp, "open").mockImplementation(async (p, ...rest) => {
      if (String(p) === target) throw Object.assign(new Error("EIO: read back"), { code: "EIO" });
      return realOpen(p, ...rest);
    });
    const unread = copyAt(file("unread.stl", "unread"));
    expect((await shareStoredCopy(file("unreadable.stl", "unread"), target, async () => [unread])).shared).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    expect(unread.changed).not.toHaveBeenCalled();
  });

  it("throws the error itself, not a conflict, when a mismatched clone can't be removed", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const target = dest();
    const failure = Object.assign(new Error("EACCES: can't remove"), { code: "EACCES" });
    const realRm = fsp.rm;
    vi.spyOn(fsp, "rm").mockImplementation(async (p, options) => {
      if (String(p) === target) throw failure;
      return realRm(p, options);
    });
    const stale = copyAt(file("stuck.stl", "SAME"));
    await expect(shareStoredCopy(file("unstuck.stl", "same"), target, async () => [stale])).rejects.toBe(failure);
  });

  it("stores as usual, still reporting the hash, when looking copies up fails", async () => {
    await setFileReuse("reflink");
    const copyFile = simulateReflinks();
    const from = file("lookup.stl", "lookup");
    const target = dest();
    expect(await shareStoredCopy(from, target, async () => Promise.reject(new Error("db")))).toEqual({
      contentSha256: await sha256OfFile(from),
      shared: false,
    });
    expect(copyFile).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
  });

  it("gives a clone the imported file's permissions, not the stored copy's", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const stored = copyAt(file("readonly.stl", "modes"));
    fs.chmodSync(stored.path, 0o444);
    const from = file("writable.stl", "modes");
    fs.chmodSync(from, 0o644);
    const target = dest();
    expect((await shareStoredCopy(from, target, async () => [stored])).shared).toBe(true);
    expect(fs.statSync(target).mode & 0o777).toBe(0o644);
    expect(fs.statSync(stored.path).mode & 0o777).toBe(0o444);
  });

  it("removes a clone whose permissions can't be set, and stores as usual", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    vi.spyOn(fsp, "chmod").mockRejectedValue(Object.assign(new Error("EPERM: chmod"), { code: "EPERM" }));
    const stored = copyAt(file("chmod-source.stl", "chmod"));
    const target = dest();
    expect((await shareStoredCopy(file("chmod.stl", "chmod"), target, async () => [stored])).shared).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    expect(stored.changed).not.toHaveBeenCalled();
  });

  it("carries on when forgetting a stale copy fails", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const rejects = { path: file("rejects.stl", "longer one"), changed: async () => Promise.reject(new Error("db")) };
    const throws = {
      path: path.join(dir, "throws.stl"),
      changed: (): Promise<void> => {
        throw new Error("db");
      },
    };
    const good = copyAt(file("good.stl", "fine"));
    const target = dest();
    expect((await shareStoredCopy(file("ok.stl", "fine"), target, async () => [rejects, throws, good])).shared).toBe(
      true,
    );
    expect(fs.readFileSync(target, "utf8")).toBe("fine" + PAD);
  });

  it("stores as usual, rather than reporting a conflict, when the destination folder can't be made", async () => {
    await setFileReuse("reflink");
    const copyFile = simulateReflinks();
    const stored = copyAt(file("folder-source.stl", "folder"));
    // A file where the destination's folder should be.
    const target = path.join(file("blocker", "not a folder"), "out.stl");
    expect((await shareStoredCopy(file("folder.stl", "folder"), target, async () => [stored])).shared).toBe(false);
    expect(copyFile).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.dirname(target), "utf8")).toBe("not a folder" + PAD);
  });

  it("never replaces a file already at the destination", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
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

describe("shareStoredBytes", () => {
  const bytes = (text: string) => Buffer.from(text + PAD);

  it("neither hashes nor looks for copies when turned off", async () => {
    await setFileReuse("off");
    const find = vi.fn<StoredCopyFinder>(async () => []);
    expect(await shareStoredBytes(bytes("off"), dest(), find)).toEqual({ contentSha256: null, shared: false });
    expect(find).not.toHaveBeenCalled();
  });

  it("looks copies up by the bytes' hash and size, and clones one", async () => {
    await setFileReuse("reflink");
    const copyFile = simulateReflinks();
    const stored = file("bytes-stored.jpg", "same");
    const find = vi.fn<StoredCopyFinder>(async () => [copyAt(stored)]);
    const target = dest();
    const contentSha256 = crypto.createHash("sha256").update(bytes("same")).digest("hex");

    expect(await shareStoredBytes(bytes("same"), target, find)).toEqual({ contentSha256, shared: true });
    expect(find).toHaveBeenCalledWith({ contentSha256, size: 4 + MIN_SHARE_BYTES });
    expect(copyFile.sources).toEqual([stored]);
    expect(fs.readFileSync(target, "utf8")).toBe("same" + PAD);
    expect(fs.statSync(target).ino).not.toBe(fs.statSync(stored).ino);
  });

  it("reports the hash but doesn't write anything when there's nothing to share, leaving the write to the caller", async () => {
    await setFileReuse("reflink");
    const target = dest();
    const result = await shareStoredBytes(bytes("alone"), target, async () => []);
    expect(result.shared).toBe(false);
    expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("doesn't keep a clone of a copy whose content changed since it was hashed", async () => {
    await setFileReuse("reflink");
    simulateReflinks();
    const stale = copyAt(file("bytes-stale.jpg", "SAME"));
    const target = dest();
    expect((await shareStoredBytes(bytes("same"), target, async () => [stale])).shared).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
    expect(stale.changed).toHaveBeenCalledOnce();
  });

  it("doesn't look bytes under a block up, but still reports their hash", async () => {
    await setFileReuse("reflink");
    const find = vi.fn<StoredCopyFinder>(async () => []);
    const result = await shareStoredBytes(Buffer.from("tiny"), dest(), find);
    expect(result.shared).toBe(false);
    expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(find).not.toHaveBeenCalled();
  });
});
