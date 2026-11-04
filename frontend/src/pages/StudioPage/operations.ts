import type { StudioCommandName } from "../../studio/commands";
import {
  shapeContours,
  sketchFrame,
  type EdgeTreatment,
  type SketchFeature,
  type Vec2,
  type Vec3,
} from "../../studio/document";
import { DEFAULT_FONT, type StudioFontId } from "../../studio/text";
import type { EdgePick, FacePick, PickRequest, Picked } from "./StudioViewport";

// The tools that take more than a click: what each has been given so far (its fields and what's been picked in the
// view), what it wants picked next, and the one command it makes. A tool's panel edits one of these; the page previews
// the command it makes and runs it on OK. Nothing here changes a design: the command does.

export type Combine = "new" | "join" | "cut" | "intersect";
export type WorldAxis = "X" | "Y" | "Z";
export type AlignMode = "start" | "center" | "end" | "before" | "after";

const AXIS: Record<WorldAxis, [number, number, number]> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
export type HoleStyle = "simple" | "counterbore" | "countersink" | "threaded";

export type Operation =
  | {
      kind: "extrude";
      sketch: string;
      distance: number;
      symmetric: boolean;
      start_offset: number;
      taper: number;
      top_edge: EdgeTreatment | null;
      bottom_edge: EdgeTreatment | null;
      combine: Combine;
      target: string | null;
    }
  | { kind: "revolve"; sketch: string; axis: "u" | "v"; angle: number; combine: Combine; target: string | null }
  | {
      kind: "sweep";
      sketch: string;
      path: [number, number, number][];
      smooth: boolean;
      closed: boolean;
      combine: Combine;
      target: string | null;
    }
  | { kind: "press_pull"; target: string | null; face: FacePick | null; distance: number }
  | { kind: "fillet" | "chamfer"; target: string | null; edges: EdgePick[]; size: number }
  | {
      kind: "hole";
      target: string | null;
      at: FacePick | null;
      diameter: number;
      through: boolean;
      depth: number;
      style: HoleStyle;
      bore_diameter: number;
      bore_depth: number;
      sink_diameter: number;
      sink_angle: number;
    }
  | { kind: "shell"; target: string | null; thickness: number; open: FacePick[] }
  | {
      kind: "split";
      target: string | null;
      by: "plane" | "face" | "body";
      plane: "XY" | "XZ" | "YZ";
      offset: number;
      face: FacePick | null;
      tool: string | null;
    }
  | { kind: "scale"; target: string | null; factor: number }
  | { kind: "separate"; target: string | null }
  | { kind: "sketch_face"; face: FacePick | null }
  | {
      kind: "pattern";
      target: string | null;
      /** In a row (a grid with a second row), or round an axis through `center`. */
      style: "linear" | "circular";
      axis: WorldAxis;
      count: number;
      spacing: number;
      grid: boolean;
      grid_axis: WorldAxis;
      grid_count: number;
      grid_spacing: number;
      angle: number;
      center: [number, number, number];
    }
  | { kind: "mirror"; target: string | null; plane: "YZ" | "XZ" | "XY"; offset: number; keep: boolean }
  | {
      kind: "align";
      target: string | null;
      /** The body to line up with; null for the bed. */
      reference: string | null;
      x: AlignMode | null;
      y: AlignMode | null;
      z: AlignMode | null;
      gap: number;
    }
  | { kind: "lay_flat"; target: string | null; face: FacePick | null }
  | {
      kind: "text";
      text: string;
      font: StudioFontId;
      size: number;
      height: number;
      /** On one of the main planes, or on a body's face. */
      on: "plane" | "face";
      plane: "XY" | "XZ" | "YZ";
      face: FacePick | null;
      /** On a plane, a body of its own or joined to or cut from one; on a face, raised from it or cut into it. */
      combine: "new" | "join" | "cut";
      target: string | null;
    };

export type OperationKind = Operation["kind"];

const rounded = (point: Vec3): Vec3 => point.map((value) => Number(value.toFixed(3))) as Vec3;

/** A sweep's path as it starts, as CAD draws one: out of the middle of the sketch's profile, square to the sketch the
 *  way an extrude goes, 30 mm. The profile stays where it is, so the path's first point has to stay on its plane. */
export function startingPath(sketch: SketchFeature): Vec3[] {
  const points = sketch.shapes
    .filter((shape) => !shape.hole)
    .flatMap((shape): Vec2[] => {
      try {
        return shapeContours(shape).flat();
      } catch {
        return [];
      }
    });
  const middle = (axis: 0 | 1) =>
    points.length
      ? (Math.min(...points.map((point) => point[axis])) + Math.max(...points.map((point) => point[axis]))) / 2
      : 0;
  const { origin, u, v, n } = sketchFrame(sketch);
  const start = origin.map((value, i) => value + u[i] * middle(0) + v[i] * middle(1)) as Vec3;
  return [rounded(start), rounded(start.map((value, i) => value + n[i] * 30) as Vec3)];
}

