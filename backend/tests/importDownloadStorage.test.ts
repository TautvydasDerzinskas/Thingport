import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { downloadPlainFileToTemp, importPrintFromUrl } from "../src/services/importService";
import { createPrint, discardPrint } from "../src/services/printCreation";
import { managedPlatePath } from "../src/services/printService";
import { getPreviewMode, setFileReuse, setPreviewMode } from "../src/services/settingsService";

const prints: string[] = [];
let userId: string;
let previewMode: Awaited<ReturnType<typeof getPreviewMode>>;
const copyFile = fs.copyFile;
const chmod = fs.chmod;

vi.mock("node:dns/promises", () => ({
  default: { resolve4: async () => ["93.184.216.34"], resolve6: async () => [] },
}));

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: `download-mode-${crypto.randomUUID()}@example.com`, displayName: "Download mode" },
    })
  ).id;
  previewMode = await getPreviewMode();
  await setPreviewMode("disabled");
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const id of prints.splice(0)) await discardPrint(id);
});
afterAll(async () => {
  await setPreviewMode(previewMode);
  await setFileReuse("off");
  await prisma.user.delete({ where: { id: userId } });
});

describe("HTTP download storage permissions", () => {
  it.each(["off", "reflink"] as const)(
    "keeps the download private and stores a 0644 plate with reuse %s",
    async (reuse) => {
      await setFileReuse(reuse);
      const bytes = Buffer.from(`solid ${crypto.randomUUID()}\n${" ".repeat(5000)}\nendsolid\n`);
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async () => new Response(bytes)),
      );
      let clones = 0;
      let activeTemp: string | undefined;
      vi.spyOn(fs, "chmod").mockImplementation(async (file, mode) => {
        await chmod(file, mode);
        const temp = activeTemp ? await fs.stat(activeTemp).catch(() => null) : null;
        expect(temp ? temp.mode & 0o777 : 0o600).toBe(0o600);
      });
      vi.spyOn(fs, "copyFile").mockImplementation(async (from, to, mode) => {
        if ((mode ?? 0) & fsSync.constants.COPYFILE_FICLONE_FORCE) {
          clones++;
          return copyFile(from, to, fsSync.constants.COPYFILE_EXCL);
        }
        return copyFile(from, to, mode);
      });
      for (let index = 0; index < 2; index++) {
        const download = await downloadPlainFileToTemp("https://example.com/part.stl", "part.stl");
        if (!download || !("input" in download)) throw new Error("Download failed");
        const temp = download.input.tempFilePath!;
        activeTemp = temp;
        expect((await fs.stat(temp)).mode & 0o777).toBe(0o600);
        const created = await createPrint(userId, {}, "Download", [download.input], { describe: false });
        prints.push(created.print.id);
        expect((await fs.stat(managedPlatePath(created.plates[0]))).mode & 0o777).toBe(0o644);
        await expect(fs.stat(temp)).rejects.toMatchObject({ code: "ENOENT" });
      }
      expect(clones).toBe(reuse === "reflink" ? 1 : 0);
    },
  );
  it("applies the final permissions to a generic direct-link import too", async () => {
    await setFileReuse("off");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => new Response("solid downloaded\nendsolid downloaded\n")),
    );
    const url = "https://example.com/downloaded.stl";
    const result = await importPrintFromUrl(userId, url, { url });
    prints.push(result.print.id);
    expect((await fs.stat(managedPlatePath(result.plates[0]))).mode & 0o777).toBe(0o644);
  });
});
