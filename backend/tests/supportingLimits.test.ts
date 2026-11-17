import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { supportingFilesFromZip } from "../src/services/importService";
import { supportingLimits } from "../src/services/supportingImports";

// The admin's setting, read from the database, fails here.
vi.mock("../src/services/settingsService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/settingsService")>()),
  getImportSupportingFiles: async () => {
    throw new Error("the database is gone");
  },
}));

describe("the supporting-file limits when the setting can't be read", () => {
  it("keeps none, so a site's other files never fail the import over it", async () => {
    expect(await supportingLimits()).toBeNull();
    const zip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "supporting-limits-")), "model.zip");
    fs.writeFileSync(
      zip,
      await new JSZip()
        .file("a.stl", "solid a endsolid")
        .file("guide.pdf", "%PDF-1.4")
        .generateAsync({ type: "nodebuffer" }),
    );
    expect(await supportingFilesFromZip(zip)).toEqual([]);
  });
});