/** A tool as it starts: on the one body selected, where that's what it works on. */
export function startOperation(
  kind: Exclude<OperationKind, "extrude" | "revolve" | "sweep">,
  body: string | null,
): Operation;
export function startOperation(kind: "extrude" | "revolve", sketch: string): Operation;
/** A sweep starts on its sketch and its path, from startingPath. */
export function startOperation(kind: "sweep", sketch: string, path: Vec3[]): Operation;
export function startOperation(kind: OperationKind, on: string | null, path?: Vec3[]): Operation {
  switch (kind) {
    case "extrude":
      return {
        kind,
        sketch: on!,
        distance: 10,
        symmetric: false,
        start_offset: 0,
        taper: 0,
        top_edge: null,
        bottom_edge: null,
        combine: "new",
        target: null,
      };
    case "revolve":
      return { kind, sketch: on!, axis: "v", angle: 360, combine: "new", target: null };
    case "sweep":
      return {
        kind,
        sketch: on!,
        path: path!,
        smooth: false,
        closed: false,
        combine: "new",
        target: null,
      };
    case "press_pull":
      return { kind, target: on, face: null, distance: 5 };
    case "fillet":
      return { kind, target: on, edges: [], size: 2 };
    case "chamfer":
      return { kind, target: on, edges: [], size: 1 };
    case "hole":
      return {
        kind,
        target: on,
        at: null,
        diameter: 5,
        through: true,
        depth: 10,
        style: "simple",
        bore_diameter: 9,
        bore_depth: 3,
        sink_diameter: 9,
        sink_angle: 90,
      };
    case "shell":
      return { kind, target: on, thickness: 2, open: [] };
    case "split":
      return { kind, target: on, by: "plane", plane: "XY", offset: 0, face: null, tool: null };
    case "scale":
      return { kind, target: on, factor: 1 };
    case "separate":
      return { kind, target: on };
    case "sketch_face":
      return { kind, face: null };
    case "pattern":
      return {
        kind,
        target: on,
        style: "linear",
        axis: "X",
        count: 3,
        spacing: 20,
        grid: false,
        grid_axis: "Y",
        grid_count: 2,
        grid_spacing: 20,
        angle: 360,
        center: [0, 0, 0],
      };
    case "mirror":
      return { kind, target: on, plane: "YZ", offset: 0, keep: true };
    case "align":
      return { kind, target: on, reference: null, x: "center", y: "center", z: "start", gap: 0 };
    case "lay_flat":
      return { kind, target: on, face: null };
    case "text":
      return {
        kind,
        text: "",
        font: DEFAULT_FONT,
        size: 10,
        height: 2,
        on: "plane",
        plane: "XY",
        face: null,
        combine: "new",
        target: null,
      };
  }
}

const NORMALS = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] } as const;

