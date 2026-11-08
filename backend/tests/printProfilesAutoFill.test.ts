import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { profileProject } from "./helpers/profileProject";

// A new import's print profiles are read on their own once it has settled. The other tests keep that off
// (PROFILE_FILL_AFTER_IMPORT_MS is -1 for them, so no fill reaches a real site); here it's on, in modules loaded afresh.

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("reads a new import's print profiles once it has settled, without the model page asking", async () => {
  vi.stubEnv("PROFILE_FILL_AFTER_IMPORT_MS", "50");
  vi.resetModules();
  const { prisma } = await import("../src/db");
  const { PROVIDERS } = await import("../src/providers/registry");
  const { createPrint } = await import("../src/services/printCreation");
  const read = vi
    .spyOn(PROVIDERS.makerworld, "profileFacts")
    .mockResolvedValue({ "333": { title: "Read on import", origin: "designer" } });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-autofill-"));
  try {
    const stamp = Date.now();
    const user = await prisma.user.create({
      data: { email: `autofill-${stamp}@example.com`, displayName: "Autofill" },
    });
    const project = await profileProject(dir, "auto.3mf", "none");
    const { plates } = await createPrint(
      user.id,
      { title: `auto ${stamp}`, sourceProvider: "makerworld", sourceExternalId: `auto-${stamp}` },
      `auto ${stamp}`,
      [{ filename: "auto.3mf", tempFilePath: project, sourceInstanceId: "333" }],
      { describe: false, classify: false },
    );
    let profile: unknown = null;
    for (let i = 0; i < 50 && !profile; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      profile = (await prisma.plate.findUniqueOrThrow({ where: { id: plates[0].id } })).profile;
    }
    expect(profile).toMatchObject({
      provider: { title: "Read on import", origin: "designer" },
      file: { printer: "Bambu Lab X1 Carbon" },
    });
    expect(read).toHaveBeenCalledWith(user.id, `auto-${stamp}`, ["333"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
