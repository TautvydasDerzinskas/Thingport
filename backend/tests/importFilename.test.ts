import { describe, expect, it } from "vitest";
import { buildImportFilename, parseContentDisposition, sanitizeFilename } from "../src/utils/fileUtils";

// HTTP header values are ISO-8859-1 (RFC 7230 section 3.2.4). A server that puts raw UTF-8 bytes
// in the plain `filename=` parameter therefore arrives as one character per byte, and MakerWorld's
// CDN does exactly that -- which wrote `å<93>¨å­<90>.3mf` to disk for a model called `哨子`.
// The repair has to be conditional, because a genuinely Latin-1 filename must survive untouched.

const headers = (cd: string) => new Headers({ "content-disposition": cd });

describe("parseContentDisposition", () => {
  it("recovers UTF-8 bytes delivered through the Latin-1 plain filename parameter", () => {
    const mangled = Buffer.from("哨子.3mf", "utf8").toString("latin1");
    expect(parseContentDisposition(`attachment; filename="${mangled}"`)).toBe("哨子.3mf");
  });

  it("leaves a genuinely Latin-1 filename alone", () => {
    // `café.stl` in Latin-1 is not valid UTF-8, so it must not be re-decoded.
    expect(parseContentDisposition('attachment; filename="café.stl"')).toBe("café.stl");
  });

  it("still prefers the filename*= form, which names its own charset", () => {
    expect(parseContentDisposition("attachment; filename*=UTF-8''%E5%93%A8%E5%AD%90.3mf")).toBe(
      "哨子.3mf",
    );
  });

  it("is unchanged for plain ASCII", () => {
    expect(parseContentDisposition('attachment; filename="widget.stl"')).toBe("widget.stl");
    expect(parseContentDisposition(null)).toBeNull();
    expect(parseContentDisposition("attachment")).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("strips C1 control characters, not just NUL", () => {
    // U+0080-U+009F are what a mis-decoded header leaves behind; they reach the filesystem
    // happily and are then rejected by cloud storage.
    expect(sanitizeFilename("we\u0080ird\u009dname.stl")).toBe("weirdname.stl");
    expect(sanitizeFilename("tab\tseparated.stl")).toBe("tabseparated.stl");
  });

  it("keeps the existing behaviour for separators and empties", () => {
    expect(sanitizeFilename("a/b\\c.stl")).toBe("a_b_c.stl");
    expect(sanitizeFilename("   ")).toBe("imported-file");
    expect(sanitizeFilename(null)).toBe("imported-file");
  });
});

describe("buildImportFilename", () => {
  it("writes a correctly encoded name for a MakerWorld-style download", () => {
    const mangled = Buffer.from("哨子.3mf", "utf8").toString("latin1");
    const name = buildImportFilename(
      "https://example.invalid/download",
      headers(`attachment; filename="${mangled}"`),
    );
    expect(name).toBe("哨子.3mf");
    // oxlint-disable-next-line no-control-regex -- asserting there are no control chars is the point here.
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(name)).toBe(false);
  });
});
