import { describe, expect, it } from "vitest";
import { TOOL_FONTS, TOOL_FONT_URLS } from "./fonts";

// The typefaces reach a tool through a glob of `assets/toolFonts`, and a glob that matches nothing is silent: it
// builds, it ships, and the first tool to ask for a typeface is the one that finds out. These two checks are what
// stands between that and a tool that hangs on "getting the font".
describe("the tool typefaces", () => {
  it("has the file every typeface in the list names", () => {
    const missing = TOOL_FONTS.filter((font) => !TOOL_FONT_URLS.has(font.id)).map((font) => font.id);
    expect(missing).toEqual([]);
    expect(TOOL_FONT_URLS.size).toBeGreaterThan(0);
  });

  it("lists every file it carries, so none is dead weight", () => {
    const named = new Set(TOOL_FONTS.map((font) => font.id));
    expect([...TOOL_FONT_URLS.keys()].filter((id) => !named.has(id))).toEqual([]);
  });
});
