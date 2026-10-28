// A MultiBoard Octagon Plate, generated rather than stored.
//
// Every dimension here was measured off the plates the planner fetches, with source/fidelity.mjs: a plate is a
// 25 mm grid of walls with an octagonal opening in each cell, a threaded hole at each interior wall junction, a
// lead-in taper into every bore from both faces, and an interfit slot at each edge junction. The plates are
// symmetrical, so top and bottom match.
//
// The two bores are threaded differently, and the harmonics of their cross-sections are what say how:
//
//   - the pegboard hole is round, and its order-1 harmonic is all there is, rotating with height: one
//     single-start helix, swept by extruding the cross-section with `twist`.
//   - the multihole is an octagon that does NOT rotate -- its order-8 phase holds at 22.5 degrees all the way
//     through, so its flats face the axes at every height -- with a single-start helical groove cut into the
//     wall, which is the order-1 component rotating at 2.5 mm per turn on top of it. So it is built as a
//     stationary octagonal prism unioned with one twisted sector, rather than as a twisted octagon.

/* [Plate] */
// Cells across, which also sets the plate's size: a plain plate is exactly this many 25 mm cells.
cells = 4; // [2:16]

/* [Interfit] */
// Whether a plate sits alongside this one on each side. Where one does on +X or +Y this plate carries the
// pads that reach into it; where one does on -X or -Y it carries the notches its neighbour's pads reach
// into. A side facing nothing is left plain. Every one of the sixteen plates the planner lists is one of
// these sixteen combinations: "Center" has neighbours all round, "Top Left" none above or to the left,
// "Center Horizontal Strip" none above or below, and the plain plate none at all.
neighbour_px = false;
neighbour_py = false;
neighbour_mx = false;
neighbour_my = false;

/* [Hidden] */
GRID = 25;      // cell pitch, both lattices
TH   = 6.2;     // plate thickness

// Multihole and pegboard hole. Both follow the construction the Multiboard component files use -- see
// SCAD/multiboard_base.scad, whose dimensions come from the remixing files at than.gs/m/994681: a bore
// wider at both faces narrowing to a straight middle, with a helical thread whose cross-section, in radius
// and height, is a trapezoid -- tall where it meets the bore wall, narrow at its deepest.
//
// Sizes are across the flats for the multihole's octagon, across the diameter for the pegboard hole. Where
// those files and the plates the planner fetches disagree the plates win, since they are what a user's own
// parts have to mate with; each disagreement is noted.

MULTI_THIN   = 23.4;    // across the flats at the face
MULTI_THICK  = 21.4;    // across the flats through the middle
MULTI_FLAT_H = 2.10;    // how much of the height is at MULTI_THICK
MULTI_TH_D1  = 22.6;    // the thread's outer diameter
MULTI_TH_D2  = 21.2;    //   and its inner one. A touch inside the bore wall, so the two always overlap:
                        // left exactly equal, the thread's facets and the bore's leave ridges between them
MULTI_TH_H1  = 0.50;    // how tall the thread is at that outer diameter
MULTI_TH_H2  = 1.583;   //   and where it meets the wall
MULTI_PITCH  = 2.5;     // thread lead, mm per turn
MULTI_PHASE  = 249.6;   // where the helix starts, set from the order-1 phase of the plates

PEG_THIN     = 7.90;    // across the diameter at the face; the component files say 7.5, the plates 7.90
PEG_THICK    = 6.00;    // through the middle
PEG_FLAT_H   = 4.10;    // how much of the height is at PEG_THICK; the component files say 2.9
PEG_TH_D1    = 7.00;    // the thread's outer diameter
PEG_TH_D2    = 5.80;    //   and its inner one, likewise sunk inside the wall
PEG_TH_H1    = 0.77;    // how tall the thread is at that outer diameter
PEG_TH_H2    = 2.50;    //   and where it meets the wall
PEG_PITCH    = 3.1236;  // thread lead. The component files say 3.0, which would drift a quarter of a
                        // millimetre over the bore; the plates measure 115.25 degrees a millimetre.
