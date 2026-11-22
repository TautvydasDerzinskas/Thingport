import { describe, expect, it } from "vitest";
import { dispositionFilename, filenameFromDisposition } from "./downloadResponse";

describe("dispositionFilename", () => {
  // Each header as the backend's content-disposition package writes it for the name.
  it.each([
    ["Parts list.csv", 'attachment; filename="Parts list.csv"'],
    ["a;b,c.txt", 'attachment; filename="a;b,c.txt"'],
    ['say "hi".txt', 'attachment; filename="say \\"hi\\".txt"'],
    ["back\\slash.txt", 'attachment; filename="back\\\\slash.txt"'],
    ["plain.txt", "attachment; filename=plain.txt"],
    ["100% done.stl", 'attachment; filename="100% done.stl"'],
    [
      "Ünïcödé notes.pdf",
      "attachment; filename=\"?n?c?d? notes.pdf\"; filename*=UTF-8''%C3%9Cn%C3%AFc%C3%B6d%C3%A9%20notes.pdf",
    ],
    ["零件.stl", "attachment; filename=\"??.stl\"; filename*=UTF-8''%E9%9B%B6%E4%BB%B6.stl"],
  ])("reads %s back", (name, header) => {
    expect(dispositionFilename(header)).toBe(name);
  });

  it("drops a line break a name stored before names were cleaned still has", () => {
    expect(dispositionFilename("attachment; filename=\"old??name.txt\"; filename*=UTF-8''old%0D%0Aname.txt")).toBe(
      "oldname.txt",
    );
  });

  it("reads filename* first, whatever the order, its language and the parameters' case", () => {
    expect(dispositionFilename("attachment; FILENAME*=utf-8'en'Caf%C3%A9.stl; Filename=\"Cafe.stl\"")).toBe("Café.stl");
  });

  it("falls back to filename when filename* can't be read as UTF-8", () => {
    expect(dispositionFilename("attachment; filename=\"Cafe.stl\"; filename*=iso-8859-1''Caf%E9.stl")).toBe("Cafe.stl");
    expect(dispositionFilename("attachment; filename=\"Part.stl\"; filename*=UTF-8''Part%E9%9B.stl")).toBe("Part.stl");
  });

  it("is null when the header names no file", () => {
    expect(dispositionFilename("")).toBeNull();
    expect(dispositionFilename("inline")).toBeNull();
    expect(dispositionFilename('attachment; filename="  "')).toBeNull();
  });
});

describe("filenameFromDisposition", () => {
  const response = (headers: Record<string, string>) => new Response(null, { headers });

  it("takes the header's name, or the fallback without one", () => {
    expect(filenameFromDisposition(response({ "content-disposition": 'attachment; filename="A b.stl"' }), "x")).toBe(
      "A b.stl",
    );
    expect(filenameFromDisposition(response({}), "model.zip")).toBe("model.zip");
    expect(filenameFromDisposition(response({ "content-disposition": "attachment" }), "model.zip")).toBe("model.zip");
  });
});
