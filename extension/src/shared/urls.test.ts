import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyUrl } from "./urls.js";

type UrlExpectation = {
  provider: string | null;
  kind: "model" | "list" | null;
  listKind?: string;
};

type UrlFixture = {
  url: string;
  expect: UrlExpectation;
  divergent?: { extension?: Partial<UrlExpectation> | null };
};

const providersDir = resolve(fileURLToPath(new URL("../../../providers", import.meta.url)));
const providers = (await readdir(providersDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();
const fixtureSets = await Promise.all(
  providers.map(async (provider) => ({
    provider,
    fixtures: JSON.parse(await readFile(resolve(providersDir, provider, "urls.fixtures.json"), "utf8")) as UrlFixture[],
  })),
);

// Known differences: Printables likes are missed, and an ambiguous Snapmaker interactions page defaults to likes.
describe("provider URL fixtures", () => {
  it("loads provider fixture sets", () => {
    expect(fixtureSets.length).toBeGreaterThan(0);
  });

  for (const { provider, fixtures } of fixtureSets) {
    describe(provider, () => {
      for (const fixture of fixtures) {
        it(fixture.url, () => {
          const extensionExpectation = fixture.divergent?.extension;
          const actual = classifyUrl(fixture.url);

          if (extensionExpectation === null) {
            expect(actual).toBeNull();
            return;
          }

          const expected = { ...fixture.expect, ...extensionExpectation };
          const expectedProvider = expected.provider;
          const expectedKind = expected.kind;
          const expectedListKind = expected.listKind;
          expect(actual?.provider ?? null).toBe(expectedProvider);
          expect(actual ? (actual.kind === "single" ? "model" : "list") : null).toBe(expectedKind);
          if (expectedKind === "list" && expectedListKind !== undefined) {
            expect(actual?.kind === "batch" ? actual.type : null).toBe(expectedListKind);
          }
        });
      }
    });
  }
});
