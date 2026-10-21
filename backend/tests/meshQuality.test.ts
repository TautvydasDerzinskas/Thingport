import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeMesh, summarizeQuality } from "../src/services/meshQuality";
import { checkModelQuality } from "../src/services/modelQualityCheck";

// A closed box as loose triangles (STL-style), outward-facing, `size` mm on each side, offset by `at`.
function box(size = 10, at: [number, number, number] = [0, 0, 0]): number[][] {
  const p = (x: number, y: number, z: number) => [at[0] + x * size, at[1] + y * size, at[2] + z * size];
  return [
    [p(0, 0, 0), p(1, 1, 0), p(1, 0, 0)],
    [p(0, 0, 0), p(0, 1, 0), p(1, 1, 0)],
    [p(0, 0, 1), p(1, 0, 1), p(1, 1, 1)],
    [p(0, 0, 1), p(1, 1, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(1, 0, 0), p(1, 0, 1)],
    [p(0, 0, 0), p(1, 0, 1), p(0, 0, 1)],
    [p(0, 1, 0), p(1, 1, 1), p(1, 1, 0)],
    [p(0, 1, 0), p(0, 1, 1), p(1, 1, 1)],
    [p(0, 0, 0), p(0, 0, 1), p(0, 1, 1)],
    [p(0, 0, 0), p(0, 1, 1), p(0, 1, 0)],
    [p(1, 0, 0), p(1, 1, 1), p(1, 0, 1)],
    [p(1, 0, 0), p(1, 1, 0), p(1, 1, 1)],
  ].map((triangle) => triangle.flat());
}

const soup = (triangles: number[][]) => Float32Array.from(triangles.flat());
const flip = (triangle: number[]) => [...triangle.slice(0, 3), ...triangle.slice(6, 9), ...triangle.slice(3, 6)];

describe("analyzeMesh", () => {
  it("finds nothing wrong with a closed box", () => {
    const stats = analyzeMesh(soup(box()));
    expect(stats).toMatchObject({ triangles: 12, openEdges: 0, nonManifoldEdges: 0, flippedEdges: 0, shells: 1 });
    expect(stats.volume).toBeCloseTo(1000, 3);
    expect(summarizeQuality([stats])).toMatchObject({ status: "good", issues: [] });
  });

  it("joins corners that differ only by float rounding", () => {
    const triangles = box();
    triangles[0][0] += 0.00001;
    expect(analyzeMesh(soup(triangles)).openEdges).toBe(0);
  });

  it("reads an indexed mesh, as 3MF stores it", () => {
    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    const tetra = [0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2];
    expect(analyzeMesh(vertices, tetra)).toMatchObject({ triangles: 4, openEdges: 0, flippedEdges: 0 });
  });

  it("reports a missing face as a hole", () => {
    const stats = analyzeMesh(soup(box().slice(1)));
    expect(stats.openEdges).toBe(3);
    expect(summarizeQuality([stats]).issues).toContainEqual({ code: "openEdges", count: 3 });
  });

  it("reports a face turned the wrong way", () => {
    const triangles = box();
    triangles[0] = flip(triangles[0]);
    const stats = analyzeMesh(soup(triangles));
    expect(stats.openEdges).toBe(0);
    expect(stats.flippedEdges).toBe(3);
  });

  it("reports a whole mesh facing inwards", () => {
    const report = summarizeQuality([analyzeMesh(soup(box().map(flip)))]);
    expect(report.issues).toEqual([{ code: "insideOut", count: 1 }]);
  });

  it("reports an edge shared by more than two faces", () => {
    // A fin on an edge of the box.
    const fin = [0, 0, 0, 10, 0, 0, 5, -5, 0];
    expect(analyzeMesh(soup([...box(), fin])).nonManifoldEdges).toBeGreaterThan(0);
  });

  it("counts degenerate triangles without treating them as holes", () => {
    const sliver = [0, 0, 0, 5, 0, 0, 10, 0, 0];
    const stats = analyzeMesh(soup([...box(), sliver]));
    expect(stats).toMatchObject({ degenerateTriangles: 1, openEdges: 0, shells: 1, fragments: 0 });
  });

  it("rejects a triangle index outside the vertex list", () => {
    expect(() => analyzeMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 3])).toThrow(RangeError);
  });

  it("tells a stray fragment from a second part", () => {
    const twoParts = analyzeMesh(soup([...box(), ...box(10, [20, 0, 0])]));
    expect(twoParts).toMatchObject({ shells: 2, fragments: 0 });
    const debris = analyzeMesh(soup([...box(), ...box(0.05, [30, 30, 30])]));
    expect(debris).toMatchObject({ shells: 2, fragments: 1 });
  });
});

describe("summarizeQuality", () => {
  it("flags a model exported in the wrong unit", () => {
    expect(summarizeQuality([analyzeMesh(soup(box(0.05)))]).issues).toEqual([{ code: "tooSmall" }]);
    expect(summarizeQuality([analyzeMesh(soup(box(5000)))]).issues).toEqual([{ code: "tooLarge" }]);
  });

  it("flags a file with no geometry or missing parts", () => {
    expect(summarizeQuality([]).issues).toEqual([{ code: "empty" }]);
    expect(summarizeQuality([analyzeMesh(soup(box()))], 2).issues).toEqual([{ code: "missingParts", count: 2 }]);
  });

  it("checks meshes apart, so touching objects aren't a defect", () => {
    const report = summarizeQuality([analyzeMesh(soup(box())), analyzeMesh(soup(box(10, [10, 0, 0])))]);
    expect(report).toMatchObject({ status: "good", shells: 2, size: [20, 10, 10] });
  });
});

describe("checkModelQuality", () => {
  const asciiStl = (triangles: number[][]) =>
    `solid t\n${triangles
      .map(
        (t) =>
          `facet normal 0 0 0\nouter loop\n${[0, 3, 6].map((i) => `vertex ${t[i]} ${t[i + 1]} ${t[i + 2]}`).join("\n")}\nendloop\nendfacet`,
      )
      .join("\n")}\nendsolid t\n`;

  it("reads an STL file and reports its holes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quality-"));
    try {
      await fs.writeFile(path.join(dir, "good.stl"), asciiStl(box()));
      await fs.writeFile(path.join(dir, "holed.stl"), asciiStl(box().slice(2)));
      expect(await checkModelQuality(path.join(dir, "good.stl"), ".stl")).toMatchObject({ status: "good" });
      expect(await checkModelQuality(path.join(dir, "holed.stl"), ".stl")).toMatchObject({
        status: "issues",
        issues: [{ code: "openEdges", count: 4 }],
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("calls a file that won't open unreadable", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "quality-"));
    try {
      await fs.writeFile(path.join(dir, "broken.3mf"), "not a zip");
      expect(await checkModelQuality(path.join(dir, "broken.3mf"), ".3mf")).toMatchObject({
        status: "issues",
        issues: [{ code: "unreadable" }],
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