PEG_PHASE    = -51.4;   // where the helix starts, set from the order-1 phase of the plates

// The interfit slot at each edge wall junction, which is what the Interfitted variants' tabs reach into.
// It is a dovetail, not a plain slot: tracing the void across its depth, the cavity flares from 5.10 mm wide
// at its inner end out to 10.80 mm, then steps back to a 6.00 mm mouth at the edge. The flare is why a plate's
// edge cells open into it -- the cavity is wider than the 3.6 mm wall it crosses, so it breaks into the two
// multiholes either side, which is what makes a plain plate enclose 13 cross-sections here rather than 25.
SLOT_D        = 5.40;    // total depth from the edge
SLOT_INNER_W  = 4.30;    // width at the inner end
SLOT_FLARE    = 1.40;    // length of the 45-degree flare out of that inner end
SLOT_CAVITY_W = 6.94;    // width once the flare is done, held to the mouth
SLOT_TAPER_D  = 2.40;    // where the cavity starts narrowing towards the mouth
SLOT_MOUTH_D  = 1.60;    // where it has finished narrowing, and the mouth runs out to the edge
SLOT_W        = 6.00;    // mouth width
SLOT_FACE_W   = 6.80;    // and at the face, where it flares again as a lead-in, each side at 45 degrees
SLOT_FACE_D   = 0.40;    // over how much of the depth that flare runs
// The cavity does reach a little past the mouth, which is why a plain plate shows a closed pocket per slot
// just below and above it, but those pockets measure under 5 mm2 and are left out here: modelling the cavity
// as starting with the mouth is both closer on area and right on the cross-section count.
SLOT_Z0       = 1.40;    // where it starts
SLOT_Z1       = 4.80;    // where it ends, keeping it square about mid-thickness

// A narrow groove across the slot, cut a little above and below it, which is what gives the cavity its
// step: look into a latch from a low angle and the ceiling is flat but for this.
NOTCH_INSET   = 3.25;    // from the edge to its outer side
NOTCH_D       = 0.40;    // across it
NOTCH_Z0      = 1.20;    // where it starts, 0.2 below the slot
NOTCH_Z1      = 5.00;    //   and ends, 0.2 above

// The relief channel that runs right round the plate just inside its rim, over the same heights as the
// multiholes' threaded middles. Near a cell centre the octagon already reaches past it, so it is invisible
// there; it shows only where the octagon's diagonal pulls back, and it is what joins each perimeter multihole
// to the interfit slot beside it.
CH_INSET     = 2.16;   // from the edge to the channel's outer wall
CH_WIDTH     = 2.00;   // across the channel
CH_Z0        = 2.05;   // where it starts
CH_Z1        = 4.15;   // where it ends
CH_CHAMFER_X = 0.50;   // corner chamfer, across
CH_CHAMFER_Z = 0.60;   // corner chamfer, up
CH_END       = 10.00;   // how far back from each corner the channel is cut off, on the same 45 degrees as
                       // the chamfer. Ended square instead it runs out through the chamfer at the corner,
                       // leaving a gash there where the plates are walled.

// The socket in each corner's chamfer face. Measured along that face and straight into it, it is a blind
// recess: open across its middle, walled off 1.00 mm back, with the plate's interior starting separately
// behind that wall. It is not the relief channel reaching the corner -- the channel stops at its rib well
// before here -- so it is cut as its own box, square to the chamfer.
SOCKET_W  = 6.20;      // along the chamfer face
SOCKET_D  = 0.90;      // into the plate from it
SOCKET_Z0 = 1.95;      // where it starts
SOCKET_Z1 = 4.35;      // where it ends

