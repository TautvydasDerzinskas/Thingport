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

/* [Hidden] */
GRID = 25;      // cell pitch, both lattices
TH   = 6.2;     // plate thickness

// Multihole: the big octagonal opening at each cell centre. Radii are to the octagon's flats.
MULTI_FLAT_THREAD = 10.700;  // through the threaded middle, measured as the cross-section's minimum radius
MULTI_FLAT_FACE   = 11.699;  // at the face itself: the taper measures 11.650 at z=0.1, falling 0.487 per mm
MULTI_TAPER       = 2.05;    // height of the lead-in taper at each face
MULTI_PITCH       = 2.5;     // lead of the helical groove, mm per turn
MULTI_GROOVE_R    = 11.26;   // how far that groove cuts out from the axis; set by the order-1 amplitude
MULTI_GROOVE_SPAN = 125;     // degrees of each turn it occupies; set by the order-8 amplitude
MULTI_GROOVE_PHASE = 160.8;  // where the helix starts, set from the order-1 phase of the plates

// Pegboard hole: the small threaded hole at each interior wall junction.
PEG_MINOR   = 2.997;   // thread crest (the narrowest the bore gets)
PEG_MAJOR   = 3.500;   // thread root
PEG_FACE    = 4.000;   // radius at the face, before the chamfer; the bore measures 3.950 at z=0.05
PEG_CHAMFER = 0.5;     // depth of the 45-degree chamfer at each face
PEG_PITCH   = 3.125;   // thread lead, mm per turn
PEG_CREST   = 0.228;   // share of one turn spent at the crest, measured as 82 degrees of 360
PEG_PHASE   = 116.6;   // where the helix starts, set from the order-1 phase of the plates

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
SLOT_Z0       = 1.50;    // where it starts
SLOT_Z1       = 4.85;    // where it ends

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
CH_CORNER    = 6.20;   // how far short of each corner the main run stops: the plates close it off with a rib
                       // there, where the corner cell's octagon runs out, rather than letting it cross
CH_RIB       = 1.00;   // how wide that rib is

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

// Facets. The bores carry every curve here, so these drive both fidelity and render time.
SIDES  = 180;  // angular samples around a pegboard bore
SLICES = 20;   // extrusion slices per millimetre of height; at 8 the helix is too faceted and the
               // multihole's order-8 amplitude reads 0.245 against the plates' 0.231, at 20 it matches

side = cells * GRID;

/** A regular octagon with its flats facing the axes, given the radius to those flats. */
module octagon(flat) { rotate(22.5) circle(r = flat / cos(22.5), $fn = 8); }

/** One turn of the pegboard thread, as radius against phase: crest, ramp out, root, ramp back. */
function peg_profile(phase) =
  let (ramp = (1 - PEG_CREST - PEG_CREST) / 2)
  phase < PEG_CREST            ? PEG_MINOR
  : phase < PEG_CREST + ramp   ? PEG_MINOR + (PEG_MAJOR - PEG_MINOR) * (phase - PEG_CREST) / ramp
  : phase < 1 - ramp           ? PEG_MAJOR
  :                              PEG_MAJOR - (PEG_MAJOR - PEG_MINOR) * (phase - (1 - ramp)) / ramp;

/** The pegboard bore's cross-section: a circle with one thread ridge, so twisting it sweeps a single-start helix. */
module peg_section() {
  rotate(PEG_PHASE)
  polygon([for (i = [0:SIDES-1])
    let (a = 360 * i / SIDES, r = peg_profile(i / SIDES)) [r * cos(a), r * sin(a)]]);
}

/** The sector the multihole's helical groove sweeps. Twisting it cuts the groove; it reaches the axis, which
 *  is already open, so unioning it with the octagon leaves only the groove behind. */
module multi_groove_section() {
  steps = max(8, ceil(MULTI_GROOVE_SPAN / 2));
  rotate(MULTI_GROOVE_PHASE)
  polygon([[0, 0], each [for (i = [0:steps])
    let (a = i * MULTI_GROOVE_SPAN / steps) [MULTI_GROOVE_R * cos(a), MULTI_GROOVE_R * sin(a)]]]);
}

/** The volume a multihole takes out: a stationary octagonal prism, the helical groove in its wall, and the
 *  lead-in taper at each face. */
module multihole() {
  h = TH + 2;
  translate([0, 0, -1]) {
    linear_extrude(height = h, convexity = 4) octagon(MULTI_FLAT_THREAD);
    linear_extrude(height = h, twist = -360 * h / MULTI_PITCH, slices = max(2, ceil(h * SLICES)), convexity = 10)
      multi_groove_section();
  }
  for (m = [0, 1]) translate([0, 0, m ? TH : 0]) mirror([0, 0, m ? 1 : 0]) translate([0, 0, -0.01])
    linear_extrude(height = MULTI_TAPER + 0.01, scale = MULTI_FLAT_THREAD / MULTI_FLAT_FACE, convexity = 4)
      octagon(MULTI_FLAT_FACE);
}

/** The volume a pegboard hole takes out: the threaded bore, plus a 45-degree chamfer at each face. */
module peghole() {
  h = TH + 2;
  translate([0, 0, -1])
    linear_extrude(height = h, twist = -360 * h / PEG_PITCH, slices = max(2, ceil(h * SLICES)), convexity = 10)
      peg_section();
  for (m = [0, 1]) translate([0, 0, m ? TH : 0]) mirror([0, 0, m ? 1 : 0]) translate([0, 0, -0.01])
    linear_extrude(height = PEG_CHAMFER + 0.01, scale = (PEG_FACE - PEG_CHAMFER) / PEG_FACE)
      circle(r = PEG_FACE, $fn = SIDES);
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

/** The relief channel along the +X edge: its cross-section swept the length of the edge, stopping at a rib
 *  short of each corner. Past that rib the plates carry a socket in the chamfer itself, not more channel. */
module channel() {
  translate([0, side/2 - CH_CORNER, 0]) rotate([90, 0, 0])
    linear_extrude(height = side - 2 * CH_CORNER, convexity = 6) channel_profile();
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

module plate() {
  difference() {
    translate([-side/2, -side/2, 0]) cube([side, side, TH]);
    for (i = [0:cells-1], j = [0:cells-1])
      translate([(i + 0.5) * GRID - side/2, (j + 0.5) * GRID - side/2, 0]) multihole();
    // A pegboard hole at every interior wall junction. The plate's edge runs down the middle of an edge
    // wall, so the junctions on it carry a slot instead.
    for (i = [1:cells-1], j = [1:cells-1])
      translate([i * GRID - side/2, j * GRID - side/2, 0]) peghole();
    for (edge = [0:3]) rotate([0, 0, 90 * edge]) {
      for (i = [1:cells-1]) translate([0, i * GRID - side/2, 0]) slot();
      channel();
      corner_cut();
      corner_socket();
    }
  }
}

plate();
