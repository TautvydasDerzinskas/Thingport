import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };
import { buildManifest, COOKIE_HOSTS, PROVIDER_MATCHES, TARGETS } from "./manifest.js";

describe("browser manifests", () => {
  // Browsers compare these as sets: their order is free, a site more or less disables Grab for everyone.
  it("keeps the built-in sites and cookie hosts", () => {
    expect(PROVIDER_MATCHES.toSorted()).toEqual([
      "*://*.makerworld.com/*",
      "*://*.printables.com/*",
      "*://*.thingiverse.com/*",
    ]);
    expect(COOKIE_HOSTS.toSorted()).toEqual(["*://*.makerworld.com/*", "*://*.printables.com/*"]);
  });

  // Instances on plain HTTP have to keep working, so no build may upgrade requests to https (issue #199).
  it("never upgrades http requests", () => {
    for (const target of TARGETS) {
      expect(JSON.stringify(buildManifest(target, pkg))).not.toContain("upgrade-insecure-requests");
    }
    expect(buildManifest("firefox", pkg).content_security_policy).toEqual({ extension_pages: "script-src 'self'" });
  });

  // Chrome refuses a manifest whose description, in any language, runs past 132 characters.
  it("keeps every translated description within 132 characters", () => {
    const locales = new URL("../public/_locales/", import.meta.url);
    const names = readdirSync(locales);
    expect(names.length).toBeGreaterThan(1);
    for (const locale of names) {
      const messages = JSON.parse(readFileSync(new URL(`${locale}/messages.json`, locales), "utf8"));
      const description: string = messages.extensionDescription.message;
      expect([...description].length, locale).toBeLessThanOrEqual(132);
    }
  });

  // Snapshotted at a fixed version, so a release bumping package.json doesn't break them.
  for (const target of TARGETS) {
    it(`${target} manifest`, () => {
      expect(buildManifest(target, { ...pkg, version: "0.0.0" })).toMatchSnapshot();
      expect(buildManifest(target, pkg).version).toBe(pkg.version);
    });
  }
});
