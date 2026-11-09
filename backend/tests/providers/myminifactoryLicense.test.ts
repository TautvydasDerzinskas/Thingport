import { describe, expect, it } from "vitest";
import { myminifactoryMetaFromObject } from "../../src/providers/myminifactory/api";
import { myminifactoryLicenseFrom } from "../../src/providers/myminifactory/license";

// MyMiniFactory's licences. The API's object has the licence's name (`license`) and the designer's picks (`licenses`, a
// `{ type, value }` each), as its published API documentation describes them; the names are the ones its object pages
// show.

const flags = (on: Record<string, boolean>) => Object.entries(on).map(([type, value]) => ({ type, value }));

describe("MyMiniFactory licences", () => {
  it("reads a Creative Commons one by its name, as the 4.0 its pages link", () => {
    const cc = flags({
      mention: true,
      remix: true,
      "commercial-use": false,
      exclusivity: false,
      share: true,
      store: false,
    });
    expect(myminifactoryLicenseFrom({ license: "BY-NC-SA", licenses: cc })).toEqual({
      id: "CC-BY-NC-SA-4.0",
      raw: "BY-NC-SA",
    });
    expect(myminifactoryLicenseFrom({ license: "BY-NC-ND", licenses: [] })).toEqual({
      id: "CC-BY-NC-ND-4.0",
      raw: "BY-NC-ND",
    });
    expect(myminifactoryLicenseFrom({ license: "BY", licenses: [] })?.id).toBe("CC-BY-4.0");
    expect(myminifactoryLicenseFrom({ license: "CC BY-SA 4.0", licenses: [] })?.id).toBe("CC-BY-SA-4.0");
    expect(
      myminifactoryLicenseFrom({ license: "BY-NC: credit the designer, no commercial use", licenses: [] })?.id,
    ).toBe("CC-BY-NC-4.0");
    expect(myminifactoryLicenseFrom({ license: "Creative Commons Attribution-NonCommercial", licenses: [] })?.id).toBe(
      "CC-BY-NC-4.0",
    );
  });

  it("builds its own licence's permissions from the designer's picks", () => {
    expect(
      myminifactoryLicenseFrom({
        license: "MyMiniFactory - Credit - Remix - Noncommercial",
        licenses: flags({ mention: true, remix: true, "commercial-use": false, exclusivity: false, share: true }),
      }),
    ).toEqual({
      id: "myminifactory",
      raw: "MyMiniFactory - Credit - Remix - Noncommercial",
      label: "MyMiniFactory - Credit - Remix - Noncommercial",
      allows: ["share", "remix"],
      // "mention": the designer asks for credit.
      requires: { credit: true },
    });
    // An exclusive object may not be put up anywhere else, whatever else it allows.
    expect(
      myminifactoryLicenseFrom({
        license: "MyMiniFactory Exclusive - Credit - Remix - Commercial",
        licenses: flags({ mention: true, remix: true, "commercial-use": true, exclusivity: true, share: true }),
      })?.allows,
    ).toEqual(["remix", "commercial"]);
  });

  it("reads the permissions off the name when the picks aren't there", () => {
    expect(
      myminifactoryLicenseFrom({ license: "MyMiniFactory Exclusive - Credit - Noremix - Noncommercial" })?.allows,
    ).toEqual([]);
    expect(
      myminifactoryLicenseFrom({ license: "MyMiniFactory Exclusive - Credit - Remix - Commercial" })?.allows,
    ).toEqual(["remix", "commercial"]);
    expect(myminifactoryLicenseFrom({ license: "MyMiniFactory - Credit - Remix - Noncommercial" })?.allows).toEqual([
      "remix",
    ]);
  });

  it("keeps the Creative Commons version a name gives, 4.0 when it gives none", () => {
    expect(myminifactoryLicenseFrom({ license: "CC BY-SA 3.0", licenses: [] })).toEqual({
      id: "CC-BY-SA-3.0",
      raw: "CC BY-SA 3.0",
    });
    expect(myminifactoryLicenseFrom({ license: "BY-NC 3.0", licenses: [] })?.id).toBe("CC-BY-NC-3.0");
    expect(myminifactoryLicenseFrom({ license: "BY-NC 4.0", licenses: [] })?.id).toBe("CC-BY-NC-4.0");
    expect(myminifactoryLicenseFrom({ license: "BY-NC", licenses: [] })?.id).toBe("CC-BY-NC-4.0");
    expect(myminifactoryLicenseFrom({ license: "by-nc 3.0", licenses: [] })?.id).toBe("CC-BY-NC-3.0");
    expect(myminifactoryLicenseFrom({ license: "Attribution-ShareAlike", licenses: [] })?.id).toBe("CC-BY-SA-4.0");
    // Not a licence's name: its own, from the flags.
    expect(
      myminifactoryLicenseFrom({ license: "Attribution required", licenses: flags({ mention: true }) }),
    ).toMatchObject({ id: "myminifactory", label: "Attribution required" });
    expect(myminifactoryLicenseFrom({ license: "Attribution-ShareAlike 4.0 International", licenses: [] })?.id).toBe(
      "CC-BY-SA-4.0",
    );
    // A version the catalogue doesn't have is kept by its name, not taken for 4.0, spelled out or not.
    expect(myminifactoryLicenseFrom({ license: "Attribution-ShareAlike 2.0 Generic", licenses: [] })).toEqual({
      id: null,
      raw: "Attribution-ShareAlike 2.0 Generic",
      label: "Attribution-ShareAlike 2.0 Generic",
    });
    expect(myminifactoryLicenseFrom({ license: "CC BY-SA 2.0", licenses: [] })).toEqual({
      id: null,
      raw: "CC BY-SA 2.0",
      label: "CC BY-SA 2.0",
    });
  });

  it("puts a paid object under the store's licence, and official content under all rights reserved", () => {
    expect(
      myminifactoryLicenseFrom({
        license: "MyMiniFactory Digital File Store License",
        licenses: flags({ store: true }),
      }),
    ).toEqual({ id: "myminifactory-store", raw: "MyMiniFactory Digital File Store License" });
    expect(
      myminifactoryLicenseFrom({ license: "BY-NC", licenses: flags({ remix: true, store: false }) }, true)?.id,
    ).toBe("myminifactory-store");
    expect(myminifactoryLicenseFrom({ license: null, licenses: [] }, true)).toEqual({
      id: "myminifactory-store",
      raw: "store",
    });
    // On sale with neither field: the store's licence still.
    expect(myminifactoryLicenseFrom({}, true)).toEqual({ id: "myminifactory-store", raw: "store" });
    expect(myminifactoryLicenseFrom({})).toBeUndefined();
    expect(myminifactoryLicenseFrom({ license: "Official Content License", licenses: [] })).toEqual({
      id: "all-rights-reserved",
      raw: "Official Content License",
      label: "Official Content License",
    });
  });

  it("tells an object without one from a read without the fields", () => {
    expect(myminifactoryLicenseFrom({ license: null, licenses: [] })).toBeNull();
    expect(myminifactoryLicenseFrom({ name: "Skull" })).toBeUndefined();
    expect(myminifactoryLicenseFrom({ licenses: flags({ remix: true, mention: true }) })).toEqual({
      id: "myminifactory",
      raw: "remix, mention",
      label: null,
      allows: ["remix"],
      requires: { credit: true },
    });
  });

  it("puts it in the object's metadata, the store's for one on sale", () => {
    const object = { id: 16357, name: "Diotisalvi Neroni at The Louvre, Paris", license: "BY-NC-SA", licenses: [] };
    expect(myminifactoryMetaFromObject(object).meta.license).toEqual({ id: "CC-BY-NC-SA-4.0", raw: "BY-NC-SA" });
    expect(myminifactoryMetaFromObject({ ...object, price: { value: 4.5, currency: "EUR" } }).meta.license?.id).toBe(
      "myminifactory-store",
    );
    expect(myminifactoryMetaFromObject({ id: 16357, name: "Skull" }).meta).not.toHaveProperty("license");
  });
});
