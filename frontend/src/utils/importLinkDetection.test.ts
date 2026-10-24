import { describe, expect, it } from "vitest";
import { detectImportProvider, hostIs, isMakerworldCollectionUrl, isMakerworldModelUrl } from "./importLinkDetection";

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
