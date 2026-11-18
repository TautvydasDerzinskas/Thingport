import { describe, expect, it } from "vitest";
import { extnameOf, inFolder, withExtensionOf } from "./fileExtensions";

describe("inFolder", () => {
  it("puts a file's folder before its name, and leaves a file at the top as it is", () => {
    expect(inFolder("guide.pdf", "docs/extra")).toBe("docs/extra/guide.pdf");
    expect(inFolder("guide.pdf", null)).toBe("guide.pdf");
    expect(inFolder("guide.pdf", "")).toBe("guide.pdf");
  });
});

describe("a file's extension as the server reads it", () => {
  it("has none for a name that is all extension, and keeps one a new name leaves out", () => {
    expect(extnameOf("guide.pdf")).toBe(".pdf");
    expect(extnameOf(".pdf")).toBe("");
    expect(extnameOf("docs/notes")).toBe("");
    expect(withExtensionOf("Setup", "guide.pdf")).toBe("Setup.pdf");
    expect(withExtensionOf("Setup.txt", "guide.pdf")).toBe("Setup.txt");
  });
});
