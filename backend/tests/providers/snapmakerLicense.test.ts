import { describe, expect, it } from "vitest";
import { snapmakerMetaFromDetail } from "../../src/providers/snapmaker/api";
import { snapmakerLicenseFrom } from "../../src/providers/snapmaker/license";
import { licenseById } from "../../src/services/licenseCatalog";
import { loadFixture } from "./support";

// Snapmaker Space's licences as its public list and models' details give them, recorded from its API. No database.

type Listed = { id: number; name: string; name_key: string; desc: string; url: string };
type Detail = { id: string; licenseId: number; copyright: Record<string, unknown> };

const EXPECTED: Record<number, string> = {
  1: "CC-BY-4.0",
  2: "CC-BY-NC-4.0",
  3: "CC-BY-SA-4.0",
  4: "CC-BY-NC-SA-4.0",
  5: "CC-BY-ND-4.0",
  6: "CC-BY-NC-ND-4.0",
  7: "CC0-1.0",
  8: "sdfl",
  9: "snapmaker-only",
};

describe("Snapmaker licences", () => {
  it("knows every licence the site lists, each Creative Commons one at the link the site gives it", () => {
    const listed = loadFixture<{ data: Listed[] }>("snapmaker", "license-list").data;
    expect(listed.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const entry of listed) {
      const copyright = { id: entry.id, name: entry.name, nameKey: entry.name_key, desc: entry.desc, url: entry.url };
      const license = snapmakerLicenseFrom({ licenseId: entry.id, copyright })!;
      expect(license.id).toBe(EXPECTED[entry.id]);
      expect(license.raw).toBe(String(entry.id));
      // Its own two have no link.
      expect(licenseById(license.id)?.url).toBe(entry.url || null);
    }
  });

  it("reads each model's licence, with the site's own words for its own two licences only", () => {
    const details = loadFixture<Detail[]>("snapmaker", "license-details");
    const read = Object.fromEntries(details.map((detail) => [detail.id, snapmakerLicenseFrom(detail)]));
    expect(read["13708"]).toEqual({ id: "CC-BY-4.0", raw: "1" });
    expect(read["46364"]).toEqual({ id: "CC-BY-SA-4.0", raw: "3" });
    expect(read["46901"]).toEqual({ id: "CC-BY-NC-SA-4.0", raw: "4" });
    expect(read["47505"]).toEqual({ id: "CC-BY-ND-4.0", raw: "5" });
    expect(read["47820"]).toEqual({ id: "CC-BY-NC-ND-4.0", raw: "6" });
    expect(read["45661"]).toMatchObject({ id: "sdfl", raw: "8" });
    expect(read["45661"]!.terms).toMatch(
      /^This work is licensed under the Standard Digital File License, permitting only non-commercial, personal use\.\n\nYou shall not share/,
    );
    expect(read["40765"]).toMatchObject({ id: "snapmaker-only", raw: "9" });
    expect(read["40765"]!.terms).toMatch(
      /^This work is licensed under the Snapmaker-Only License\.\n\nYou are permitted/,
    );
    expect(read["40765"]!.terms).not.toMatch(/<[a-z]/);
  });

  it("puts the licence in the model's details, and none for a model that names none", () => {
    const detail = loadFixture<Detail[]>("snapmaker", "license-details").find((d) => d.id === "40765")!;
    expect(snapmakerMetaFromDetail(detail).meta.license).toMatchObject({ id: "snapmaker-only", raw: "9" });
    const bare = snapmakerMetaFromDetail({ id: "1", title: "Bare" });
    expect(bare.meta).toHaveProperty("license", null);
    expect(snapmakerLicenseFrom({ licenseId: null, copyright: null })).toBeNull();
  });

  it("falls back to the licence object's id, and shows one added since by its link or its own name", () => {
    expect(snapmakerLicenseFrom({ copyright: { id: 7, name: "CC0 1.0" } })).toEqual({ id: "CC0-1.0", raw: "7" });
    expect(
      snapmakerLicenseFrom({
        licenseId: 10,
        copyright: {
          id: 10,
          name: "CC BY 3.0",
          url: "https://creativecommons.org/licenses/by/3.0/",
          desc: "<p>Old.</p>",
        },
      }),
    ).toEqual({
      id: "CC-BY-3.0",
      raw: "10",
      label: "CC BY 3.0",
      url: "https://creativecommons.org/licenses/by/3.0/",
      terms: "Old.",
    });
    expect(snapmakerLicenseFrom({ licenseId: 11, copyright: { id: 11, name: "Makers' Licence", url: null } })).toEqual({
      id: null,
      raw: "11",
      label: "Makers' Licence",
      url: null,
      terms: null,
    });
  });
});