// The corner chamfer. A plate's two edge walls do not meet at its corner: the outline is cut at 45 degrees,
// leaving a diagonal wall as thick as the straight ones. Asking for that gives the leg outright, and the
// multihole's radius cancels out of it:
//
//   leg = 25 - 12.5 * sqrt(2) = 7.322 mm
//
// which is also, not by coincidence, the 7.322 mm by which an Interfitted plate is larger than a plain one.
CORNER_CHAMFER = 25 - 12.5 * sqrt(2);

// An interfit pad is a diamond on a junction, reaching this far from it, with a pegboard hole through the
// middle. The notch that receives one is the same diamond taken out of the facing edge. It is the same
// 7.322 mm again -- the plate's outline is drawn on the same octagonal lattice as its cells.
PAD = 25 - 12.5 * sqrt(2);

// Facets. The bores carry every curve here, so these drive both fidelity and render time.
SIDES  = 180;  // angular samples around a pegboard bore
THREAD_FN = 64;  // segments per turn of a thread helix

side = cells * GRID;

/** The circumradius of a regular octagon, given the distance across its flats. */
function oct_circ(flats) = flats / (2 * cos(22.5));

/** A bore wider at both faces and straight through the middle: the profile turned about the axis. At
 *  $fn = 8, turned 22.5 degrees, this is the multihole's octagon with its flats facing the axes. */
module tapered_bore(outer_r, inner_r, flat_h) {
  rotate_extrude(convexity = 4)
    polygon([
      [0,       -1],
      [outer_r, -1],
      [outer_r, 0],
      [inner_r, (TH - flat_h) / 2],
      [inner_r, (TH + flat_h) / 2],
      [outer_r, TH],
      [outer_r, TH + 1],
      [0,       TH + 1],
    ]);
}

/** A helical thread, trapezoidal in radius and height: `h2` tall where it meets the bore wall at `d2`,
 *  narrowing to `h1` at its deepest, `d1`. The section turns about the axis while its shape stays in the
 *  radius-height plane, which no extrusion expresses, so it is swept as a polyhedron a turn at a time. */
module trapz_thread(d1, d2, h1, h2, len, pitch, steps) {
  profile = [[d1/2, -h1/2], [d1/2, h1/2], [d2/2, h2/2], [d2/2, -h2/2]];
  n = round(steps * len / pitch);
  pts = [for (i = [0:n]) each [for (q = profile)
          [q[0] * cos(360 * i / steps), q[0] * sin(360 * i / steps), q[1] + i * pitch / steps]]];
  polyhedron(
    points = pts,
    faces = [
      [3, 2, 1, 0],
      each [for (i = [0:n-1], k = [0:3])
        [i * 4 + k, (i + 1) * 4 + k, (i + 1) * 4 + (k + 1) % 4, i * 4 + (k + 1) % 4]],
      [n * 4, n * 4 + 1, n * 4 + 2, n * 4 + 3],
    ],
    convexity = 10);
}

/** The volume a multihole takes out: the octagonal bore, and the thread cut into its wall. */
module multihole() {
  rotate(22.5) tapered_bore(oct_circ(MULTI_THIN), oct_circ(MULTI_THICK), MULTI_FLAT_H, $fn = 8);
  rotate(MULTI_PHASE) translate([0, 0, -MULTI_TH_H2 / 2])
    trapz_thread(MULTI_TH_D1, MULTI_TH_D2, MULTI_TH_H1, MULTI_TH_H2, TH + MULTI_TH_H2, MULTI_PITCH, THREAD_FN);
}

/** The volume a pegboard hole takes out: the round bore, and the thread cut into its wall. */
module peghole() {
  rotate(PEG_PHASE) {
    tapered_bore(PEG_THIN / 2, PEG_THICK / 2, PEG_FLAT_H, $fn = SIDES);
    translate([0, 0, -PEG_TH_H2 / 2])
      trapz_thread(PEG_TH_D1, PEG_TH_D2, PEG_TH_H1, PEG_TH_H2, TH + PEG_TH_H2, PEG_PITCH, THREAD_FN);
  }
}

