import { afterEach, describe, expect, it, vi } from "vitest";
import { crealitycloudMetaFromDetail } from "../../src/providers/crealitycloud/api";
import { crealitycloudLicenseFrom, readCrealitycloudLicense } from "../../src/providers/crealitycloud/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// Creality Cloud's licences as its models' details name them, recorded from its API. No database.

type GroupItem = Record<string, unknown> & { id: string };

const DESIGNER_ONLY = "Copyright is owned by the designer. Non-commercial use only.";

function recorded(id: string): GroupItem {
  return loadFixture<GroupItem[]>("crealitycloud", "license-details").find((item) => item.id === id)!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Creality Cloud licences", () => {
  it("knows each licence its upload form offers, and its own Standard License", () => {
    const names = ["CC BY", "CC BY-SA", "CC BY-NC", "CC BY-NC-SA", "CC BY-ND", "CC BY-NC-ND", "CC0", "CXY-SL"];
    const read = names.map((license) => crealitycloudLicenseFrom({ license })?.id);
    expect(read).toEqual([
      "CC-BY-4.0",
      "CC-BY-SA-4.0",
      "CC-BY-NC-4.0",
      "CC-BY-NC-SA-4.0",
      "CC-BY-ND-4.0",
      "CC-BY-NC-ND-4.0",
      "CC0-1.0",
      "crealitycloud-standard",
    ]);
    for (const id of read) expect(licenseById(id)).not.toBeNull();
  });

  it("reads each recorded model's licence, a paid one's too", () => {
    const details = loadFixture<GroupItem[]>("crealitycloud", "license-details");
    expect(Object.fromEntries(details.map((item) => [item.urlAlias, crealitycloudLicenseFrom(item)]))).toEqual({
      "k2-d3p-riser-quad-space-extension": { id: "crealitycloud-standard", raw: "CXY-SL" },
      "creality-cfs-hub-4-way-motor-release": { id: "CC-BY-NC-4.0", raw: "CC BY-NC" },
      "atlanta-braves-logo-keychain": { id: "CC-BY-SA-4.0", raw: "CC BY-SA" },
      "xmas-tree-3d-print-edition": { id: "CC-BY-NC-SA-4.0", raw: "CC BY-NC-SA" },
      "hulk-model-3d-printing": { id: "CC-BY-NC-ND-4.0", raw: "CC BY-NC-ND" },
      // Paid and for members: the page adds its line under the licence.
      "4-gear-fidget-spinner": { id: "crealitycloud-standard", raw: "CXY-SL", terms: DESIGNER_ONLY },
      // A Commercial Model, which members may sell prints of: that's the membership's terms, not the licence's.
      "shooting-arcade-game": { id: "crealitycloud-standard", raw: "CXY-SL" },
      "vazo-design-3d-print": { id: "CC-BY-4.0", raw: "CC BY" },
      // Paid, but neither for members nor exclusive: the licence alone.
      "3d-spiral-vase-project": { id: "CC-BY-ND-4.0", raw: "CC BY-ND" },
    });
  });

  it("takes commercial use off a Creative Commons licence that allows it, for a members' or exclusive model", () => {
    expect(crealitycloudLicenseFrom({ license: "CC BY-SA", isExclusive: true })).toEqual({
      id: "CC-BY-SA-4.0",
      raw: "CC BY-SA",
      terms: DESIGNER_ONLY,
      allows: ["share", "remix"],
    });
    expect(crealitycloudLicenseFrom({ license: "CC BY-ND", isVip: true })?.allows).toEqual(["share"]);
    // Nothing to take off one that doesn't allow it.
    expect(crealitycloudLicenseFrom({ license: "CC BY-NC", isVip: true })).toEqual({
      id: "CC-BY-NC-4.0",
      raw: "CC BY-NC",
      terms: DESIGNER_ONLY,
    });
  });

  it("puts the licence in the model's details, and gives none for a name it doesn't know", () => {
    expect(crealitycloudMetaFromDetail(recorded("6848425a484aeb342b6c4d0e"))!.meta.license).toEqual({
      id: "CC-BY-NC-4.0",
      raw: "CC BY-NC",
    });
    expect(crealitycloudMetaFromDetail({ id: "6848425a484aeb342b6c4d0e", license: "" })!.meta).toHaveProperty(
      "license",
      null,
    );
    for (const license of [undefined, null, "", 4]) expect(crealitycloudLicenseFrom({ license })).toBeNull();
    // One not mapped: read off its name if it can be, else kept as one Thingport doesn't know.
    expect(crealitycloudLicenseFrom({ license: "CC BY 3.0" })).toEqual({ id: "CC-BY-3.0", raw: "CC BY 3.0" });
    expect(crealitycloudLicenseFrom({ license: "CC BY 2.0" })).toEqual({ id: null, raw: "CC BY 2.0" });
    expect(crealitycloudLicenseFrom({ license: "CXY-PRO" })).toEqual({ id: null, raw: "CXY-PRO" });
    expect(crealitycloudLicenseFrom({ license: " cc  by-nc " })?.id).toBe("CC-BY-NC-4.0");
  });

  it("reads an older import's licence from its details alone, by its alias", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        calls.push({ url, body });
        if (!url.endsWith("/api/cxy/v3/model/modelGroupDetail")) return Response.json({ code: 1, msg: "unexpected" });
        if (body.id === "gone") return Response.json({ code: 512, msg: "deleted", result: null });
        if (body.id === "broken") return Response.json({ code: 1, msg: "Invalid Parameter", result: null });
        return Response.json({ code: 0, msg: "ok", result: { groupItem: recorded("674e9b87e0e36f298cd27dde") } });
      }),
    );
    expect(await readCrealitycloudLicense("user-1", "4-gear-fidget-spinner")).toEqual({
      id: "crealitycloud-standard",
      raw: "CXY-SL",
      terms: DESIGNER_ONLY,
    });
    // No print profile list: it says nothing of the licence.
    expect(calls).toEqual([
      { url: "https://www.crealitycloud.com/api/cxy/v3/model/modelGroupDetail", body: { id: "4-gear-fidget-spinner" } },
    ]);
    expect(await readCrealitycloudLicense("user-1", "gone")).toBeNull();
    await expect(readCrealitycloudLicense("user-1", "broken")).rejects.toThrow(
      "Couldn't read this model on Creality Cloud: Invalid Parameter",
    );
  });
});
