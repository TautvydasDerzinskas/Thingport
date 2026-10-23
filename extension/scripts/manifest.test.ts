import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { buildManifest, TARGETS } from "./manifest.js";

describe("browser manifests", () => {
  for (const target of TARGETS) {
    it(`${target} manifest`, () => {
      expect(buildManifest(target, pkg)).toMatchSnapshot();
    });
  }
});
