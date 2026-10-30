import { describe, expect, it } from "vitest";
import { TOOL_FONTS } from "./fonts";
import { scadParameters, scadRender } from "./openscadEngine";
import { SCAD_LIBRARIES } from "./scadLibraries";
import { standInFiles } from "./scadScript";
import { writeStl } from "./stl";

// These run the real engine. It is several megabytes of WebAssembly and each case compiles geometry, so the
// timeouts are generous -- but a run that takes minutes means the Manifold backend isn't being used, which is
// the one mistake here that would make the feature unusable rather than merely slow.
//
// The engine is called directly rather than through openscad.ts, which is the worker in front of it: a worker
// is a browser thing and there isn't one here. What that file adds is the message passing, and the thing worth
// testing -- that the engine renders what it is asked for -- is all on this side of it.

const KEYCHAIN = `
$fn=50;
/* [Text options] */
text_color = "green"; // [white, red, green]
TEXT = "RMmaker";
text_size = 10;        // Text size

/* [Base options] */
base_width = 80;       // Base width
base_length = 20;
base_thickness = 1;

color(base_color = base_color) cube([base_width, base_length, base_thickness]);
base_color = "gray"; // [white, gray]
translate([0, 0, base_thickness]) linear_extrude(height = 2) text(TEXT, size = text_size, halign = "center");
`;

const BOX = "cube([10, 20, 30]);\n";

describe("scadParameters", () => {
  it("reads the groups, ranges and choices OpenSCAD's own customizer would show", async () => {
    const { parameters } = await scadParameters(KEYCHAIN);
    const by = (name: string) => parameters.find((p) => p.name === name);

    expect(by("TEXT")).toMatchObject({ group: "Text options", type: "string", initial: "RMmaker" });
    expect(by("text_size")).toMatchObject({ group: "Text options", type: "number", initial: 10 });
    expect(by("text_color")?.options?.map((o) => o.value)).toEqual(["white", "red", "green"]);
    expect(by("base_width")?.group).toBe("Base options");
  }, 120000);

  it("gives nothing away for a script with no parameters, rather than failing", async () => {
    expect((await scadParameters(BOX)).parameters).toEqual([]);
  }, 120000);

  it("calls a vector a vector, where the engine calls it a number", async () => {
    const { parameters } = await scadParameters("size = [10, 20, 30]; // [0:100]\nn = 5;\ncube(size);\n");
    expect(parameters[0]).toMatchObject({ name: "size", type: "vector", initial: [10, 20, 30] });
    expect(parameters[1]).toMatchObject({ name: "n", type: "number" });
  }, 120000);

  it("reads a script with Windows line endings the same, without its caller having to clean it", async () => {
    const { parameters } = await scadParameters(
      '/* [Size] */\r\nw = 5; // [1:10]\r\ntint = "#ff0000"; // color\r\nmodule m() { cube(w); }\r\nh = 2; // [1:9]\r\nm();\r\n',
    );
    expect(parameters.map(({ name, group, min, max, widget }) => [name, group, min, max, widget])).toEqual([
      ["w", "Size", 1, 10, undefined],
      ["tint", "Size", undefined, undefined, "color"],
      ["h", "Size", 1, 9, undefined],
    ]);
  }, 120000);
});

// The shape of a real one (MakerWorld 1988702): a library pasted in first, so the only parameter is far below the
// first brace, where OpenSCAD's customizer has stopped reading and MakerWorld's hasn't.
const LIBRARY_FIRST = `
function double(x) = x * 2;
module library() { cube(1); }
$fn = $preview ? 32 : 64;
Size = 12; // [1:0.01:100]
module wrench(size) {
  cube([size, double(size), 1]);
}
wrench(Size);
`;

