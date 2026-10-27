import { describe, expect, it } from "vitest";
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

  // Snapshotted at a fixed version, so a release bumping package.json doesn't break them.
  for (const target of TARGETS) {
    it(`${target} manifest`, () => {
      expect(buildManifest(target, { ...pkg, version: "0.0.0" })).toMatchSnapshot();
      expect(buildManifest(target, pkg).version).toBe(pkg.version);
    });
  }
});
