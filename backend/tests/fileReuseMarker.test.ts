import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reuseMarker, sha256OfFile } from "../src/services/fileReuse";

afterEach(() => vi.restoreAllMocks());

describe("reuseMarker", () => {
  it.each([
    ["largest signed inode", (1n << 63n) - 1n, 123n, true],
    ["unsigned inode", 1n << 63n, 123n, false],
    ["largest signed ctime", 123n, (1n << 63n) - 1n, true],
    ["overflowing ctime", 123n, 1n << 63n, false],
    ["smallest signed ctime", 123n, -(1n << 63n), true],
    ["underflowing ctime", 123n, -(1n << 63n) - 1n, false],
  ])("only records PostgreSQL BIGINT values: %s", async (_label, ino, ctimeNs, fits) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "reuse-marker-"));
    const file = path.join(dir, "model.stl");
    try {
      await fs.writeFile(file, "a verified shared file");
      const hash = await sha256OfFile(file);
      const realOpen = fs.open;
      // Keep real opening, reads, and closing; only the filesystem's unallocatable boundary stats are simulated.
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        const handle = await realOpen(...args);
        const realStat = handle.stat.bind(handle);
        vi.spyOn(handle, "stat").mockImplementation(async () =>
          Object.assign(await realStat({ bigint: true }), { ino, ctimeNs }),
        );
        return handle;
      });

      expect(await reuseMarker(file, true, hash)).toEqual(fits ? { reuseIno: ino, reuseCtimeNs: ctimeNs } : {});
      // Stat overrides must not bypass the real content verification.
      expect(await reuseMarker(file, true, "0".repeat(64))).toEqual({});
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
