import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { modelUpload } from "../src/uploadMiddleware";
import { buildImportFilename, parseContentDisposition, sanitizeFilename } from "../src/utils/fileUtils";

// MakerWorld's CDN puts raw UTF-8 in the ISO-8859-1 `filename=` parameter; the repair must leave a
// genuine Latin-1 name untouched.

const headers = (cd: string) => new Headers({ "content-disposition": cd });

describe("parseContentDisposition", () => {
  it("recovers UTF-8 bytes delivered through the Latin-1 plain filename parameter", () => {
    const mangled = Buffer.from("哨子.3mf", "utf8").toString("latin1");
    expect(parseContentDisposition(`attachment; filename="${mangled}"`)).toBe("哨子.3mf");
  });

  it("leaves a genuinely Latin-1 filename alone", () => {
    expect(parseContentDisposition('attachment; filename="café.stl"')).toBe("café.stl");
  });

  it("still prefers the filename*= form, which names its own charset", () => {
    expect(parseContentDisposition("attachment; filename*=UTF-8''%E5%93%A8%E5%AD%90.3mf")).toBe("哨子.3mf");
  });

  it("is unchanged for plain ASCII", () => {
    expect(parseContentDisposition('attachment; filename="widget.stl"')).toBe("widget.stl");
    expect(parseContentDisposition(null)).toBeNull();
    expect(parseContentDisposition("attachment")).toBeNull();
  });

  it("reads a quoted filename containing a semicolon or an escaped quote", () => {
    expect(parseContentDisposition('attachment; filename="Bracket;v2.stl"')).toBe("Bracket;v2.stl");
    expect(parseContentDisposition('attachment; filename="Bracket \\"v2\\".stl"')).toBe('Bracket "v2".stl');
  });

  it("decodes filename* in ISO-8859-1, and with a language tag", () => {
    expect(parseContentDisposition("attachment; filename*=ISO-8859-1''caf%E9.stl")).toBe("café.stl");
    expect(parseContentDisposition("attachment; filename*=UTF-8'en'%E2%82%AC%20rates.stl")).toBe("€ rates.stl");
    expect(
      parseContentDisposition("attachment; filename=\"EURO rates.stl\"; filename*=utf-8'en'%e2%82%ac%20rates.stl"),
    ).toBe("€ rates.stl");
  });

  it("falls back to filename when filename* can't be decoded", () => {
    expect(parseContentDisposition("attachment; filename=\"ete.stl\"; filename*=UTF-8''%E9t%E9.stl")).toBe("ete.stl");
    expect(parseContentDisposition("attachment; filename=\"cafe.stl\"; filename*=windows-1252''caf%E9.stl")).toBe(
      "cafe.stl",
    );
    // A "%" without two hex digits after it is invalid in any charset, though ISO-8859-1 decodes around it.
    expect(parseContentDisposition("attachment; filename=\"good.3mf\"; filename*=ISO-8859-1''bad%GG.stl")).toBe(
      "good.3mf",
    );
    expect(parseContentDisposition("attachment; filename*=ISO-8859-1''100%25.stl")).toBe("100%.stl");
  });

  it("still reads a filename from headers missing the disposition type or a closing quote", () => {
    expect(parseContentDisposition("filename=widget.stl")).toBe("widget.stl");
    expect(parseContentDisposition('attachment; filename="widget.stl')).toBe("widget.stl");
  });
});

describe("sanitizeFilename", () => {
  it("strips C1 control characters, not just NUL", () => {
    // Mis-decoded C1 characters get rejected by cloud storage.
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
    const name = buildImportFilename("https://example.invalid/download", headers(`attachment; filename="${mangled}"`));
    expect(name).toBe("哨子.3mf");
    // oxlint-disable-next-line no-control-regex -- asserting there are no control chars is the point here.
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(name)).toBe(false);
  });

  it("keeps a quoted filename's extension past a semicolon in the name", () => {
    const octetStream = new Headers({
      "content-disposition": 'attachment; filename="Bracket;v2.stl"',
      "content-type": "application/octet-stream",
    });
    expect(buildImportFilename("https://example.invalid/download/42", octetStream)).toBe("Bracket;v2.stl");
  });
});

describe("parseContentDisposition with already-decoded input", () => {
  it("leaves a string with characters above U+00FF alone", () => {
    // Not a byte string, and latin1 would truncate `哨`.
    expect(parseContentDisposition('attachment; filename="café哨.stl"')).toBe("café哨.stl");
  });
});

describe("modelUpload", () => {
  it("decodes a browser's raw UTF-8 multipart filename as UTF-8, not Latin-1", async () => {
    const app = express();
    app.post("/upload", modelUpload.single("file"), (req, res) => {
      res.json({ name: sanitizeFilename(req.file?.originalname) });
    });
    const res = await request(app)
      .post("/upload")
      .attach("file", Buffer.from("solid x\nendsolid x\n"), { filename: "哨子.stl", contentType: "model/stl" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("哨子.stl");
  });
});