/** The interfit slot at one edge wall junction, cut in from the +X edge. */
module slot() {
  e = side / 2;
  translate([0, 0, SLOT_Z0]) linear_extrude(height = SLOT_Z1 - SLOT_Z0, convexity = 6)
    polygon([
      [e - SLOT_D,               SLOT_INNER_W / 2],
      [e - SLOT_D + SLOT_FLARE,  SLOT_CAVITY_W / 2],
      [e - SLOT_TAPER_D,         SLOT_CAVITY_W / 2],
      [e - SLOT_MOUTH_D,         SLOT_W / 2],
      [e - SLOT_FACE_D,          SLOT_W / 2],
      [e,                        SLOT_FACE_W / 2],
      [e + 1,                    SLOT_FACE_W / 2],
      [e + 1,                   -SLOT_FACE_W / 2],
      [e,                       -SLOT_FACE_W / 2],
      [e - SLOT_FACE_D,         -SLOT_W / 2],
      [e - SLOT_MOUTH_D,        -SLOT_W / 2],
      [e - SLOT_TAPER_D,        -SLOT_CAVITY_W / 2],
      [e - SLOT_D + SLOT_FLARE, -SLOT_CAVITY_W / 2],
      [e - SLOT_D,              -SLOT_INNER_W / 2],
    ]);
  translate([e - NOTCH_INSET - NOTCH_D, -SLOT_CAVITY_W / 2, NOTCH_Z0])
    cube([NOTCH_D, SLOT_CAVITY_W, NOTCH_Z1 - NOTCH_Z0]);
}

/** The channel's cross-section, in X and Z. */
module channel_profile() {
  x1 = side/2 - CH_INSET;
  x0 = x1 - CH_WIDTH;
  polygon([
    [x0 + CH_CHAMFER_X, CH_Z0],
    [x0,                CH_Z0 + CH_CHAMFER_Z],
    [x0,                CH_Z1 - CH_CHAMFER_Z],
    [x0 + CH_CHAMFER_X, CH_Z1],
    [x1 - CH_CHAMFER_X, CH_Z1],
    [x1,                CH_Z1 - CH_CHAMFER_Z],
    [x1,                CH_Z0 + CH_CHAMFER_Z],
    [x1 - CH_CHAMFER_X, CH_Z0],
  ]);
}

/** The plate's outline drawn back at the corners by `c`, which is what the relief channel is cut to. */
module channel_limit(c) {
  s = side / 2;
  polygon([
    [s - c, s], [-s + c, s], [-s, s - c], [-s, -s + c],
    [-s + c, -s], [s - c, -s], [s, -s + c], [s, s - c],
  ]);
}

/** The relief channel along the +X edge: its cross-section swept the length of the edge, then cut back at
 *  each corner on the chamfer's own 45 degrees. Past that cut the plates carry a socket in the chamfer
 *  face itself, not more channel. */
module channel() {
  intersection() {
    translate([0, side/2 + 1, 0]) rotate([90, 0, 0])
      linear_extrude(height = side + 2, convexity = 6) channel_profile();
    translate([0, 0, -1]) linear_extrude(height = TH + 2, convexity = 4) channel_limit(CH_END);
  }
}

/** The socket recessed into the +X+Y corner's chamfer face. */
module corner_socket() {
  s = side / 2;
  back = CORNER_CHAMFER / sqrt(2);
  translate([s, s, 0]) rotate([0, 0, 45])
    translate([-back - SOCKET_D, -SOCKET_W / 2, SOCKET_Z0])
      cube([SOCKET_D + 1, SOCKET_W, SOCKET_Z1 - SOCKET_Z0]);
}

/** The wedge taken off the +X+Y corner, so the outline is chamfered rather than square.
 *
 *  Everything past the line x + y = 2s - CORNER_CHAMFER goes, which is a half-plane: taken as a box
 *  turned 45 degrees and set back from the corner by the chamfer's own perpendicular distance. Built as
 *  a triangle through overshot points instead, the overshoot moves the line and the chamfer comes out
 *  shallow -- by exactly the overshoot, which is a millimetre of plate down every edge of every corner. */
