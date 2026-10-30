import { describe, expect, it } from "vitest";
import { scadIncludedFiles, scriptForEngine, scriptWidgets, standInFiles } from "./scadScript";

describe("scriptForEngine", () => {
  it("leaves alone a script whose parameters are already where the engine looks", () => {
    const source = '/* [Size] */\nw = 5; // [1:10]\nlabel = "x";\nmodule m() { cube(w); }\nm();\n';
    expect(scriptForEngine(source)).toBe(source);
  });

  it("leaves alone a script with no brace at all", () => {
    const source = "w = 5; // [1:10]\ncube(w);\n";
    expect(scriptForEngine(source)).toBe(source);
  });

  it("moves a marked parameter above the first brace, and nothing else", () => {
    expect(scriptForEngine("function f(x) = x;\nmodule m() { cube(1); }\nw = 5; // [1:10]\nm();\n")).toBe(
      "function f(x) = x;\n/* [Parameters] */\nw = 5; // [1:10]\nmodule m() { cube(1); }\nm();\n",
    );
  });

  it("lands in front of the statement holding the brace, not inside it", () => {
    expect(scriptForEngine("module m()\n{\n  cube(1);\n}\nw = 5; // [1:10]\n")).toBe(
      "/* [Parameters] */\nw = 5; // [1:10]\nmodule m()\n{\n  cube(1);\n}\n",
    );
  });

  it("brings the headings and captions along, in the script's order", () => {
    const moved = scriptForEngine(
      "module m() { cube(1); }\n/* [Wrench] */\n// How wide\nw = 5; // [1:10]\nh = 2;\n/* [Handle] */\nl = 40; // [10:90]\n",
    );
    expect(moved.indexOf("module m()")).toBeGreaterThan(moved.indexOf("l = 40"));
    expect(moved.split("\n").slice(0, 6)).toEqual([
      "/* [Wrench] */",
      "// How wide",
      "w = 5; // [1:10]",
      "h = 2;",
      "/* [Handle] */",
      "l = 40; // [10:90]",
    ]);
  });

  it("doesn't move what isn't a top-level constant on a line of its own", () => {
    for (const source of [
      "module m() {\n  inner = 3; // [1:5]\n  cube(inner);\n}\nm();\n",
      "module m() { cube(1); }\n/*\nold = 3; // [1:5]\n*/\nm();\n",
      "module m() { cube(1); }\npts = [\n  1, // [not a widget]\n  2\n];\nm();\n",
      "module m() { cube(1); }\nb = 2 * 3; // [1:5]\nm();\n",
      "module m() { cube(1); }\n$fn = 64; // [8:128]\nm();\n",
    ]) {
      expect(scriptForEngine(source)).toBe(source);
    }
  });

  it("doesn't move a name assigned twice, since that could change which one wins", () => {
    const source = "module m() { cube(1); }\nb = 2; // [1:5]\nb = 3;\ncube(b);\n";
    expect(scriptForEngine(source)).toBe(source);
  });

  it("doesn't move a line with a brace of its own, which would end the reading all over again", () => {
    const source = 'module m() { cube(1); }\nlabel = "{"; // [{, }]\nm();\n';
    expect(scriptForEngine(source)).toBe(source);
  });

  it("leaves a Hidden section hidden", () => {
    const source = "module m() { cube(1); }\n/* [Hidden] */\nsecret = 9; // [1:9]\nm();\n";
    expect(scriptForEngine(source)).toBe(source);
  });

  it("moves unmarked constants only when the script would otherwise offer nothing", () => {
    expect(scriptForEngine("module m() { cube(1); }\nw = 2;\ncube(w);\n")).toBe(
      "/* [Parameters] */\nw = 2;\nmodule m() { cube(1); }\ncube(w);\n",
    );
    // The convention for keeping a script's workings out of the customizer: a list above, and a module to stop it.
    const limited = "shown = 2; // [1:5]\nmodule __Customizer_Limit__() {}\ninternal = 7;\ncube(shown + internal);\n";
    expect(scriptForEngine(limited)).toBe(limited);
  });

  it("moves nothing below a customizer limit, marked or not, however it's capitalised", () => {
    for (const source of [
      "a = 1; // [1:5]\nmodule __Customizer_Limit__() {}\ndetails = 120; // [60:Quick, 360:Slow]\ncube(a);\n",
      "module __Customizer_Limit__ () {}\nw = 2;\nh = 3;\ncube([w, h, 1]);\n",
      "module __customizer_limit__() {}\nw = 2; // [1:5]\ncube(w);\n",
      "module __Customizer_Limit__()\n{\n}\nw = 2; // [1:5]\ncube(w);\n",
    ]) {
      expect(scriptForEngine(source)).toBe(source);
    }
  });

  it("still moves what's above a limit further down", () => {
    expect(
      scriptForEngine("module m() { cube(1); }\na = 1; // [1:5]\nmodule __Customizer_Limit__() {}\nb = 2; // [1:5]\n"),
    ).toBe(
      "/* [Parameters] */\na = 1; // [1:5]\nmodule m() { cube(1); }\nmodule __Customizer_Limit__() {}\nb = 2; // [1:5]\n",
    );
  });

  it("doesn't take any other empty module for a limit, which would hide what's below a library pasted in first", () => {
    expect(scriptForEngine("module stub() {}\nSize = 12; // [1:100]\ncube(Size);\n")).toBe(
      "/* [Parameters] */\nSize = 12; // [1:100]\nmodule stub() {}\ncube(Size);\n",
    );
  });

  it("doesn't take a limit in a comment for one", () => {
    expect(
      scriptForEngine("module m() { cube(1); }\n// module __Customizer_Limit__() {}\n\nw = 2; // [1:5]\n"),
    ).toContain("/* [Parameters] */\nw = 2; // [1:5]\nmodule m()");
  });

  it("doesn't count $fn as the script offering something", () => {
    expect(scriptForEngine("$fn = 64;\nmodule m() { cube(1); }\nw = 2;\ncube(w);\n")).toContain(
      "$fn = 64;\n/* [Parameters] */\nw = 2;\nmodule m()",
    );
  });

  it("counts a brace in a string, as the engine does, and leaves what's above it where it is", () => {
    expect(scriptForEngine('b = 2; // [1:5]\nlabel = "{";\nc = 3; // [1:5]\n')).toBe(
      'b = 2; // [1:5]\n/* [Parameters] */\nc = 3; // [1:5]\nlabel = "{";\n',
    );
  });

  it("keeps an include above what moves, since what it assigns can be overridden", () => {
    expect(scriptForEngine("include <a/b.scad>\nmodule m() { cube(1); }\nw = 2; // [1:5]\n")).toBe(
      "include <a/b.scad>\n/* [Parameters] */\nw = 2; // [1:5]\nmodule m() { cube(1); }\n",
    );
  });

  it("blanks one-line notes, which the engine would take for empty headings, keeping every column", () => {
    const blank = (comment: string) => " ".repeat(comment.length);
    expect(scriptForEngine("/* [Size] */\n/* a note */\nw = 5; /* trailing */ // [1:10]\n")).toBe(
      `/* [Size] */\n${blank("/* a note */")}\nw = 5; ${blank("/* trailing */")} // [1:10]\n`,
    );
  });

  it("keeps a heading with words after it, which the engine reads as a heading, and multi-line comments", () => {
    const source = "/* [Size] mm */\n/* a\n   note */\nw = 5;\n";
    expect(scriptForEngine(source)).toBe(source);
  });

  it("leaves comment-like text in a string alone", () => {
    const source = 'label = "/* hi */";\n';
    expect(scriptForEngine(source)).toBe(source);
  });

  it("reads a script with Windows line endings the same, and hands it on without them", () => {
    expect(scriptForEngine("module m() { cube(1); }\r\nw = 5; // [1:10]\r\nm();\r\n")).toBe(
      "/* [Parameters] */\nw = 5; // [1:10]\nmodule m() { cube(1); }\nm();\n",
    );
    expect(scriptForEngine("w = 5; // [1:10]\r\ncube(w);\r\n")).toBe("w = 5; // [1:10]\ncube(w);\n");
  });
});

