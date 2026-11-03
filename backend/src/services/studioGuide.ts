import { LIMITS } from "../studio/document.generated";

// What the studio_guide MCP tool hands an assistant before it designs anything in Studio: how a design is put
// together, how faces and edges are named, what each step can and can't do, and a few recipes. The tools' own
// descriptions have the details of their arguments.

export const STUDIO_GUIDE = `# Studio: designing printable parts

Studio is Thingport's CAD page. A design is a list of features built in order; every studio_ tool is a step the user
can take on the page too, and the page shows each step as you take it. The user may change the design while you work:
read it again (studio_get_design) before building on something.

## The world

- Millimetres. Z is up; the bed is the XY plane at z = 0. The front is -Y, the right side +X.
- A box, cylinder, cone or torus has its origin at the centre of its base, a sphere at its lowest point: position
  z = 0 stands it on the bed.
- Rotation is in degrees about the world X, then Y, then Z axis.

## How a design is built

- Features have ids like box-1, sketch-4, fillet-7. Ids are never reused.
- A body made from others owns them: a boolean owns its bodies, an extrude its sketch, a fillet, hole, shell or
  press/pull the body it changed, a split's two parts their source. Owned features drop out of top_level and stay
  editable: change one and everything built on it follows. Deleting the newer feature gives back what it owned.
- Work on top-level bodies. A tool refuses a body that's already part of another, and says which.
- studio_get_design lists every feature, each body's size and volume, and problems (a feature that couldn't be made
  and why). Check problems after each step.

## Naming faces and edges

Faces and edges aren't stored as such: a body is a mesh. Name them by where they are, in the world:

- Call studio_inspect_body for the body. It lists its flat faces (a point on each and its outward normal, largest
  first) and its straight sharp edges (both ends, whether it's an outside (convex) or inside edge, and the angle).
- Pass a face as { point, normal } and an edge as { a, b }, copied from that list.
- The reference is kept in the body's own frame, so it follows the body if it moves later. If an edit removes the face
  or edge, the feature reports a problem rather than guessing.

## Making shapes

- add_box, add_cylinder, add_cone, add_sphere, add_torus. Cylinders and cones can round or bevel their rims
  (top_edge, bottom_edge).
- add_sketch on XY, XZ or YZ, or on a flat face (face: { point, normal }; the reply says where u and v point; on a wall
  v is up). Draw rectangles, circles, polygons and text in the sketch's [u, v] millimetres; rectangles and polygons
  take corner_radius; shapes marked hole are cut out of the others.
- add_text writes words as a solid in one step: raised letters on a plane, or embossed (join) or engraved (cut) on a
  body's flat face. size is a capital letter's height; 6 mm or more prints well. The reply says when a font has no
  letter for a character, and which fonts do.
- trace_picture turns one of the design's pictures (one attached to a prompt) into a sketch outline: the exact way to
  make a logo, a silhouette or a drawn outline, holes kept. Give height to extrude it at once; for an object in a
  photo, build it from shapes instead and compare it with studio_view_design.
- extrude a sketch: a distance (negative goes the other way), symmetric, start_offset, a taper in degrees (a draft),
  and top_edge / bottom_edge rounding or bevel. operation join, cut or intersect with target_id works it into another
  body in the same step.
- revolve a sketch about its u or v axis, by an angle up to 360°. Its shapes must all be on one side of the axis.

## Changing a body

- press_pull: move a flat face straight out (adds) or in (cuts), keeping its outline.
- fillet / chamfer: round or bevel straight edges between flat faces, many at once. Outside edges are cut, inside
  edges filled. Two at a corner meet in a mitre; three at a square corner get a ball corner. Refused, with the reason,
  when the size is too big for the faces, or at a corner it can't blend (three edges at a corner that isn't square, an
  outside and an inside edge at one corner). Curved edges can't be filleted: use a cylinder's or an extrude's own
  edge options.
- hole: at a point on the surface with its outward normal; a depth or right through; counterbore or countersink.
- shell: hollow a body with walls of a thickness (flat walls exact; round inside edges and corners never thinner, at
  most 2.5% thicker), optionally leaving flat faces open for the hollow to run out through. Bodies over
  ${LIMITS.shellTriangles} triangles are refused: shell parts before combining them.
- split: by a plane (two parts, front and back of its normal) or by another body (inside and outside; the cutting body
  stays). Good for cutting a model into printable pieces.
- separate_parts: makes each loose part of a body (each piece not touching the rest) a body of its own, largest first,
  each with its own origin at its base's middle. A hollow inside a part stays with it. Parts that overlap without being
  joined come apart too; a boolean on a body that still holds such parts counts their overlap twice, so separate them
  and union them first.
- boolean: union, subtract or intersect bodies; keep_tools leaves the tools as they are.
- set_transform (absolute) and scale_feature (a factor) move, turn and size a body.
- update_feature changes any feature's numbers later, e.g. a fillet's radius or a hole's diameter.
- studio_save_to_library saves the design to the user's library as a new model (an STL, a picture and their requests
  as its description). Save only when the user asks.
- import_model brings in a library model's STL, 3MF, STEP, OBJ or GLB (find it with search_models). A closed mesh works
  with everything above; one with gaps can only be moved, scaled and exported. A model of several pieces comes in as
  one body, and the reply says how many: separate_parts splits it, and the pieces of one with gaps that are closed
  themselves can then be combined.

## Recipes

A rounded block with a counterbored hole:
1. add_box width 40, depth 30, height 12.
2. studio_inspect_body box-1; fillet all 12 edges with radius 2 (or only the 4 vertical ones).
3. hole on fillet-2 at point [0, 0, 12], normal [0, 0, 1], diameter 5.5, counterbore { diameter 10, depth 5 }.

A tray with a lid lip:
1. add_box 80 × 60 × 30; shell with thickness 2 and open_faces the top face ([0, 0, 30], [0, 0, 1]).
2. add_sketch on XY offset 28 with a rectangle 78 × 58, extrude 2 with operation cut and target_id the shell, for a
   recess the lid sits in.

A model cut in two for printing:
1. import_model the library model; split it with plane { point: [0, 0, h / 2], normal: [0, 0, 1] }.
2. Optionally hole both parts at matching points for dowel pins.

A name tag:
1. add_box 60 × 20 × 3; fillet its four vertical edges with radius 3.
2. add_text "Ada" size 10, height 1, on the top face ([0, 0, 3], [0, 0, 1]) with target_id the fillet.

Look at the result with studio_view_design (iso, top, front, right...) as you go.
`;
