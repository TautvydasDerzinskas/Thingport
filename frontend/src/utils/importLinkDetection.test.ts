import { describe, expect, it } from "vitest";
import { detectImportProvider, hostIs, listLinkOf, modelLinkOf } from "./importLinkDetection";

describe("hostIs", () => {
  it("matches the domain and its subdomains, in any case", () => {
    expect(hostIs("makerworld.com", "makerworld.com")).toBe(true);
    expect(hostIs("www.makerworld.com", "makerworld.com")).toBe(true);
    expect(hostIs("MakerWorld.COM", "makerworld.com")).toBe(true);
  });

  it("doesn't match a look-alike that only ends in the same letters", () => {
    expect(hostIs("fake-makerworld.com", "makerworld.com")).toBe(false);
    expect(hostIs("evilmakerworld.com", "makerworld.com")).toBe(false);
    expect(hostIs("makerworld.com.evil.example", "makerworld.com")).toBe(false);
  });
});

describe("MakerWorld link detection", () => {
  it("recognises makerworld.com and its subdomains", () => {
    expect(detectImportProvider("https://makerworld.com/en/models/123")).toBe("makerworld");
    expect(detectImportProvider("https://www.makerworld.com/en/models/123")).toBe("makerworld");
    expect(modelLinkOf("https://makerworld.com/en/models/123")?.provider).toBe("makerworld");
    expect(listLinkOf("https://makerworld.com/en/collections/456")?.provider).toBe("makerworld");
  });

  it("doesn't take a look-alike domain for MakerWorld", () => {
    for (const host of ["fake-makerworld.com", "evilmakerworld.com"]) {
      expect(detectImportProvider(`https://${host}/models/1`)).toBeNull();
      expect(modelLinkOf(`https://${host}/models/1`)).toBeNull();
      expect(listLinkOf(`https://${host}/collections/1`)).toBeNull();
    }
  });
});

type Kind = "model" | "list" | null;
type FixtureExpectation = {
  provider: string | null;
  kind: Kind;
  externalId?: string;
  requestedProfileId?: string | null;
  listKind?: string;
};
type UrlFixture = {
  url: string;
  expect: FixtureExpectation;
  divergent?: { frontend?: Partial<FixtureExpectation> | null };
};

function classifyFrontend(url: string): Pick<FixtureExpectation, "provider" | "kind" | "listKind"> {
  const model = modelLinkOf(url);
  if (model) return { provider: model.provider, kind: "model" };
  const list = listLinkOf(url);
  if (list) return { provider: list.provider, kind: "list", listKind: list.kind };
  return { provider: null, kind: null };
}

const fixtureModules = import.meta.glob("../../../providers/*/urls.fixtures.json", {
  eager: true,
  import: "default",
}) as Record<string, UrlFixture[]>;
const fixtures = Object.entries(fixtureModules).flatMap(([path, providerFixtures]) => {
  const provider = path.split("/").at(-2) ?? "unknown";
  return providerFixtures.map((fixture) => ({ provider, ...fixture }));
});

describe("provider URL fixtures", () => {
  it("loads provider fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures.map((fixture) => [fixture.provider, fixture.url, fixture] as const))(
    "%s: %s",
    (_provider, _url, fixture) => {
      const actual = classifyFrontend(fixture.url);
      const frontendOverride = fixture.divergent?.frontend;
      const expected =
        frontendOverride === null
          ? { provider: null, kind: null }
          : {
              provider:
                frontendOverride && "provider" in frontendOverride
                  ? frontendOverride.provider
                  : fixture.expect.provider,
              kind: frontendOverride && "kind" in frontendOverride ? frontendOverride.kind : fixture.expect.kind,
              ...(frontendOverride?.listKind !== undefined || fixture.expect.listKind !== undefined
                ? {
                    listKind:
                      frontendOverride && "listKind" in frontendOverride
                        ? frontendOverride.listKind
                        : fixture.expect.listKind,
                  }
                : {}),
            };
      expect(actual).toEqual(expected);
    },
  );
});