describe("scriptWidgets", () => {
  it("reads the controls OpenSCAD has no word for, wherever in the script they are", () => {
    const widgets = scriptWidgets(
      [
        'tint = "#E2DEDE"; // color',
        'face = "Arial"; // font',
        "module m() { cube(1); }",
        'image = "default.png";',
        'art = "default.svg"; // the drawing',
        'mesh = "default.stl";',
      ].join("\n"),
    );
    expect(Object.fromEntries(widgets)).toEqual({
      tint: { widget: "color" },
      face: { widget: "font" },
      image: { widget: "file", accept: ".png" },
      art: { widget: "file", accept: ".svg" },
      mesh: { widget: "file", accept: ".stl" },
    });
  });

  it("wants both halves: the value's shape and the comment", () => {
    const widgets = scriptWidgets(
      ['plain = "#ff0000";', 'word = "red"; // color', 'other = "x"; // [x, y]', "n = 5; // font"].join("\n"),
    );
    expect(widgets.size).toBe(0);
  });

  it("ignores a module's locals", () => {
    expect(scriptWidgets('module m() {\n  tint = "#ff0000"; // color\n}\n').size).toBe(0);
  });

  it("reads a script with Windows line endings the same", () => {
    expect(Object.fromEntries(scriptWidgets('tint = "#ff0000"; // color\r\nface = "Arial"; // font\r\n'))).toEqual({
      tint: { widget: "color" },
      face: { widget: "font" },
    });
  });
});