/** The command a tool makes once it has what it needs; null until then. */
export function commandOf(op: Operation): { name: StudioCommandName; args: Record<string, unknown> } | null {
  switch (op.kind) {
    case "extrude":
    case "revolve":
    case "sweep": {
      if (op.combine !== "new" && !op.target) return null;
      const combine = op.combine === "new" ? {} : { operation: op.combine, target_id: op.target };
      if (op.kind === "sweep")
        return {
          name: "sweep",
          args: { sketch_id: op.sketch, path: op.path, smooth: op.smooth, closed: op.closed, ...combine },
        };
      if (op.kind === "revolve")
        return { name: "revolve", args: { sketch_id: op.sketch, axis: op.axis, angle: op.angle, ...combine } };
      return {
        name: "extrude",
        args: {
          sketch_id: op.sketch,
          distance: op.distance,
          symmetric: op.symmetric,
          start_offset: op.start_offset,
          taper: op.taper,
          top_edge: op.top_edge,
          bottom_edge: op.bottom_edge,
          ...combine,
        },
      };
    }
    case "press_pull":
      return op.target && op.face
        ? { name: "press_pull", args: { feature_id: op.target, face: op.face, distance: op.distance } }
        : null;
    case "fillet":
      return op.target && op.edges.length
        ? { name: "fillet", args: { feature_id: op.target, edges: op.edges, radius: op.size } }
        : null;
    case "chamfer":
      return op.target && op.edges.length
        ? { name: "chamfer", args: { feature_id: op.target, edges: op.edges, distance: op.size } }
        : null;
    case "hole":
      return op.target && op.at
        ? {
            name: "hole",
            args: {
              feature_id: op.target,
              point: op.at.point,
              normal: op.at.normal,
              diameter: op.diameter,
              ...(op.through ? {} : { depth: op.depth }),
              ...(op.style === "counterbore"
                ? { counterbore: { diameter: op.bore_diameter, depth: op.bore_depth } }
                : op.style === "countersink"
                  ? { countersink: { diameter: op.sink_diameter, angle: op.sink_angle } }
                  : op.style === "threaded"
                    ? { thread: {} }
                    : {}),
            },
          }
        : null;
    case "shell":
      return op.target
        ? { name: "shell", args: { feature_id: op.target, thickness: op.thickness, open_faces: op.open } }
        : null;
    case "split": {
      if (!op.target) return null;
      if (op.by === "body")
        return op.tool ? { name: "split", args: { feature_id: op.target, tool_id: op.tool } } : null;
      if (op.by === "face") return op.face ? { name: "split", args: { feature_id: op.target, plane: op.face } } : null;
      const normal = NORMALS[op.plane];
      const point = normal.map((n) => n * op.offset);
      return { name: "split", args: { feature_id: op.target, plane: { point, normal: [...normal] } } };
    }
    case "scale":
      return op.target && op.factor !== 1
        ? { name: "scale_feature", args: { feature_id: op.target, factor: op.factor } }
        : null;
    case "separate":
      return op.target ? { name: "separate_parts", args: { feature_id: op.target } } : null;
    case "sketch_face":
      return op.face ? { name: "add_sketch", args: { face: op.face } } : null;
    case "pattern":
      if (!op.target) return null;
      if (op.style === "circular")
        return {
          name: "circular_pattern",
          args: {
            feature_id: op.target,
            count: op.count,
            axis_direction: AXIS[op.axis],
            axis_point: op.center,
            angle: op.angle,
          },
        };
      return {
        name: "linear_pattern",
        args: {
          feature_id: op.target,
          direction: AXIS[op.axis],
          count: op.count,
          spacing: op.spacing,
          ...(op.grid
            ? { grid_direction: AXIS[op.grid_axis], grid_count: op.grid_count, grid_spacing: op.grid_spacing }
            : {}),
        },
      };
    case "mirror": {
      if (!op.target) return null;
      const normal = AXIS[op.plane === "YZ" ? "X" : op.plane === "XZ" ? "Y" : "Z"];
      return {
        name: "mirror",
        args: {
          feature_id: op.target,
          plane_normal: normal,
          plane_point: normal.map((n) => n * op.offset),
          keep_original: op.keep,
        },
      };
    }
    case "align":
      if (!op.target || (!op.x && !op.y && !op.z)) return null;
      return {
        name: "align",
        args: {
          feature_id: op.target,
          ...(op.reference ? { to_id: op.reference } : {}),
          ...(op.x ? { x: op.x } : {}),
          ...(op.y ? { y: op.y } : {}),
          ...(op.z ? { z: op.z } : {}),
          ...(op.gap ? { gap: op.gap } : {}),
        },
      };
    case "lay_flat":
      return op.target && op.face ? { name: "lay_flat", args: { feature_id: op.target, face: op.face } } : null;
    case "text": {
      if (!op.text.trim()) return null;
      const text = { text: op.text, font: op.font, size: op.size, height: op.height };
      if (op.on === "face")
        return op.face && op.target
          ? { name: "add_text", args: { ...text, face: op.face, operation: op.combine, target_id: op.target } }
          : null;
      if (op.combine === "new") return { name: "add_text", args: { ...text, plane: op.plane } };
      return op.target
        ? { name: "add_text", args: { ...text, plane: op.plane, operation: op.combine, target_id: op.target } }
        : null;
    }
  }
}

/** What the view should let the user pick for a tool now; null when it needs nothing picked. `own` are the bodies its
 *  preview shows in place of its target, which picking on counts as picking on the target. */
