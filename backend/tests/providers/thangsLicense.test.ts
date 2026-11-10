import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveThangsModel } from "../../src/providers/thangs/api";
import { THANGS_TERMS_MAX, thangsLicenseFileName, thangsLicenseFrom } from "../../src/providers/thangs/license";
import { loadFixture } from "./support";

// Thangs' licences: a file the designer uploads, named by its path on the model, and its text as Thangs hands it out
// (/v2/models/<id>/license). Recorded answers, trimmed.

afterEach(() => {
  vi.unstubAllGlobals();
});

const text = (name: string): string => loadFixture<{ licenseText: string }>("thangs", name).licenseText;

describe("Thangs licences", () => {
  it("names the file without the folders it's kept in", () => {
    expect(thangsLicenseFileName("dd40e756-fae2-4afc-867b-a11aaf6457bb/Personal use only.txt")).toBe(
      "Personal use only",
    );
    expect(
      thangsLicenseFileName(
        "47024fc3-3f19-4cce-a3f1-a86f2feaa19e/01b81b97-02c6-40cc-adb4-7230bfa9d46f/license-cc-attribution-noncommercial",
      ),
    ).toBe("license-cc-attribution-noncommercial");
    expect(
      thangsLicenseFileName("b0b4f910/MULTIBOARD_LICENCE_-_Download_Terms_and_Conditions_-_12-June-2024.pdf"),
    ).toBe("MULTIBOARD_LICENCE_-_Download_Terms_and_Conditions_-_12-June-2024");
  });

  it("tells the licence by the file's name", () => {
    const names: [string, string][] = [
      ["587c25cb/Standard_Digital_File_License.txt", "sdfl"],
      ["f187ac3f/StandardDigitalFileLicense.txt", "sdfl"],
      ["9cb30bee/Standard Digital File License.txt", "sdfl"],
      ["55640559/MIT License.txt", "MIT"],
      ["c75701a4/CC BY-NC-ND 4.pdf", "CC-BY-NC-ND-4.0"],
      ["1416a0a2/cc-by-nc-sa license.txt", "CC-BY-NC-SA-4.0"],
      ["67a5f226/legalcode CC_BY_NC_SA_4.txt", "CC-BY-NC-SA-4.0"],
      ["55af06dd/Attribution-NonCommercial-NoDerivs 4.0 International.pdf", "CC-BY-NC-ND-4.0"],
      ["b5b148fc/98256f79/Attribution 4.0 International\u00a0(CC BY", "CC-BY-4.0"],
      ["47024fc3/01b81b97/license-cc-attribution-noncommercial", "CC-BY-NC-4.0"],
    ];
    expect(names.map(([path]) => [path, thangsLicenseFrom(path, null)?.id])).toEqual(names);
  });

  it("keeps the text, and reads the licence off it when the name says nothing", () => {
    expect(
      thangsLicenseFrom(
        "587c25cb-e1ee-4079-8dcb-07424a2b8974/Standard_Digital_File_License.txt",
        text("license-text-sdfl"),
      ),
    ).toEqual({
      id: "sdfl",
      raw: "587c25cb-e1ee-4079-8dcb-07424a2b8974/Standard_Digital_File_License.txt",
      label: "Standard_Digital_File_License",
      terms: text("license-text-sdfl").trim(),
    });
    const mit = thangsLicenseFrom("56976639-92f8-4c99-b23f-e1ec4ba65e61/LICENSE.txt", text("license-text-mit"));
    expect(mit).toMatchObject({ id: "MIT", label: "LICENSE" });
    expect(mit?.terms).toMatch(/^MIT License\n\nCopyright \(c\) 2023 A Maker\n\nPermission is hereby granted/);
  });

  it("turns an uploaded web page into its text, and vouches for no licence its name and text disagree on", () => {
    // Named NoDerivs, while the page uploaded is the NonCommercial one's: which applies isn't for Thingport to say.
    const license = thangsLicenseFrom(
      "63edc669-7e29-4703-b665-a1419123f4e7/license-Attribution-NonCommercial-NoDerivs 4.0 International.txt",
      text("license-text-legalcode"),
    );
    expect(license).toMatchObject({
      id: null,
      label: "license-Attribution-NonCommercial-NoDerivs 4.0 International",
      allows: [],
    });
    expect(license?.terms).toMatch(/^Legal Code - Attribution-NonCommercial 4\.0 International/);
    expect(license?.terms).toContain("Section 1 – Definitions.");
    expect(license?.terms).not.toMatch(/<[a-z]|margin: 0/);
    // A page whose name says nothing: its title does.
    expect(thangsLicenseFrom("abc/License.txt", text("license-text-legalcode"))?.id).toBe("CC-BY-NC-4.0");
  });

  it("vouches for no licence a file is named after when its text doesn't bear it out", () => {
    const own = thangsLicenseFrom("55640559/MIT License.txt", "Personal use only. Do not share or sell these files.");
    expect(own).toMatchObject({ id: null, label: "MIT License", allows: [] });
    expect(own?.terms).toBe("Personal use only. Do not share or sell these files.");
  });

  it("allows nothing by one it can't tell, and cuts a long text", () => {
    expect(thangsLicenseFrom("dd40e756-fae2-4afc-867b-a11aaf6457bb/Personal use only.txt", null)).toEqual({
      id: null,
      raw: "dd40e756-fae2-4afc-867b-a11aaf6457bb/Personal use only.txt",
      label: "Personal use only",
      terms: null,
      allows: [],
    });
    const long = thangsLicenseFrom("x/Terms.txt", `My terms.\n${"No reselling. ".repeat(3000)}`);
    expect(long?.terms).toHaveLength(THANGS_TERMS_MAX);
    expect(long?.terms?.endsWith("…")).toBe(true);
  });

  it("says none for a model without a file, and leaves out a read without the field", () => {
    expect(thangsLicenseFrom(null, null)).toBeNull();
    expect(thangsLicenseFrom("", null)).toBeNull();
    expect(thangsLicenseFrom(undefined, null)).toBeUndefined();
  });

  describe("on a model it reads", () => {
    const model = loadFixture("thangs", "license-model");

    function stub(licenseAnswer: () => Response, overrides: Record<string, unknown> = {}): string[] {
      const calls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          calls.push(new URL(url).pathname);
          if (url === "https://thangs.com/api/models/v2/1648126?likes=false")
            return Response.json({ ...model, ...overrides });
          if (url === "https://thangs.com/api/v2/models/1648126/license") return licenseAnswer();
          return new Response("Not Found", { status: 404 });
        }),
      );
      return calls;
    }

    it("reads the file's text with the model", async () => {
      const calls = stub(() => Response.json(loadFixture("thangs", "license-text-legalcode")));
      const license = (await resolveThangsModel("1648126"))?.meta.license;
      // Its name and its text disagree (NoDerivs, NonCommercial): kept, allowing nothing.
      expect(license).toMatchObject({
        id: null,
        raw: model.license,
        label: "license-Attribution-NonCommercial-NoDerivs 4.0 International",
      });
      expect(license?.terms).toMatch(/^Legal Code/);
      expect(calls).toEqual(["/api/models/v2/1648126", "/api/v2/models/1648126/license"]);
    });

    it("keeps the name when Thangs has no text for the file", async () => {
      stub(() => new Response("File not found", { status: 404 }));
      expect((await resolveThangsModel("1648126"))?.meta.license).toMatchObject({ id: "CC-BY-NC-ND-4.0", terms: null });
    });

    it("leaves it out when the text can't be read now, so it's read again later", async () => {
      stub(() => new Response("upstream down", { status: 502 }));
      const resolved = await resolveThangsModel("1648126");
      expect(resolved?.meta.title).toBe(model.name);
      expect(resolved?.meta).not.toHaveProperty("license");
    });

    it("asks for no text for a model without a file", async () => {
      const calls = stub(() => Response.json({ licenseText: "unused" }), { license: null });
      expect((await resolveThangsModel("1648126"))?.meta.license).toBeNull();
      expect(calls).toEqual(["/api/models/v2/1648126"]);
    });
  });
});
