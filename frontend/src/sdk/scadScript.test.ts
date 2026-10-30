import { describe, expect, it } from "vitest";
import { scriptForEngine, scriptWidgets, standInFiles } from "./scadScript";

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