describe("scripts OpenSCAD's customizer can't read on its own", () => {
  const offOf = async (source: string, parameters?: Record<string, unknown>) =>
    new TextDecoder().decode((await scadRender(source, { parameters, format: "off" })).bytes);
  const shown = async (source: string) => {
    const { parameters } = await scadParameters(source);
    return parameters.filter((parameter) => parameter.group !== "Hidden");
  };

  it("reads a parameter below the first brace, with its range", async () => {
    expect(await shown(LIBRARY_FIRST)).toMatchObject([
      { name: "Size", type: "number", initial: 12, min: 1, max: 100, step: 0.01, group: "Parameters" },
    ]);
  }, 120000);

  it("applies a value to it, which only the engine reading it itself makes possible", async () => {
    expect(await offOf(LIBRARY_FIRST)).toContain("12 24 1");
    expect(await offOf(LIBRARY_FIRST, { Size: 30 })).toContain("30 60 1");
  }, 120000);

  it("makes the same model at the defaults as the author's own order would", async () => {
    const reordered = LIBRARY_FIRST.replace("Size = 12; // [1:0.01:100]\n", "");
    expect(await offOf(LIBRARY_FIRST)).toBe(await offOf(`Size = 12; // [1:0.01:100]\n${reordered}`));
  }, 120000);

  it("keeps the groups, captions and Hidden of what moved", async () => {
    const parameters = await shown(
      "module m() { cube(1); }\n/* [Wrench] */\n// How wide\nw = 5; // [1:100]\n/* [Handle] */\nl = 40; // [10:90]\ngrip = 2;\n/* [Hidden] */\nsecret = 9; // [1:9]\ncube([w, l, grip + secret]);\n",
    );
    expect(parameters.map(({ name, group, caption }) => [name, group, caption])).toEqual([
      ["w", "Wrench", "How wide"],
      ["l", "Handle", undefined],
      ["grip", "Handle", undefined],
    ]);
  }, 120000);

  it("keeps what was already above the first brace first, under its own heading", async () => {
    const parameters = await shown(
      "/* [Top] */\na = 1; // [1:5]\nmodule m() { cube(1); }\nb = 2; // [1:5]\ncube([a, b, 1]);\n",
    );
    expect(parameters.map(({ name, group }) => [name, group])).toEqual([
      ["a", "Top"],
      ["b", "Top"],
    ]);
  }, 120000);

  it("doesn't take the comment above a module for the caption of what lands in front of it", async () => {
    const [parameter] = await shown("// Draws the thing\nmodule m() { cube(1); }\nb = 2; // [1:5]\ncube(b);\n");
    expect(parameter.caption).toBeUndefined();
  }, 120000);

  it("offers a script's unmarked constants only if it would otherwise offer nothing", async () => {
    expect((await shown("module m() { cube(1); }\nw = 2;\nh = 3;\ncube([w, h, 1]);\n")).map((p) => p.name)).toEqual([
      "w",
      "h",
    ]);
    const limited = "shown = 2; // [1:5]\nmodule __Customizer_Limit__() {}\ninternal = 7;\ncube(shown + internal);\n";
    expect((await shown(limited)).map((p) => p.name)).toEqual(["shown"]);
    const marked = "module __Customizer_Limit__() {}\ndetails = 120; // [60:Quick, 360:Slow]\ncube(details);\n";
    expect(await shown(marked)).toEqual([]);
    expect(await shown("module m() { cube(1); }\nm();\n")).toEqual([]);
  }, 120000);

  it("doesn't let a one-line note take a parameter out of its group", async () => {
    const parameters = await shown(
      "/* [Size] */\n/* a note */\nw = 5; /* wide */\nh = 6; /* high */\n/* [Hidden] */\n/* workings */\nsecret = 9;\ncube([w, h, secret]);\n",
    );
    expect(parameters.map(({ name, group }) => [name, group])).toEqual([
      ["w", "Size"],
      ["h", "Size"],
    ]);
  }, 120000);

  it("always names a group, even for an empty heading", async () => {
    const [parameter] = await shown("/* [] */\nw = 5; // [1:10]\ncube(w);\n");
    expect(parameter.group).toBe("Parameters");
  }, 120000);

  it("says which parameters want a colour, a typeface or a file", async () => {
    const { parameters } = await scadParameters(
      'tint = "#e2dede"; // color\nface = "PT Sans"; // font\nimage = "default.png";\nchoice = "default.stl"; // [default.stl, other.stl]\ncube(1);\n',
    );
    expect(parameters.map(({ name, widget, accept }) => [name, widget, accept])).toEqual([
      ["tint", "color", undefined],
      ["face", "font", undefined],
      ["image", "file", ".png"],
      // The author's own choices win.
      ["choice", undefined, undefined],
    ]);
  }, 120000);
});

describe("typefaces", () => {
  const lettering = (font?: string) => `linear_extrude(1) text("Ag", size = 10${font ? `, font = "${font}"` : ""});\n`;
  const off = async (source: string) => new TextDecoder().decode((await scadRender(source, { format: "off" })).bytes);

  it("draws every typeface it offers by the name it offers it under", async () => {
    const shapes = await Promise.all(TOOL_FONTS.map((font) => off(lettering(font.name))));
    expect(new Set(shapes).size).toBe(TOOL_FONTS.length);
  }, 300000);

  it("falls back on the plainest, rather than on whatever it finds first", async () => {
    const plain = await off(lettering("PT Sans"));
    expect(await off(lettering("Arial"))).toBe(plain);
    expect(await off(lettering("Liberation Sans:style=Bold"))).toBe(plain);
    expect(await off(lettering())).toBe(plain);
  }, 120000);

  it("takes a typeface from a parameter", async () => {
    const source = 'face = "PT Sans"; // font\nlinear_extrude(1) text("Ag", size = 10, font = face);\n';
    const { bytes } = await scadRender(source, { parameters: { face: "Bebas Neue" }, format: "off" });
    expect(new TextDecoder().decode(bytes)).toBe(await off(lettering("Bebas Neue")));
  }, 120000);
});

