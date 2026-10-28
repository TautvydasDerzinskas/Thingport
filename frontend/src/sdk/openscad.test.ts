import { describe, expect, it } from "vitest";
import { SCAD_LIBRARIES, scadParameters, scadRender } from "./openscad";

// These run the real engine. It is several megabytes of WebAssembly and each case compiles geometry, so the
// timeouts are generous -- but a run that takes minutes means the Manifold backend isn't being used, which is
// the one mistake here that would make the feature unusable rather than merely slow.

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
