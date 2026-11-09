import { afterEach, describe, expect, it, vi } from "vitest";
import { makerworldLicenseFrom } from "../../src/providers/makerworld/license";
import { readMakerworldLicense } from "../../src/providers/makerworld/licenseReader";
import { makerworldMetaFromDesign } from "../../src/providers/makerworld/pageData";
import { loadFixture } from "./support";

// MakerWorld's licences as its public design data names them, recorded from the cloud API (trimmed to the licence).

afterEach(() => {
  vi.unstubAllGlobals();
});

const NO_WORDING = { title: "", content: "" };

describe("MakerWorld licences", () => {
  it("reads a Creative Commons licence by its parts, as 4.0", () => {
    expect(makerworldLicenseFrom(loadFixture("makerworld", "license-3525645"))).toEqual({
      id: "CC-BY-NC-SA-4.0",
      raw: "BY-NC-SA",
    });
    expect(makerworldLicenseFrom(loadFixture("makerworld", "license-3537527"))).toEqual({ id: "CC0-1.0", raw: "CC0" });
    const parts: [string, string][] = [
      ["BY", "CC-BY-4.0"],
      ["BY-SA", "CC-BY-SA-4.0"],
      ["BY-ND", "CC-BY-ND-4.0"],
      ["BY-NC", "CC-BY-NC-4.0"],
      ["BY-NC-SA", "CC-BY-NC-SA-4.0"],
      ["BY-NC-ND", "CC-BY-NC-ND-4.0"],
    ];
    for (const [raw, id] of parts) {
      expect(makerworldLicenseFrom({ license: raw, licenseDescriptionInfo: NO_WORDING })).toEqual({ id, raw });
    }
  });

  it("keeps a site licence's wording, which the design carries", () => {
    const exclusive = makerworldLicenseFrom(loadFixture("makerworld", "license-3540936"));
    expect(exclusive).toMatchObject({ id: "makerworld-exclusive", raw: "MakerWorld Exclusive License" });
    expect(exclusive?.terms).toMatch(/^You may create derivative works based on this object, provided that/);
    expect(exclusive?.terms).toMatch(/Commercial use of this object and any derivative works is strictly prohibited/);
    const sdfl = makerworldLicenseFrom(loadFixture("makerworld", "license-3541343"));
    expect(sdfl).toMatchObject({ id: "sdfl", raw: "Standard Digital File License" });
    expect(sdfl?.terms).toMatch(/^You shall not share, sub-license, sell, rent, host/);
  });

  it("knows its other two site licences, however the dashes come", () => {
    const words = { title: "This user content is licensed under…", content: "Only on MakerWorld." };
    expect(
      makerworldLicenseFrom({
        license: "Standard Digital File License - Community Use",
        licenseDescriptionInfo: words,
      }),
    ).toEqual({
      id: "makerworld-sdfl-community",
      raw: "Standard Digital File License - Community Use",
      terms: "Only on MakerWorld.",
    });
    expect(
      makerworldLicenseFrom({ license: "Standard Digital File License \u2013 Community Use (SDFL\u2011C)" })?.id,
    ).toBe("makerworld-sdfl-community");
    expect(
      makerworldLicenseFrom({
        license: "Standard Digital File License - Platform Print Only (SDFL-PPO)",
        licenseDescriptionInfo: NO_WORDING,
      }),
    ).toEqual({
      id: "makerworld-sdfl-ppo",
      raw: "Standard Digital File License - Platform Print Only (SDFL-PPO)",
      terms: null,
    });
  });

  it("shows one it doesn't know by its name, says none for an empty one, and leaves out one it wasn't sent", () => {
    expect(makerworldLicenseFrom({ license: "MakerWorld Galaxy License", licenseDescriptionInfo: NO_WORDING })).toEqual(
      {
        id: null,
        raw: "MakerWorld Galaxy License",
        label: "MakerWorld Galaxy License",
        terms: null,
      },
    );
    expect(makerworldLicenseFrom({ license: "" })).toBeNull();
    expect(makerworldLicenseFrom({ license: null })).toBeNull();
    // The design Grab sends is cut down to what the import needs, without the licence.
    expect(makerworldLicenseFrom({ id: 3525645, title: "Bauble" })).toBeUndefined();
  });

  it("puts it in the design's metadata, and nothing where the design doesn't say", () => {
    expect(makerworldMetaFromDesign(loadFixture("makerworld", "license-3525645")).license).toEqual({
      id: "CC-BY-NC-SA-4.0",
      raw: "BY-NC-SA",
    });
    expect(makerworldMetaFromDesign({ id: 3525645, title: "Bauble" })).not.toHaveProperty("license");
  });

  it("reads an older import's from the public design, without a sign-in", async () => {
    const design = loadFixture("makerworld", "license-3541343");
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        if (url.endsWith("/design/3541343")) return Response.json(design);
        if (url.endsWith("/design/3541344")) {
          const { license: _omitted, ...rest } = design as Record<string, unknown>;
          return Response.json(rest);
        }
        return Response.json({ code: 1, error: "not found" }, { status: 404 });
      }),
    );
    const stored = { notes: null };
    expect(await readMakerworldLicense("user-1", "3541343", stored)).toMatchObject({ id: "sdfl" });
    expect(calls[0].url).toBe("https://api.bambulab.com/v1/design-service/design/3541343");
    expect(calls[0].headers).not.toHaveProperty("Authorization");
    expect(await readMakerworldLicense("user-1", "999", stored)).toBeNull();
    // A design answered without the field can't tell: read again later, rather than kept as none.
    expect(await readMakerworldLicense("user-1", "3541344", stored)).toBeUndefined();
  });

  it("throws when MakerWorld won't answer, so it's read again later", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("busy", { status: 503 })),
    );
    await expect(readMakerworldLicense("user-1", "3541343", { notes: null })).rejects.toThrow(/HTTP 503/);
  });
});
