import { describe, expect, it } from "vitest";
import {
  detectImportProvider,
  hostIs,
  isCults3dListUrl,
  isCults3dModelUrl,
  isCrealitycloudListUrl,
  isCrealitycloudModelUrl,
  isMakeronlineListUrl,
  isMakeronlineModelUrl,
  isMakerworldCollectionUrl,
  isMakerworldModelUrl,
  isMyminifactoryCollectionUrl,
  isMyminifactoryObjectUrl,
  isNexprintCollectionUrl,
  isNexprintModelUrl,
  isPrintablesCollectionUrl,
  isPrintablesModelUrl,
  isSnapmakerListUrl,
  isSnapmakerModelUrl,
  isThangsListUrl,
  isThangsModelUrl,
  isThingiverseCollectionUrl,
  isThingiverseLikesUrl,
  isThingiverseThingUrl,
} from "./importLinkDetection";

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
    expect(isMakerworldModelUrl("https://makerworld.com/en/models/123")).toBe(true);
    expect(isMakerworldCollectionUrl("https://makerworld.com/en/collections/456")).toBe(true);
  });

  it("doesn't take a look-alike domain for MakerWorld", () => {
    for (const host of ["fake-makerworld.com", "evilmakerworld.com"]) {
      expect(detectImportProvider(`https://${host}/models/1`)).toBeNull();
      expect(isMakerworldModelUrl(`https://${host}/models/1`)).toBe(false);
      expect(isMakerworldCollectionUrl(`https://${host}/collections/1`)).toBe(false);
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

const providerParsers = {
  makerworld: { model: isMakerworldModelUrl, list: isMakerworldCollectionUrl },
  thingiverse: {
    model: isThingiverseThingUrl,
    list: (url: string) => isThingiverseCollectionUrl(url) || isThingiverseLikesUrl(url),
  },
  printables: { model: isPrintablesModelUrl, list: isPrintablesCollectionUrl },
  myminifactory: { model: isMyminifactoryObjectUrl, list: isMyminifactoryCollectionUrl },
  snapmaker: { model: isSnapmakerModelUrl, list: isSnapmakerListUrl },
  makeronline: { model: isMakeronlineModelUrl, list: isMakeronlineListUrl },
  crealitycloud: { model: isCrealitycloudModelUrl, list: isCrealitycloudListUrl },
  nexprint: { model: isNexprintModelUrl, list: isNexprintCollectionUrl },
  thangs: { model: isThangsModelUrl, list: isThangsListUrl },
  cults3d: { model: isCults3dModelUrl, list: isCults3dListUrl },
} satisfies Record<string, { model: (url: string) => boolean; list: (url: string) => boolean }>;

function classifyFrontend(url: string): Pick<FixtureExpectation, "provider" | "kind" | "listKind"> {
  const provider = detectImportProvider(url);
  if (!provider) return { provider: null, kind: null };
  const parsers = providerParsers[provider];
  if (parsers.model(url)) return { provider, kind: "model" };
  if (parsers.list(url)) {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    let listKind = "collection";
    if (provider === "snapmaker") listKind = parsed.searchParams.get("list") ?? "collection";
    else if (provider === "thingiverse" && isThingiverseLikesUrl(url)) listKind = "likes";
    else if (provider === "makeronline" && /\/likes\/models/i.test(parsed.pathname)) listKind = "likes";
    else if (provider === "crealitycloud" && /\/user\/\d+\/likes/i.test(parsed.pathname)) listKind = "likes";
    else if (provider === "thangs" && /\/mythangs\/liked-models/i.test(parsed.pathname)) listKind = "likes";
    else if (provider === "cults3d" && /\/likes\/?$/i.test(decodeURIComponent(parsed.pathname))) listKind = "likes";
    return { provider, kind: "list", listKind };
  }
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

// Known difference: Printables likes are missed; the fixture records it as an override.
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
