import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cgtraderModelFromPage, cgtraderProductFromScript } from "../../src/providers/cgtrader/api";
import {
  cgtraderLicense,
  cgtraderLicenseKeyFromNotes,
  readCgtraderLicense,
} from "../../src/providers/cgtrader/license";
import { forgetCgtraderWafToken } from "../../src/providers/cgtrader/waf";
import { html, installFetch, loadFixture, loadFixtureHtml, redirect, text, type FetchStub } from "./support";

vi.mock("node:dns/promises", () => ({
  default: {
    resolve4: async () => ["93.184.216.34"],
    resolve6: async () => {
      throw new Error("no AAAA");
    },
  },
}));

// CGTrader's licences as its model pages' pricing area names them -- the seven keys its own scripts know, recorded
// from the live site -- and as imports before the licence had a field of its own wrote them in the description.

const SLUG = "lotus-ring-with-opening-and-closing-mechanism";
const MODEL_PATH = `/free-3d-print-models/jewelry/ring/${SLUG}`;
const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "providers", "cgtrader", name), "utf8");

let stub: FetchStub | null = null;
afterEach(() => {
  stub?.restore();
  stub = null;
  forgetCgtraderWafToken();
});

describe("CGTrader licences", () => {
  it("maps each of its licence keys, and keeps one it doesn't know by its key", () => {
    expect(
      ["royalty_free", "royalty_free_no_ai", "editorial_royalty_free", "editorial", "editorial_no_ai", "custom"].map(
        (key) => cgtraderLicense(key)?.id,
      ),
    ).toEqual([
      "cgtrader-royalty-free",
      "cgtrader-royalty-free-no-ai",
      "cgtrader-royalty-free",
      "cgtrader-editorial",
      "cgtrader-editorial-no-ai",
      "cgtrader-custom",
    ]);
    expect(cgtraderLicense("custom_no_ai")).toEqual({ id: "cgtrader-custom-no-ai", raw: "custom_no_ai" });
    expect(cgtraderLicense("subscription_only")).toEqual({
      id: null,
      raw: "subscription_only",
      label: "subscription only",
    });
    expect(cgtraderLicense(null)).toBeNull();
    expect(cgtraderLicense("")).toBeNull();
  });

  it("takes a custom licence's own words as its terms, and none of the server's summaries", () => {
    const { royaltyFree, editorialNoAi } = loadFixture("cgtrader", "pricing-areas");
    // Recorded: a summary of the royalty free licence, and a stand-in for the summary it has none of.
    expect(cgtraderLicense(royaltyFree.license, royaltyFree.customLicense)).toEqual({
      id: "cgtrader-royalty-free",
      raw: "royalty_free",
    });
    expect(cgtraderLicense("custom_no_ai", editorialNoAi.customLicense)).toEqual({
      id: "cgtrader-custom-no-ai",
      raw: "custom_no_ai",
    });
    expect(cgtraderLicense("custom", royaltyFree.customLicense)).toEqual({ id: "cgtrader-custom", raw: "custom" });
    // A designer's own terms, as a custom licence's page carries them.
    expect(cgtraderLicense("custom", "<p>You may sell up to <b>50 prints</b>.</p><p>Credit me.</p>")).toEqual({
      id: "cgtrader-custom",
      raw: "custom",
      terms: "You may sell up to 50 prints.\n\nCredit me.",
    });
  });

  it("puts the page's licence in the model's details, and no longer writes it into the description", () => {
    const product = cgtraderProductFromScript(fixture("product-signed-out.txt"))!;
    const model = cgtraderModelFromPage(loadFixtureHtml("cgtrader", "model-page"), MODEL_PATH, product);
    expect(model?.meta.license).toEqual({ id: "cgtrader-royalty-free-no-ai", raw: "royalty_free_no_ai" });
    expect(model?.meta.description).toContain("## Model details");
    expect(model?.meta.description).not.toContain("**License:**");
  });

  it("reads the key an older import's description named, by its label or its spelled-out key", () => {
    const notes = (label: string) => `A ring.\n\n## Model details\n\n- **Units:** mm\n- **License:** ${label}`;
    expect(cgtraderLicenseKeyFromNotes(notes("Royalty free"))).toBe("royalty_free");
    expect(cgtraderLicenseKeyFromNotes(notes("Royalty free, not for AI training"))).toBe("royalty_free_no_ai");
    expect(cgtraderLicenseKeyFromNotes(notes("Editorial use only"))).toBe("editorial");
    expect(cgtraderLicenseKeyFromNotes(notes("Custom"))).toBe("custom");
    expect(cgtraderLicenseKeyFromNotes(notes("editorial no ai"))).toBe("editorial_no_ai");
    expect(cgtraderLicenseKeyFromNotes(notes("custom no ai"))).toBe("custom_no_ai");
    expect(cgtraderLicenseKeyFromNotes("A ring.\n\n## Model details\n\n- **Units:** mm")).toBeNull();
    expect(cgtraderLicenseKeyFromNotes(null)).toBeNull();
  });

  it("reads an older import's licence from its description with no request, and from its page otherwise", async () => {
    stub = installFetch(({ url }) => {
      if (url.hostname !== "www.cgtrader.com") return undefined;
      if (url.pathname === `/products/${SLUG}.js`) {
        return text(fixture("product-signed-out.txt"), 200, { "content-type": "text/javascript" });
      }
      if (url.pathname === `/products/${SLUG}`) return redirect(`https://www.cgtrader.com${MODEL_PATH}`, 301);
      if (url.pathname === MODEL_PATH) return html(loadFixtureHtml("cgtrader", "model-page"));
      return undefined;
    });
    const userId = "no-such-user";
    await expect(
      readCgtraderLicense(userId, SLUG, { notes: "## Model details\n\n- **License:** editorial no ai" }),
    ).resolves.toEqual({ id: "cgtrader-editorial-no-ai", raw: "editorial_no_ai" });
    expect(stub.calls).toHaveLength(0);

    await expect(readCgtraderLicense(userId, SLUG, { notes: "A ring." })).resolves.toEqual({
      id: "cgtrader-royalty-free-no-ai",
      raw: "royalty_free_no_ai",
    });
    expect(stub.calls.map((call) => call.url.pathname)).toEqual([
      `/products/${SLUG}.js`,
      `/products/${SLUG}`,
      MODEL_PATH,
    ]);

    // A custom licence's terms are only on its page; when that can't be read, the licence alone still is.
    stub.restore();
    stub = installFetch(() => new Response(null, { status: 500 }));
    await expect(readCgtraderLicense(userId, SLUG, { notes: "- **License:** Custom" })).resolves.toEqual({
      id: "cgtrader-custom",
      raw: "custom",
    });
    await expect(readCgtraderLicense(userId, SLUG, { notes: null })).rejects.toThrow(/HTTP 500/);
  });
});
