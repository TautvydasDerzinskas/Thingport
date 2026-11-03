import { describe, expect, it } from "vitest";
import { z } from "zod";
import Module from "manifold-3d";
import {
  addMesh,
  applyCommand,
  CommandError,
  STUDIO_COMMAND_LIST,
  type StudioCommandArgs,
  type StudioCommandName,
} from "./commands";
import {
  emptyDocument,
  sketchPointToWorld,
  topLevel,
  transformMatrix,
  applyMatrix,
  type StudioDocument,
} from "./document";
import { estimateTriangles, evaluateDesign, prepareMesh } from "./geometry";
import { decodeMesh, encodeMesh } from "./meshAsset";

function run<N extends StudioCommandName>(doc: StudioDocument, name: N, args: StudioCommandArgs<N>) {
  return applyCommand(doc, name, args).document;
}

const wasm = Module().then((module) => {
  module.setup();
  return module;
});

describe("Studio commands", () => {
  it("describe themselves well enough for an AI to use", () => {
    for (const command of STUDIO_COMMAND_LIST) {
      expect(command.name).toMatch(/^[a-z_]+$/);
      expect({ [command.name]: command.description.length > 20 }).toEqual({ [command.name]: true });
      expect({ [command.name]: command.kind === "document" }).toEqual({ [command.name]: Boolean(command.apply) });
      for (const [key, schema] of Object.entries(command.args)) {
        expect(key).toMatch(/^[a-z_]+$/);
        // Every argument is explained, or is an enum or flag whose values say it.
        const explained =
          Boolean((schema as z.ZodTypeAny).description) ||
          schema instanceof z.ZodEnum ||
          schema instanceof z.ZodBoolean ||
          (schema instanceof z.ZodOptional && schema.unwrap() instanceof z.ZodEnum);
        expect({ [`${command.name}.${key}`]: explained }).toEqual({ [`${command.name}.${key}`]: true });
      }
    }
  });

  it("gives every feature an id of its own, never reused", () => {
    let doc = run(emptyDocument(), "add_box", { width: 10, depth: 10, height: 10 });
    doc = run(doc, "delete_feature", { feature_id: "box-1" });
    doc = run(doc, "add_box", { width: 10, depth: 10, height: 10 });
    expect(doc.features.map((feature) => feature.id)).toEqual(["box-2"]);
  });

  it("leaves the document it was given alone", () => {
    const doc = emptyDocument();
    run(doc, "add_sphere", { radius: 5 });
    expect(doc.features).toHaveLength(0);
  });

  it("refuses arguments a command doesn't take, and says why", () => {
    const doc = run(emptyDocument(), "add_box", { width: 10, depth: 10, height: 10 });
    expect(() => applyCommand(doc, "add_box", { width: 10, depth: 10, height: 10, radius: 4 })).toThrow(CommandError);
    expect(() => applyCommand(doc, "add_box", { width: -1, depth: 10, height: 10 })).toThrow(/width/);
    expect(() => applyCommand(doc, "update_feature", { feature_id: "box-1", radius: 3 })).toThrow(
      /A box has no radius. It takes: width, depth, height/,
    );
    expect(() => applyCommand(doc, "add_torus", { major_radius: 5, minor_radius: 6 })).toThrow(/minor_radius/);
    expect(() => applyCommand(doc, "undo", {})).toThrow(/isn't a change/);
  });

  it("puts a boolean's bodies under it, and gives them back when it's deleted", () => {
    let doc = run(emptyDocument(), "add_box", { width: 20, depth: 20, height: 10 });
    doc = run(doc, "add_cylinder", { radius: 4, height: 30 });
    doc = run(doc, "boolean", { operation: "subtract", target_id: "box-1", tool_ids: ["cylinder-2"] });
    expect(topLevel(doc).map((feature) => feature.id)).toEqual(["boolean-3"]);
    expect(() => applyCommand(doc, "delete_feature", { feature_id: "box-1" })).toThrow(/part of boolean-3/);
    expect(() =>
      applyCommand(doc, "boolean", { operation: "union", target_id: "box-1", tool_ids: ["boolean-3"] }),
    ).toThrow(/already part of/);
    doc = run(doc, "delete_feature", { feature_id: "boolean-3" });
    expect(topLevel(doc).map((feature) => feature.id)).toEqual(["box-1", "cylinder-2"]);
  });

  it("copies a feature with everything it's built from", () => {
    let doc = run(emptyDocument(), "add_sketch", {
      plane: "XY",
      shapes: [{ type: "rectangle", center: [0, 0], width: 10, height: 10 }],
    });
    doc = run(doc, "extrude", { sketch_id: "sketch-1", distance: 5 });
    doc = run(doc, "duplicate_feature", { feature_id: "extrude-2", offset: [20, 0, 0] });
    const copy = doc.features.find((feature) => feature.id === "extrude-4");
    expect(copy).toMatchObject({ type: "extrude", sketch_id: "sketch-3", transform: { position: [20, 0, 0] } });
    expect(topLevel(doc).map((feature) => feature.id)).toEqual(["extrude-2", "extrude-4"]);
  });

  it("won't extrude a sketch with nothing but holes, or one already extruded", () => {
    let doc = run(emptyDocument(), "add_sketch", {
      plane: "XY",
      shapes: [{ type: "circle", center: [0, 0], radius: 3, hole: true }],
    });
    expect(() => applyCommand(doc, "extrude", { sketch_id: "sketch-1", distance: 5 })).toThrow(/nothing to extrude/);
    doc = run(doc, "add_sketch_shape", { sketch_id: "sketch-1", shape: { type: "circle", center: [0, 0], radius: 6 } });
    doc = run(doc, "extrude", { sketch_id: "sketch-1", distance: 5 });
    expect(() => applyCommand(doc, "extrude", { sketch_id: "sketch-1", distance: 5 })).toThrow(/already part of/);
  });
});

describe("Studio geometry", () => {
  it("rotates about the world X, then Y, then Z axis", () => {
    // +X turned 90° about Z lands on +Y; then nothing else moves it.
    const m = transformMatrix({ position: [1, 2, 3], rotation: [0, 0, 90], scale: [2, 1, 1] });
    expect(applyMatrix(m, [1, 0, 0]).map((n) => Math.round(n * 1000) / 1000 + 0)).toEqual([1, 4, 3]);
    // X first: +Y about X by 90° is +Z; then Z by 90° leaves +Z.
    const xz = transformMatrix({ position: [0, 0, 0], rotation: [90, 0, 90], scale: [1, 1, 1] });
    expect(applyMatrix(xz, [0, 1, 0]).map((n) => Math.round(n * 1000) / 1000 + 0)).toEqual([0, 0, 1]);
  });

  it("stands primitives on the bed and measures them", async () => {
    let doc = run(emptyDocument(), "add_box", { width: 20, depth: 10, height: 5, position: [100, 0, 0] });
    doc = run(doc, "add_sphere", { radius: 5 });
    const { bodies, errors } = evaluateDesign(await wasm, doc);
    expect(errors).toEqual([]);
    const [box, sphere] = bodies;
    expect(box.bounds).toEqual({ min: [90, -5, 0], max: [110, 5, 5] });
    expect(box.volume).toBeCloseTo(1000);
    expect(sphere.bounds.min[2]).toBeCloseTo(0);
  });

  it("cuts, extrudes and keeps holes", async () => {
    let doc = run(emptyDocument(), "add_box", { width: 10, depth: 10, height: 10 });
    doc = run(doc, "add_box", { width: 10, depth: 10, height: 10, position: [5, 0, 0] });
    doc = run(doc, "boolean", { operation: "subtract", target_id: "box-1", tool_ids: ["box-2"] });
    doc = run(doc, "add_sketch", {
      plane: "XZ",
      offset: 50,
      shapes: [
        { type: "rectangle", center: [0, 10], width: 20, height: 20 },
        { type: "rectangle", center: [0, 10], width: 10, height: 10, hole: true },
      ],
    });
    doc = run(doc, "extrude", { sketch_id: "sketch-4", distance: 2 });
    const { bodies, errors } = evaluateDesign(await wasm, doc);
    expect(errors).toEqual([]);
    expect(bodies.map((body) => body.id)).toEqual(["boolean-3", "extrude-5"]);
    expect(bodies[0].volume).toBeCloseTo(500);
    expect(bodies[0].bounds.max[0]).toBeCloseTo(0);
    // The front plane at y=50, extruded towards the front (-y).
    expect(bodies[1].volume).toBeCloseTo((400 - 100) * 2);
    expect(bodies[1].bounds.min[1]).toBeCloseTo(48);
    expect(bodies[1].bounds.max[1]).toBeCloseTo(50);
    expect(sketchPointToWorld({ plane: "XZ", offset: 50 }, [3, 4])).toEqual([3, 50, 4]);
  });

  it("says when a boolean comes out empty, and still makes the rest", async () => {
    let doc = run(emptyDocument(), "add_box", { width: 10, depth: 10, height: 10 });
    doc = run(doc, "add_box", { width: 10, depth: 10, height: 10, position: [50, 0, 0] });
    doc = run(doc, "boolean", { operation: "intersect", target_id: "box-1", tool_ids: ["box-2"] });
    doc = run(doc, "add_cylinder", { radius: 2, height: 2 });
    const { bodies, errors } = evaluateDesign(await wasm, doc);
    expect(errors).toEqual([{ id: "boolean-3", message: expect.stringContaining("came out empty") }]);
    expect(bodies.map((body) => body.id)).toEqual(["cylinder-4"]);
    expect(estimateTriangles(doc)).toBeGreaterThan(0);
  });
});

describe("Studio meshes", () => {
  /** A box as an STL has it: every triangle with corners of its own. */
  async function boxSoup(dropTriangles = 0): Promise<Float32Array> {
    const cube = (await wasm).Manifold.cube([10, 20, 30]);
    const mesh = cube.getMesh();
    cube.delete();
    const out: number[] = [];
    for (let t = dropTriangles * 3; t < mesh.triVerts.length; t++) {
      const v = mesh.triVerts[t];
      out.push(
        mesh.vertProperties[v * 3] + 100,
        mesh.vertProperties[v * 3 + 1] - 50,
        mesh.vertProperties[v * 3 + 2] + 7,
      );
    }
    return new Float32Array(out);
  }
  const source = { model_id: "m1", file_id: "f1", file_name: "box.stl", model_title: "A box" };

  it("joins an STL's corners, centres it on the bed, and knows a closed one from an open one", async () => {
    const closed = prepareMesh(await wasm, await boxSoup());
    expect(closed).toMatchObject({ solid: true, size: [10, 20, 30] });
    expect(closed.mesh.positions.length / 3).toBe(8);
    const zs = closed.mesh.positions.filter((_, i) => i % 3 === 2);
    expect(Math.min(...zs)).toBe(0);
    const open = prepareMesh(await wasm, await boxSoup(2));
    expect(open.solid).toBe(false);
  });

  it("cuts a closed mesh like any body, and refuses to combine an open one", async () => {
    const closed = prepareMesh(await wasm, await boxSoup());
    const open = prepareMesh(await wasm, await boxSoup(2));
    const assets = new Map([
      ["a".repeat(24), closed.mesh],
      ["b".repeat(24), open.mesh],
    ]);
    let doc = addMesh(
      emptyDocument(),
      { asset_id: "a".repeat(24), solid: true, triangles: 12, size: closed.size, source },
      {},
    ).document;
    doc = run(doc, "add_cylinder", { radius: 2, height: 100, position: [0, 0, -10] });
    doc = run(doc, "boolean", { operation: "subtract", target_id: "mesh-1", tool_ids: ["cylinder-2"] });
    doc = addMesh(
      doc,
      { asset_id: "b".repeat(24), solid: false, triangles: 10, size: open.size, source },
      { position: [50, 0, 0] },
    ).document;
    expect(() =>
      applyCommand(doc, "boolean", { operation: "union", target_id: "mesh-4", tool_ids: ["boolean-3"] }),
    ).toThrow(/isn't a closed solid/);
    const { bodies, errors } = evaluateDesign(await wasm, doc, undefined, (id) => assets.get(id));
    expect(errors).toEqual([]);
    expect(bodies[0].volume).toBeCloseTo(10 * 20 * 30 - Math.PI * 4 * 30, -1);
    expect(bodies[1]).toMatchObject({ id: "mesh-4", bounds: { min: [45, -10, 0], max: [55, 10, 30] } });
    expect(Number.isNaN(bodies[1].volume)).toBe(true);
    // Without its triangles loaded, a mesh says so rather than taking the rest down with it.
    expect(evaluateDesign(await wasm, doc).errors.map((error) => error.id)).toEqual(["boolean-3", "mesh-4"]);
  });

  it("keeps a mesh in its own small file, and reads it back as it was", async () => {
    const { mesh } = prepareMesh(await wasm, await boxSoup());
    const back = decodeMesh(encodeMesh(mesh));
    expect(back.positions).toEqual(mesh.positions);
    expect(back.indices).toEqual(mesh.indices);
    expect(() => decodeMesh(new Uint8Array(20))).toThrow(/Not a Studio mesh/);
  });
});