module corner_cut() {
  s = side / 2;
  back = CORNER_CHAMFER / sqrt(2);
  translate([s, s, 0]) rotate([0, 0, 45])
    translate([-back, -side, -1]) cube([side, 2 * side, TH + 2]);
}

/** A diamond on a junction: the shape of a pad, and of the notch that receives one. */
module diamond() {
  polygon([[PAD, 0], [0, PAD], [-PAD, 0], [0, -PAD]]);
}

/** Where the pads sit along one edge, as offsets from the plate's near corner. The run always reaches the
 *  far corner; it starts at the near one only when no neighbour on that side would supply it. */
function pad_steps(near_neighbour) = [for (i = [near_neighbour ? 1 : 0 : cells]) i * GRID - side / 2];

module plate() {
  difference() {
    union() {
      translate([-side/2, -side/2, 0]) cube([side, side, TH]);
      // Pads, where a plate sits alongside. A pad on a corner belongs to both its edges, so it is cut back
      // to the plate's own outline on any side with nothing beyond: a plate reaches past its edge only
      // where a neighbour is there to receive it, never backwards and never into open air.
      intersection() {
        union() {
          if (neighbour_px)
            for (y = pad_steps(neighbour_my)) translate([side/2, y, 0]) linear_extrude(TH) diamond();
          if (neighbour_py)
            for (x = pad_steps(neighbour_mx)) translate([x, side/2, 0]) linear_extrude(TH) diamond();
        }
        translate([-side/2, -side/2, -1])
          cube([side + (neighbour_px ? PAD + 1 : 0), side + (neighbour_py ? PAD + 1 : 0), TH + 2]);
      }
    }
    for (i = [0:cells-1], j = [0:cells-1])
      translate([(i + 0.5) * GRID - side/2, (j + 0.5) * GRID - side/2, 0]) multihole();
    // A pegboard hole at every interior wall junction. The plate's edge runs down the middle of an edge
    // wall, so the junctions on it carry a slot instead.
    for (i = [1:cells-1], j = [1:cells-1])
      translate([i * GRID - side/2, j * GRID - side/2, 0]) peghole();
    // A corner carrying a pad is not chamfered and has no socket: the pad is what is there instead. The
    // four are taken in the order the rotation visits them: +X+Y, -X+Y, -X-Y, +X-Y.
    padded = [
      neighbour_px || neighbour_py,
      neighbour_py && !neighbour_mx,
      false,
      neighbour_px && !neighbour_my,
    ];
    // The relief channel runs only along a side facing nothing: where a plate sits alongside, the pads or
    // notches are what is at the rim instead. The rotation visits the sides as +X, +Y, -X, -Y.
    facing = [neighbour_px, neighbour_py, neighbour_mx, neighbour_my];
    for (edge = [0:3]) rotate([0, 0, 90 * edge]) {
      for (i = [1:cells-1]) translate([0, i * GRID - side/2, 0]) slot();
      if (!facing[edge]) channel();
      if (!padded[edge]) {
        corner_cut();
        corner_socket();
      }
    }
    // A pegboard hole through every pad, and a notch wherever a neighbour's pad reaches in.
    if (neighbour_px) for (y = pad_steps(neighbour_my)) translate([side/2, y, 0]) peghole();
    if (neighbour_py) for (x = pad_steps(neighbour_mx)) translate([x, side/2, 0]) peghole();
    if (neighbour_mx)
      for (i = [1:cells]) translate([-side/2, i * GRID - side/2, -1]) linear_extrude(TH + 2) diamond();
    if (neighbour_my)
      for (i = [1:cells]) translate([i * GRID - side/2, -side/2, -1]) linear_extrude(TH + 2) diamond();
  }
}

plate();
