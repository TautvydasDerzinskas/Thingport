import { describe, expect, it } from "vitest";
import { filenameFromDisposition } from "./downloadResponse";

// Headers as the backend's content-disposition package writes them.
const named = (disposition: string) =>
  filenameFromDisposition(new Response(null, { headers: { "Content-Disposition": disposition } }), "fallback.bin");

describe("the name a download is saved under", () => {
  it("reads a quoted name whole, a semicolon in it included", () => {
    expect(named('attachment; filename="Parts; small.csv"')).toBe("Parts; small.csv");
    expect(named('attachment; filename="a,b.csv"')).toBe("a,b.csv");
  });

  it("takes the backslash off an escaped quote or backslash", () => {
    expect(named('attachment; filename="say \\"hi\\".txt"')).toBe('say "hi".txt');
    expect(named('attachment; filename="back\\\\slash.txt"')).toBe("back\\slash.txt");
  });

  it("reads a bare name, and prefers filename* for one beyond ASCII", () => {
    expect(named("attachment; filename=plain.csv")).toBe("plain.csv");
    expect(named("attachment; filename=\"??sis; notes.txt\"; filename*=UTF-8''%C5%BD%C4%85sis%3B%20notes.txt")).toBe(
      "Žąsis; notes.txt",
    );
  });

  it("takes filename* only as a parameter of its own, never from inside a quoted name", () => {
    expect(named("attachment; filename=\"Parts; filename*=UTF-8''notes.csv; rev2.csv\"")).toBe(
      "Parts; filename*=UTF-8''notes.csv; rev2.csv",
    );
  });

  it("falls back to the name it was given when the header names none", () => {
    expect(named("attachment")).toBe("fallback.bin");
    expect(named('attachment; filename=""')).toBe("fallback.bin");
  });
});