describe("files a script reads", () => {
  const off = async (source: string, options = {}) =>
    new TextDecoder().decode((await scadRender(source, { ...options, format: "off" })).bytes);

  it("renders on stand-ins until one is chosen, rather than making nothing", async () => {
    expect(await off('mesh = "default.stl";\nimport(mesh);\n')).toContain("20 20 20");
    expect(await off('art = "default.svg";\nlinear_extrude(2) import(art);\n')).toContain("20 20 2");
    expect(await off('image = "default.png";\nsurface(file = image);\n')).toMatch(/^OFF \d+ \d+ 0/);
  }, 120000);

  it("reads the file it is given, by the name a parameter was set to", async () => {
    const mesh = {
      vertices: Float64Array.from([0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 7]),
      triangles: Uint32Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
    };
    const made = await off('mesh = "default.stl";\nimport(mesh);\n', {
      parameters: { mesh: "my shape (2).stl" },
      files: { "my shape (2).stl": writeStl(mesh) },
    });
    expect(made).toContain("7 0 0");
    expect(made).not.toContain("20 20 20");
  }, 120000);

  it("reads a chosen image too", async () => {
    const image = standInFiles('"default.png"')["/default.png"] as Uint8Array;
    const made = await off('image = "default.png";\nsurface(file = image);\n', {
      parameters: { image: "mine.png" },
      files: { "mine.png": image },
    });
    expect(made).toMatch(/^OFF \d+ \d+ 0/);
  }, 120000);
});

describe("scadRender", () => {
  it("renders a 3MF by default, quickly enough to prove the Manifold backend is in use", async () => {
    const { bytes, seconds } = await scadRender(BOX);

    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]); // a zip, which a 3MF is
    expect(seconds).toBeLessThan(30);
  }, 120000);

  it("renders the formats the engine writes itself", async () => {
    expect(new TextDecoder().decode((await scadRender(BOX, { format: "stl" })).bytes.slice(0, 5))).toBe("solid");
    expect((await scadRender(BOX, { format: "obj" })).bytes.length).toBeGreaterThan(0);
    expect((await scadRender(BOX, { format: "off" })).bytes.length).toBeGreaterThan(0);
  }, 180000);

  it("makes a far smaller file as a 3MF than the engine's own STL", async () => {
    const source = "sphere(r = 20, $fn = 120);\n";
    const [threeMf, stl] = await Promise.all([
      scadRender(source, { format: "3mf" }),
      scadRender(source, { format: "stl" }),
    ]);

    expect(threeMf.bytes.length).toBeLessThan(stl.bytes.length / 4);
  }, 300000);

  it("changes the model when a parameter changes", async () => {
    const source = "size = 10;\ncube([size, size, size]);\n";
    // As OFF, so the coordinates can simply be read back.
    const small = await scadRender(source, { parameters: { size: 10 }, format: "off" });
    const large = await scadRender(source, { parameters: { size: 40 }, format: "off" });

    expect(new TextDecoder().decode(small.bytes)).toContain("10 10 10");
    expect(new TextDecoder().decode(large.bytes)).toContain("40 40 40");
  }, 180000);

  // Pinned so it isn't rediscovered the hard way: the engine renders first and only then says it can't write
  // the file, so what comes back is a successful-looking run and nothing on disk.

  it("passes a string parameter through untouched, brackets and quotes included", async () => {
    // Through the command line any of these would have ended the argument early or started a new one.
    const source = 'label = "plain";\nlinear_extrude(1) text(label);\n';
    const { log } = await scadRender(source, { parameters: { label: 'a "quoted" [one]' } });

    expect(log.filter((line) => /ERROR/i.test(line))).toEqual([]);
  }, 120000);

  it("says what went wrong rather than returning nothing", async () => {
    await expect(scadRender("this is not OpenSCAD at all(((")).rejects.toThrow(/error/i);
  }, 120000);
});

describe("the carried libraries", () => {
  it("carries BOSL2, which is what real scripts include", () => {
    expect(SCAD_LIBRARIES).toContain("BOSL2");
  });

  it("mounts one for a script that includes it", async () => {
    const source = "include <BOSL2/std.scad>\ncuboid([10, 10, 10], rounding = 2);\n";
    const { bytes, log } = await scadRender(source, { format: "stl" });

    expect(log.filter((line) => /Can't find include file/i.test(line))).toEqual([]);
    expect(bytes.length).toBeGreaterThan(0);
  }, 300000);
});
