import type { StudioCommandName } from "../../studio/commands";
import type { EdgeTreatment } from "../../studio/document";
import type { EdgePick, FacePick, PickRequest, Picked } from "./StudioViewport";

// The tools that take more than a click: what each has been given so far (its fields and what's been picked in the
// view), what it wants picked next, and the one command it makes. A tool's panel edits one of these; the page previews
// the command it makes and runs it on OK. Nothing here changes a design: the command does.

export type Combine = "new" | "join" | "cut" | "intersect";
export type HoleStyle = "simple" | "counterbore" | "countersink";

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
  | { kind: "sketch_face"; face: FacePick | null };

export type OperationKind = Operation["kind"];

/** A tool as it starts: on the one body selected, where that's what it works on. */
export function startOperation(kind: Exclude<OperationKind, "extrude" | "revolve">, body: string | null): Operation;
export function startOperation(kind: "extrude" | "revolve", sketch: string): Operation;
export function startOperation(kind: OperationKind, on: string | null): Operation {
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
    case "sketch_face":
      return { kind, face: null };
  }
}

const NORMALS = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] } as const;

/** The command a tool makes once it has what it needs; null until then. */
export function commandOf(op: Operation): { name: StudioCommandName; args: Record<string, unknown> } | null {
  switch (op.kind) {
    case "extrude":
    case "revolve": {
      if (op.combine !== "new" && !op.target) return null;
      const combine = op.combine === "new" ? {} : { operation: op.combine, target_id: op.target };
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
    case "sketch_face":
      return op.face ? { name: "add_sketch", args: { face: op.face } } : null;
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
      return op.target ? null : { kind: "body", bodies: null, chosen: none };
    case "sketch_face":
      return { kind: "face", bodies: null, chosen: none };
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
      return picked.kind === "body" ? { ...op, target: body } : op;
    case "sketch_face":
      return picked.kind === "face" ? { ...op, face: picked.face } : op;
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
