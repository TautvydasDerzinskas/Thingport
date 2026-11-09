import { afterEach, describe, expect, it, vi } from "vitest";
import { IMPORT_HTML_MAX_BYTES } from "../../src/config";
import { resolveThingiverseThing } from "../../src/providers/thingiverse/api";
import { thingiverseLicenseFrom, thingiverseLicenseFromPage } from "../../src/providers/thingiverse/license";
import { readThingiverseLicense } from "../../src/providers/thingiverse/licenseReader";
import { setThingiverseAccessToken } from "../../src/providers/thingiverse/token";
import { loadFixtureHtml } from "./support";

// Thingiverse's licences: its API names them, its public pages link them in their structured data (recorded pages,
// trimmed to that data). The API's names are as its schema documents them.

afterEach(async () => {
  vi.unstubAllGlobals();
  await setThingiverseAccessToken(null);
});

describe("Thingiverse licences", () => {
  it("reads the names its API gives, Creative Commons ones as 4.0 as its pages link them", () => {
    const names: [string, string][] = [
      ["Creative Commons - Attribution", "CC-BY-4.0"],
      ["Creative Commons - Attribution - Share Alike", "CC-BY-SA-4.0"],
      ["Creative Commons - Attribution - No Derivatives", "CC-BY-ND-4.0"],
      ["Creative Commons - Attribution - Non-Commercial", "CC-BY-NC-4.0"],
      ["Creative Commons - Attribution - Non-Commercial - Share Alike", "CC-BY-NC-SA-4.0"],
      ["Creative Commons - Attribution - Non-Commercial - No Derivatives", "CC-BY-NC-ND-4.0"],
      ["Attribution - Non-Commercial - Share Alike", "CC-BY-NC-SA-4.0"],
      ["Creative Commons - Public Domain Dedication", "CC0-1.0"],
      ["Public Domain", "public-domain"],
      ["GNU - GPL", "GPL-3.0"],
      ["GNU - LGPL", "LGPL-3.0"],
      ["BSD License", "BSD-2-Clause"],
    ];
    for (const [raw, id] of names) expect(thingiverseLicenseFrom({ license: raw })).toEqual({ id, raw });
  });

  it("keeps a name it doesn't know as its label, and tells none from a read without the field", () => {
    expect(thingiverseLicenseFrom({ license: "Nokia" })).toEqual({ id: null, raw: "Nokia", label: "Nokia" });
    expect(thingiverseLicenseFrom({ license: "" })).toBeNull();
    expect(thingiverseLicenseFrom({ license: null })).toBeNull();
    expect(thingiverseLicenseFrom({ name: "Thing" })).toBeUndefined();
  });

  it("takes remixing away from a Thing whose creator turned it off", () => {
    expect(thingiverseLicenseFrom({ license: "Creative Commons - Attribution", allows_derivatives: false })).toEqual({
      id: "CC-BY-4.0",
      raw: "Creative Commons - Attribution",
      allows: ["share", "commercial"],
    });
    expect(
      thingiverseLicenseFrom({ license: "Creative Commons - Attribution - No Derivatives", allows_derivatives: false }),
    ).toEqual({ id: "CC-BY-ND-4.0", raw: "Creative Commons - Attribution - No Derivatives" });
  });

  it("reads the link on a Thing's public page", () => {
    const pages: [string, string][] = [
      ["763622", "CC0-1.0"],
      ["1015238", "CC-BY-NC-4.0"],
      ["2187167", "CC-BY-4.0"],
      ["6800000", "CC-BY-NC-ND-4.0"],
      ["100", "public-domain"],
      ["1450", "GPL-3.0"],
    ];
    for (const [thingId, id] of pages) {
      expect(thingiverseLicenseFromPage(loadFixtureHtml("thingiverse", `license-page-${thingId}`))?.id).toBe(id);
    }
    expect(thingiverseLicenseFromPage(loadFixtureHtml("thingiverse", "license-page-2187167"))).toEqual({
      id: "CC-BY-4.0",
      raw: "http://creativecommons.org/licenses/by/4.0/",
    });
    // A Thing it doesn't have: the site's own page, without the data.
    expect(thingiverseLicenseFromPage(loadFixtureHtml("thingiverse", "license-page-missing"))).toBeUndefined();
  });

  it("puts the API's in the Thing's metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const { pathname } = new URL(url);
        if (pathname === "/things/1015238") {
          return Response.json({
            id: 1015238,
            name: "EEZYbotARM",
            license: "Creative Commons - Attribution - Non-Commercial",
            allows_derivatives: true,
          });
        }
        return Response.json([]);
      }),
    );
    const resolved = await resolveThingiverseThing("1015238", "app-token");
    expect(resolved?.meta.license).toEqual({
      id: "CC-BY-NC-4.0",
      raw: "Creative Commons - Attribution - Non-Commercial",
    });
  });

  it("reads an older import's with the App Token, in one request", async () => {
    await setThingiverseAccessToken("app-token");
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        const { pathname } = new URL(url);
        if (pathname === "/things/1015238") {
          return Response.json({ id: 1015238, license: "Creative Commons - Attribution - Non-Commercial" });
        }
        if (pathname === "/things/1015239") return Response.json({ id: 1015239 });
        if (pathname === "/things/1450") return Response.json({ error: "Unauthorized" }, { status: 401 });
        if (url === "https://www.thingiverse.com/thing:1450") {
          return new Response(loadFixtureHtml("thingiverse", "license-page-1450"), {
            headers: { "content-type": "text/html" },
          });
        }
        return Response.json({ error: "Not Found" }, { status: 404 });
      }),
    );
    expect(await readThingiverseLicense("user-1", "1015238", { notes: null })).toEqual({
      id: "CC-BY-NC-4.0",
      raw: "Creative Commons - Attribution - Non-Commercial",
    });
    expect(calls).toEqual(["https://api.thingiverse.com/things/1015238?access_token=app-token"]);
    expect(await readThingiverseLicense("user-1", "404", { notes: null })).toBeNull();
    // A Thing answered without the field can't tell: read again later.
    expect(await readThingiverseLicense("user-1", "1015239", { notes: null })).toBeUndefined();
    // A token it turns down: read off the public page instead.
    expect(await readThingiverseLicense("user-1", "1450", { notes: null })).toEqual({
      id: "GPL-3.0",
      raw: "https://www.gnu.org/licenses/gpl-3.0.en.html",
    });
  });

  it("reads it off the public page without a token, and throws when Cloudflare stops it", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url === "https://www.thingiverse.com/thing:1450") {
          return new Response(loadFixtureHtml("thingiverse", "license-page-1450"), {
            headers: { "content-type": "text/html" },
          });
        }
        if (url === "https://www.thingiverse.com/thing:9002") {
          // Cut off after a Product without a licence: one with it could have come further on.
          const first = `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "x" })}</script>`;
          return new Response(`<html><head>${first}</head><body>${"x".repeat(IMPORT_HTML_MAX_BYTES)}</body></html>`, {
            headers: { "content-type": "text/html" },
          });
        }
        if (url === "https://www.thingiverse.com/thing:9001") {
          return new Response(`<html><body>${"x".repeat(IMPORT_HTML_MAX_BYTES + 1024)}</body></html>`, {
            headers: { "content-type": "text/html" },
          });
        }
        if (url === "https://www.thingiverse.com/thing:9000") {
          return new Response(loadFixtureHtml("thingiverse", "license-page-missing"), {
            headers: { "content-type": "text/html" },
          });
        }
        return new Response("Just a moment...", { status: 403, headers: { "cf-mitigated": "challenge" } });
      }),
    );
    expect(await readThingiverseLicense("user-1", "1450", { notes: null })).toEqual({
      id: "GPL-3.0",
      raw: "https://www.gnu.org/licenses/gpl-3.0.en.html",
    });
    expect(calls[0]).toBe("https://www.thingiverse.com/thing:1450");
    // A page without the Thing's data can't tell: read again later, rather than kept as none.
    expect(await readThingiverseLicense("user-1", "9000", { notes: null })).toBeUndefined();
    // One cut off before its data is a read that failed.
    await expect(readThingiverseLicense("user-1", "9001", { notes: null })).rejects.toThrow(/cut off/);
    await expect(readThingiverseLicense("user-1", "9002", { notes: null })).rejects.toThrow(/cut off/);
    await expect(readThingiverseLicense("user-1", "1015238", { notes: null })).rejects.toThrow(/Cloudflare/);
  });
});
