import { describe, expect, it } from "vitest";
import { buildImportSourceUrl, identifySourceModel } from "../src/sources/sourceUrls";
import { toPrintOut } from "../src/dto";
import { prisma } from "../src/db";

describe("buildImportSourceUrl", () => {
  it("rebuilds the exact URL identifySourceModel would parse back out again", () => {
    const makerworldUrl = "https://makerworld.com/en/models/1698989-brian-griffin";
    const mwSource = identifySourceModel(makerworldUrl)!;
    expect(buildImportSourceUrl(mwSource.provider, mwSource.externalId)).toBe(
      "https://makerworld.com/en/models/1698989",
    );

    const thingUrl = "https://www.thingiverse.com/thing:763622";
    const tvSource = identifySourceModel(thingUrl)!;
    expect(buildImportSourceUrl(tvSource.provider, tvSource.externalId)).toBe(thingUrl);
  });

  it("returns null when there's nothing to build from", () => {
    expect(buildImportSourceUrl(null, "123")).toBeNull();
    expect(buildImportSourceUrl("makerworld", null)).toBeNull();
    expect(buildImportSourceUrl("some-unknown-provider", "123")).toBeNull();
  });
});

describe("toPrintOut -- source_provider / source_url", () => {
  it("exposes both for an imported print", async () => {
    const user = await prisma.user.create({
      data: { email: `source-url-test-${Date.now()}@example.com`, passwordHash: "x", displayName: "Source URL Test" },
    });
    const print = await prisma.print.create({
      data: {
        userId: user.id,
        name: "Imported Thing",
        nameNormalized: "imported thing",
        sourceProvider: "thingiverse",
        sourceExternalId: "763622",
      },
    });

    const out = toPrintOut(print, [], [], null);
    expect(out.source_provider).toBe("thingiverse");
    expect(out.source_url).toBe("https://www.thingiverse.com/thing:763622");
  });

  it("is null for an upload with no known source", async () => {
    const user = await prisma.user.create({
      data: {
        email: `source-url-test-2-${Date.now()}@example.com`,
        passwordHash: "x",
        displayName: "Source URL Test 2",
      },
    });
    const print = await prisma.print.create({
      data: { userId: user.id, name: "Uploaded", nameNormalized: "uploaded" },
    });

    const out = toPrintOut(print, [], [], null);
    expect(out.source_provider).toBeNull();
    expect(out.source_url).toBeNull();
  });
});
