import { describe, expect, it } from "vitest";
import { tileLook } from "./tileLook";

// A supporting file's tile, from what the server says it is and how it shows (PR 7's content_kind, PR 8's view).

describe("tileLook", () => {
  it("tells documents apart by how they show: a PDF, a table, text and Markdown", () => {
    expect(tileLook("document", "pdf")).toEqual({ tone: "error", glyph: "pdf" });
    expect(tileLook("document", "table")).toEqual({ tone: "success", glyph: "table" });
    expect(tileLook("document", "text")).toEqual({ tone: "neutral", glyph: "text" });
    expect(tileLook("document", "markdown")).toEqual({ tone: "neutral", glyph: "text" });
    // A Word file has no viewer here, so it's a plain document.
    expect(tileLook("document", null)).toEqual({ tone: "info", glyph: "document" });
  });

  it("shows a script as code even where it opens as text, and each other kind by its own glyph", () => {
    expect(tileLook("script", "text")).toEqual({ tone: "accent", glyph: "code" });
    expect(tileLook("picture", "image")).toEqual({ tone: "info", glyph: "picture" });
    expect(tileLook("picture", null)).toEqual({ tone: "info", glyph: "picture" });
    expect(tileLook("cad", null).glyph).toBe("design");
    expect(tileLook("laser", null).glyph).toBe("design");
    expect(tileLook("mesh", null).glyph).toBe("mesh");
    expect(tileLook("sliced", null).glyph).toBe("sliced");
    expect(tileLook("archive", null)).toEqual({ tone: "warning", glyph: "archive" });
  });

  it("gives a file it knows nothing of, as from an older backend, the plain tile", () => {
    expect(tileLook(undefined, undefined)).toEqual({ tone: "neutral", glyph: "file" });
    expect(tileLook("other", null)).toEqual({ tone: "neutral", glyph: "file" });
  });
});