describe("standInFiles", () => {
  it("only offers what the script mentions", () => {
    expect(Object.keys(standInFiles("cube(1);\n"))).toEqual([]);
    expect(Object.keys(standInFiles('a = "default.png";\nb = "default.stl";\n'))).toEqual([
      "/default.png",
      "/default.stl",
    ]);
  });
});

describe("scadIncludedFiles", () => {
  const reader = (files: Record<string, string>) => {
    const asked: string[] = [];
    const read = async (name: string) => {
      asked.push(name);
      return files[name] ?? null;
    };
    return { read, asked };
  };

  it("gathers what a script includes or uses, at the path it asks for", async () => {
    const { read } = reader({ "a.scad": "A", "b.scad": "B", "c.scad": "C" });
    expect(await scadIncludedFiles("include <a.scad>\nuse <lib/b.scad>\ninclude <../c.scad>\n", read)).toEqual({
      "a.scad": "A",
      "lib/b.scad": "B",
      "c.scad": "C",
    });
  });

  it("follows what those include, relative to whichever asked", async () => {
    const { read } = reader({
      "outer.scad": "include <deep/inner.scad>\n",
      "inner.scad": "use <../sibling.scad>\n",
      "sibling.scad": "S",
    });
    expect(await scadIncludedFiles("use <lib/outer.scad>\n", read)).toEqual({
      "lib/outer.scad": "include <deep/inner.scad>\n",
      "lib/deep/inner.scad": "use <../sibling.scad>\n",
      "lib/sibling.scad": "S",
    });
  });

  it("leaves out what isn't there, for the render to name", async () => {
    const { read, asked } = reader({ "a.scad": "A" });
    expect(await scadIncludedFiles("include <a.scad>\ninclude <shapes.scad>\n", read)).toEqual({ "a.scad": "A" });
    expect(asked).toEqual(["a.scad", "shapes.scad"]);
  });

  it("doesn't go looking for a library Thingport carries", async () => {
    const { read, asked } = reader({ "std.scad": "not this one" });
    expect(await scadIncludedFiles("include <BOSL2/std.scad>\n", read)).toEqual({});
    expect(asked).toEqual([]);
  });

  it("ignores what's commented out or inside a string", async () => {
    const { read, asked } = reader({});
    await scadIncludedFiles(
      '// include <a.scad>\n/* use <b.scad> */\nlabel = "include <c.scad>";\nurl = "http://x"; include <d.scad>\n',
      read,
    );
    expect(asked).toEqual(["d.scad"]);
  });

  it("survives files that include each other", async () => {
    const { read } = reader({ "a.scad": "include <b.scad>\n", "b.scad": "include <a.scad>\n" });
    expect(Object.keys(await scadIncludedFiles("include <a.scad>\n", read))).toEqual(["a.scad", "b.scad"]);
  });

  it("stops when files found by name seem to reach each other at ever deeper paths", async () => {
    const { read, asked } = reader({ "main.scad": "use <lib/helper.scad>\n", "helper.scad": "use <main.scad>\n" });
    const files = await scadIncludedFiles("use <lib/helper.scad>\n", read);
    expect(Object.keys(files).every((at) => at.split("/").length <= 8)).toBe(true);
    expect(files["lib/helper.scad"]).toBe("use <main.scad>\n");
    expect(asked.toSorted()).toEqual(["helper.scad", "main.scad"]);
  });

  it("reads a file once, however many paths ask for it", async () => {
    const { read, asked } = reader({ "a.scad": "A" });
    const files = await scadIncludedFiles("use <a.scad>\nuse <lib/a.scad>\nuse <other/a.scad>\n", read);
    expect(Object.keys(files)).toEqual(["a.scad", "lib/a.scad", "other/a.scad"]);
    expect(asked).toEqual(["a.scad"]);
  });

  it("asks by file name alone, since a model's files keep no folders", async () => {
    const { read, asked } = reader({});
    await scadIncludedFiles("include <../openscad-bitmap/bitmap.scad>\ninclude <win\\path.scad>\n", read);
    expect(asked).toEqual(["bitmap.scad", "path.scad"]);
  });
});
