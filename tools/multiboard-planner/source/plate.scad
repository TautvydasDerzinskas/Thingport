// A MultiBoard Octagon Plate, generated rather than stored.
//
// Every dimension here was measured off the plates the planner fetches, with source/fidelity.mjs: a plate is a
// 25 mm grid of walls with an octagonal opening in each cell, a threaded hole at each interior wall junction, and
// a lead-in taper into every bore from both faces (the plates are symmetrical, so top and bottom match).
//
// Both bores are threaded, and both threads are made the way the parts themselves are: a cross-section extruded
// with `twist`, which sweeps a true single-start helix. The multihole's cross-section is a regular octagon -- the
// measured across-corners/across-flats ratio is 1/cos(22.5) to four decimals -- and the pegboard hole's is a
// circle with one trapezoidal thread ridge.

/* [Plate] */
// Cells across, which also sets the plate's size: a plain plate is exactly this many 25 mm cells.
cells = 4; // [2:16]

/* [Hidden] */
GRID = 25;      // cell pitch, both lattices
TH   = 6.2;     // plate thickness

// Multihole: the big octagonal opening at each cell centre.
MULTI_FLAT_THREAD = 10.804;  // across-flats radius through the threaded middle
MULTI_FLAT_FACE   = 11.660;  // across-flats radius where the lead-in meets the face
MULTI_TAPER       = 2.05;    // height of the lead-in taper at each face
MULTI_PITCH       = 2.5;     // thread lead, mm per turn
MULTI_RIDGE       = 0.33;    // how far the thread cuts out past the octagon, measured as an order-1 harmonic
MULTI_CREST       = 0.25;    // share of one turn the ridge is clear of

// Pegboard hole: the small threaded hole at each interior wall junction.
PEG_MINOR   = 2.997;   // thread crest (the narrowest the bore gets)
PEG_MAJOR   = 3.500;   // thread root
PEG_FACE    = 3.950;   // radius at the face, before the chamfer
PEG_CHAMFER = 0.5;     // depth of the 45-degree chamfer at each face
PEG_PITCH   = 3.125;   // thread lead, mm per turn
PEG_CREST   = 0.228;   // share of one turn spent at the crest, measured as 82 degrees of 360

// The interfit groove. A plain plate carries a slot at each of its edge wall junctions, which is what the
// Interfitted variants' tabs reach into -- measured at the edge of a plain plate, where the silhouette steps
// back from 50.000 to 44.600 between z 1.35 and 4.85 while the cell centres stay full height.
GROOVE_W = 6.0;    // along the edge
GROOVE_D = 5.4;    // into the plate
GROOVE_H = 3.5;    // tall, centred on mid-thickness

// Facets. The bores carry every curve here, so these drive both fidelity and render time.
SIDES  = 180;  // angular samples around a pegboard bore
SLICES = 8;    // extrusion slices per millimetre of height

side = cells * GRID;

// Radius of a regular octagon's boundary, given the radius to its flats.
function oct_r(flat) = flat / cos(22.5);

/** One turn of the pegboard thread, as radius against phase: crest, ramp out, root, ramp back. */
function peg_profile(phase) =
  let (ramp = (1 - PEG_CREST - PEG_CREST) / 2)
  phase < PEG_CREST            ? PEG_MINOR
  : phase < PEG_CREST + ramp   ? PEG_MINOR + (PEG_MAJOR - PEG_MINOR) * (phase - PEG_CREST) / ramp
  : phase < 1 - ramp           ? PEG_MAJOR
  :                              PEG_MAJOR - (PEG_MAJOR - PEG_MINOR) * (phase - (1 - ramp)) / ramp;

/** A regular octagon's boundary radius at one angle, given the radius to its flats. */
function oct_at(a, flat) = flat / cos(((a + 22.5) % 45) - 22.5);

