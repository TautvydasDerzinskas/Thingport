import { describe, expect, it } from "vitest";
import { inFolder } from "./fileExtensions";

describe("inFolder", () => {
  it("puts a file's folder before its name, and leaves a file at the top as it is", () => {
    expect(inFolder("guide.pdf", "docs/extra")).toBe("docs/extra/guide.pdf");
    expect(inFolder("guide.pdf", null)).toBe("guide.pdf");
    expect(inFolder("guide.pdf", "")).toBe("guide.pdf");
  });
});