export function pickOf(op: Operation, own: string[]): PickRequest | null {
  const none = { faces: [], edges: [], points: [] };
  const on = (target: string | null) => (target ? [target, ...own] : null);
  switch (op.kind) {
    case "extrude":
    case "revolve":
    case "sweep":
      return op.combine === "new" ? null : { kind: "body", bodies: null, chosen: none };
    case "press_pull":
      return { kind: "face", bodies: null, chosen: { ...none, faces: op.face ? [op.face] : [] } };
    case "fillet":
    case "chamfer":
      return { kind: "edge", bodies: on(op.target), chosen: { ...none, edges: op.edges } };
    case "hole":
      return { kind: "point", bodies: null, chosen: { ...none, points: op.at ? [op.at] : [] } };
    case "shell":
      return op.target
        ? { kind: "face", bodies: on(op.target), chosen: { ...none, faces: op.open } }
        : { kind: "body", bodies: null, chosen: none };
    case "split":
      if (!op.target) return { kind: "body", bodies: null, chosen: none };
      if (op.by === "face") return { kind: "face", bodies: null, chosen: { ...none, faces: op.face ? [op.face] : [] } };
      if (op.by === "body") return { kind: "body", bodies: null, chosen: none };
      return null;
    case "scale":
    case "separate":
      return op.target ? null : { kind: "body", bodies: null, chosen: none };
    case "sketch_face":
      return { kind: "face", bodies: null, chosen: none };
    case "pattern":
    case "mirror":
      return op.target ? null : { kind: "body", bodies: null, chosen: none };
    case "align":
      // The body to move first, then, until one is picked, the one to line it up with.
      return op.target && op.reference ? null : { kind: "body", bodies: null, chosen: none };
    case "lay_flat":
      // Once a face is picked the preview shows the body turned: another is picked after letting that one go.
      return op.face ? null : { kind: "face", bodies: null, chosen: none };
    case "text":
      if (op.on === "face") return { kind: "face", bodies: null, chosen: { ...none, faces: op.face ? [op.face] : [] } };
      return op.combine === "new" ? null : { kind: "body", bodies: null, chosen: none };
  }
}

const same = (a: number[], b: number[]) => a.every((value, i) => Math.abs(value - b[i]) < 1e-3);

/** A tool after something was picked for it. A pick on its own preview counts as a pick on its target. */
export function withPick(op: Operation, picked: Picked, own: string[]): Operation {
  const onPreview = own.includes(picked.body);
  const body = onPreview && "target" in op && op.target ? op.target : picked.body;
  switch (op.kind) {
    case "extrude":
    case "revolve":
    case "sweep":
      return picked.kind === "body" && !onPreview ? { ...op, target: body } : op;
    case "press_pull":
      return picked.kind === "face" ? { ...op, target: body, face: picked.face } : op;
    case "fillet":
    case "chamfer": {
      if (picked.kind !== "edge") return op;
      // Another body's edge starts over on that body; one already chosen is let go of.
      if (op.target && body !== op.target) return { ...op, target: body, edges: [picked.edge] };
      const known = op.edges.findIndex(
        (edge) =>
          (same(edge.a, picked.edge.a) && same(edge.b, picked.edge.b)) ||
          (same(edge.a, picked.edge.b) && same(edge.b, picked.edge.a)),
      );
      return {
        ...op,
        target: body,
        edges: known >= 0 ? op.edges.filter((_, i) => i !== known) : [...op.edges, picked.edge],
      };
    }
    case "hole":
      return picked.kind === "point" ? { ...op, target: body, at: picked.point } : op;
    case "shell": {
      if (picked.kind === "body") return { ...op, target: body, open: [] };
      if (picked.kind !== "face") return op;
      const known = op.open.findIndex(
        (face) => same(face.normal, picked.face.normal) && Math.abs(dotAlong(face, picked.face)) < 1e-3,
      );
      return { ...op, open: known >= 0 ? op.open.filter((_, i) => i !== known) : [...op.open, picked.face] };
    }
    case "split":
      if (picked.kind === "body" && !op.target) return { ...op, target: body };
      if (picked.kind === "body" && op.by === "body" && body !== op.target && !onPreview) return { ...op, tool: body };
      if (picked.kind === "face" && op.by === "face") return { ...op, face: picked.face };
      return op;
    case "scale":
    case "separate":
      return picked.kind === "body" ? { ...op, target: body } : op;
    case "sketch_face":
      return picked.kind === "face" ? { ...op, face: picked.face } : op;
    case "pattern":
    case "mirror":
      return picked.kind === "body" && !onPreview ? { ...op, target: body } : op;
    case "align":
      if (picked.kind !== "body" || onPreview) return op;
      if (!op.target) return { ...op, target: body };
      return body === op.target ? op : { ...op, reference: body };
    case "lay_flat":
      return picked.kind === "face" ? { ...op, target: body, face: picked.face } : op;
    case "text":
      if (picked.kind === "face" && op.on === "face") return { ...op, face: picked.face, target: body };
      return picked.kind === "body" && !onPreview ? { ...op, target: body } : op;
  }
}

/** How far apart two faces' planes are along the first one's normal: 0 for the same plane. */
function dotAlong(a: FacePick, b: FacePick): number {
  return (
    a.normal[0] * (b.point[0] - a.point[0]) +
    a.normal[1] * (b.point[1] - a.point[1]) +
    a.normal[2] * (b.point[2] - a.point[2])
  );
}