/** One turn of the multihole thread, as how far it cuts out past the octagon. */
function multi_profile(phase) =
  let (ramp = (1 - MULTI_CREST - MULTI_CREST) / 2)
  phase < MULTI_CREST          ? 0
  : phase < MULTI_CREST + ramp ? MULTI_RIDGE * (phase - MULTI_CREST) / ramp
  : phase < 1 - ramp           ? MULTI_RIDGE
  :                              MULTI_RIDGE * (1 - (phase - (1 - ramp)) / ramp);

/** The multihole's cross-section: the octagon, with one thread ridge cut into it. Twisting it sweeps the helix,
 *  and the ridge is what makes that helix single-start rather than eight-fold symmetric. */
module multi_section() {
  polygon([for (i = [0:SIDES-1])
    let (a = 360 * i / SIDES, r = oct_at(a, MULTI_FLAT_THREAD) + multi_profile(i / SIDES))
      [r * cos(a), r * sin(a)]]);
}

/** The pegboard bore's cross-section: a circle with one thread ridge, so twisting it sweeps a single-start helix. */
module peg_section() {
  polygon([for (i = [0:SIDES-1])
    let (a = 360 * i / SIDES, r = peg_profile(i / SIDES)) [r * cos(a), r * sin(a)]]);
}

/** A bore through the whole plate, threaded by twisting its cross-section as it extrudes. */
module threaded_bore(pitch, h) {
  linear_extrude(height = h, twist = -360 * h / pitch, slices = max(2, ceil(h * SLICES)), convexity = 10)
    children();
}

/** The volume a multihole takes out: a twisted octagon, plus the lead-in taper at each face. */
module multihole() {
  h = TH + 2;
  translate([0, 0, -1]) threaded_bore(MULTI_PITCH, h) multi_section();
  // Lead-ins. The faces are a plain taper rather than thread, so they are simple frustums.
  for (m = [0, 1]) translate([0, 0, m ? TH : 0]) mirror([0, 0, m ? 1 : 0])
    translate([0, 0, -0.01]) linear_extrude(height = MULTI_TAPER + 0.01, scale = oct_r(MULTI_FLAT_THREAD) / oct_r(MULTI_FLAT_FACE))
      circle(r = oct_r(MULTI_FLAT_FACE), $fn = 8);
}

/** The volume a pegboard hole takes out: the threaded bore, plus a 45-degree chamfer at each face. */
module peghole() {
  h = TH + 2;
  translate([0, 0, -1]) threaded_bore(PEG_PITCH, h) peg_section();
  for (m = [0, 1]) translate([0, 0, m ? TH : 0]) mirror([0, 0, m ? 1 : 0])
    translate([0, 0, -0.01]) linear_extrude(height = PEG_CHAMFER + 0.01, scale = (PEG_FACE - PEG_CHAMFER) / PEG_FACE)
      circle(r = PEG_FACE, $fn = SIDES);
}

/** The slot at one edge wall junction, cut from the +X edge inwards. */
module groove() {
  translate([side/2 - GROOVE_D, -GROOVE_W/2, (TH - GROOVE_H) / 2])
    cube([GROOVE_D + 1, GROOVE_W, GROOVE_H]);
}

module plate() {
  difference() {
    translate([-side/2, -side/2, 0]) cube([side, side, TH]);
    // A multihole in every cell.
    for (i = [0:cells-1], j = [0:cells-1])
      translate([(i + 0.5) * GRID - side/2, (j + 0.5) * GRID - side/2, 0]) multihole();
    // A pegboard hole at every interior wall junction. The plate's edge runs down the middle of an edge
    // wall, so the junctions on it are half-walls with no hole.
    for (i = [1:cells-1], j = [1:cells-1])
      translate([i * GRID - side/2, j * GRID - side/2, 0]) peghole();
    // An interfit groove at every edge junction, on all four edges. The plate's corners are not junctions,
    // so the grooves stop one cell short at each end.
    for (edge = [0:3]) rotate([0, 0, 90 * edge])
      for (i = [1:cells-1]) translate([0, i * GRID - side/2, 0]) groove();
  }
}

plate();
