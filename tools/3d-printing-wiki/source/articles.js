// Original guide text. Sources and the applicable printer or material manuals are linked in each article.
import { history } from "./history.js";
import { printers } from "./printers.js";
import { guide, prusa } from "./references.js";
import { studyGuides, termStudies } from "./settings.js";
import { issues } from "./troubleshooting.js";

const materialGuide = "https://help.prusa3d.com/filament-material-guide";

function material(id, title, name, uses, setup, limits, related, source = materialGuide) {
  return { id, title, summary: name, uses, setup, limits, related, source, section: "Materials" };
}

export const materials = [
  material(
    "pla",
    "PLA",
    "Polylactic acid · easy to print",
    "Use PLA for appearance models, fit checks, prototypes and rigid indoor parts at room temperature. It holds fine detail and generally warps less than ABS.",
    "Start with the maker’s PLA preset and a compatible build plate. Use the preset’s cooling for overhangs and short layers. Increase print temperature or lower speed within the recommended range if fusion is poor.",
    "Standard PLA tends to soften in hot environments such as a parked car. It can snap under impact and creep under sustained load. Check the grade’s datasheet for the actual requirements.",
    ["temperature-cooling", "petg", "asa", "first-layer"],
  ),
  material(
    "petg",
    "PETG",
    "Glycol-modified PET · tough general-purpose parts",
    "Use PETG for brackets, containers and workshop items that benefit from better toughness and heat tolerance than typical PLA.",
    "Start from a PETG profile. Use a plate approved for PETG or a manufacturer-approved release layer. Some PETG sticks strongly enough to damage smooth PEI. Tune stringing with dry filament first.",
    "PETG can leave more strings than PLA and may sag across long bridges. Properties vary by blend. A filament designation alone cannot establish that a printed part is suitable for food contact.",
    ["temperature-cooling", "filament-drying", "pla", "stringing", "poor-bridging"],
  ),
  material(
    "abs",
    "ABS",
    "Acrylonitrile butadiene styrene · heat-resistant housings",
    "Use ABS for rigid housings, jigs and parts that need better heat tolerance than standard PLA.",
    "Use a printer and plate rated for the preset. A stable, draft-free enclosure can reduce shrinkage and splitting. Follow the printer and filament maker’s guidance for ventilation. A closed chamber alone does not remove emissions.",
    "Large flat sections can lift or split as they cool. Choose ASA when outdoor UV exposure is the main concern.",
    ["asa", "warping", "layer-separation"],
  ),
  material(
    "asa",
    "ASA",
    "Acrylonitrile styrene acrylate · outdoor parts",
    "Use ASA for outdoor enclosures, fixtures and signage where weather and UV resistance matter.",
    "Use a compatible enclosed printer, heated bed and plate with the ASA preset. Keep drafts away and follow the equipment and material guidance for ventilation.",
    "Like ABS, ASA can shrink and lift on large flat parts. Verify the grade and test the printed part for its actual load, temperature and exposure.",
    ["temperature-cooling", "filament-drying", "abs", "warping", "layer-separation"],
  ),
  material(
    "tpu",
    "TPU",
    "Thermoplastic polyurethane · flexible prints",
    "Use TPU for bumpers, grips, flexible feet and protective covers. Shore hardness describes how soft the material is. Lower values on the same Shore scale generally indicate a softer grade.",
    "Print from dry filament at the manufacturer’s recommended speed. A short, well-constrained feed path helps keep very soft filament from buckling. Start with the preset’s retraction and verify plate compatibility.",
    "Soft grades can be difficult to feed through long Bowden paths or some automatic spool systems. Thin walls and sparse infill flex more than solid sections.",
    ["filament-drying", "wet-filament", "retraction", "extruder"],
  ),
  material(
    "nylon",
    "PA / Nylon",
    "Polyamide · wear resistance and toughness",
    "Use appropriate PA grades for wear surfaces, clips and tough mechanical parts. Different polyamides and blends have very different stiffness and moisture behavior.",
    "Dry the spool to the maker’s specification before printing. A dry box can keep it dry while printing. Use the specified build surface and stable chamber conditions when the grade calls for them.",
    "Moisture changes how PA prints and can affect dimensions and stiffness after printing. PA is also prone to shrinkage. Filled PA usually needs an abrasion-resistant nozzle.",
    ["filament-drying", "wet-filament", "composites", "warping"],
  ),
  material(
    "pc",
    "PC",
    "Polycarbonate · stiff parts for higher temperatures",
    "Use PC or a compatible PC blend for strong, stiff parts that experience more heat than typical PLA or PETG parts can tolerate.",
    "Confirm the machine can hold the grade’s nozzle and bed temperatures safely. A compatible enclosure, plate and dry spool help with larger prints.",
    "PC can warp, bond strongly to some surfaces and demand temperatures beyond an entry-level hotend’s rating. Blends have different properties from unfilled PC.",
    ["abs", "nylon", "warping"],
  ),
  material(
    "pp",
    "PP",
    "Polypropylene · lightweight and fatigue-resistant",
    "Use a suitable PP grade to try living hinges or lightweight parts that need chemical resistance. Test load and chemical exposure on a printed sample.",
    "Use a PP-compatible surface or the manufacturer’s recommended adhesion method. A brim and a stable environment can help with peeling edges.",
    "PP is difficult to use with many common build surfaces and can shrink considerably. Print orientation matters for a flexing hinge.",
    ["brim", "warping", "anisotropy"],
  ),
  material(
    "composites",
    "Fiber-filled filaments",
    "Carbon or glass fiber added to a base polymer",
    "Use chopped-fiber composites such as PA-CF or PETG-CF when you need more stiffness or better dimensional stability than the unfilled grade can give.",
    "Check the base polymer’s temperature and drying requirements. Use a wear-resistant nozzle and the minimum nozzle diameter specified for the filament.",
    "Chopped fibers do not reinforce every direction equally. Layer bonding and impact strength depend on the blend and settings. A stiffer material is not automatically tougher.",
    ["nylon", "petg", "anisotropy"],
  ),
  material(
    "soluble",
    "PVA / BVOH",
    "Water-soluble materials for temporary supports",
    "Use soluble supports for enclosed channels and intricate overhangs when mechanical removal would damage the part. Soluble support interfaces can reduce material use.",
    "Use compatible build and support materials with a slicer and printer that can switch between them. Keep the spool dry and use the manufacturer’s dissolution and disposal instructions.",
    "These materials absorb moisture readily and do not pair well with every build material. Make sure water can reach and flush out any internal supports.",
    ["support", "filament-drying", "wet-filament", "overhang"],
  ),
];

const definitions = [
  [
    "cad-term",
    "CAD",
    "Computer-aided design. Build dimensions and geometry in CAD, then send an export to a slicer to prepare the print.",
    ["cad", "slicers", "stl-3mf"],
  ],
  [
    "corexy",
    "CoreXY",
    "A motion layout where two coordinated motors move the print head in X and Y. The printer’s particular design determines how the bed moves in Z.",
    ["printer-types", "bambu-lab", "prusa"],
  ],
  [
    "manifold",
    "Manifold mesh",
    "A closed, watertight surface with no gaps, flipped faces or zero-thickness parts, so a slicer can tell inside from outside. Repair or re-export a mesh that isn’t.",
    ["broken-mesh", "stl-3mf", "cad"],
  ],
  [
    "z-hop",
    "Z hop",
    "A brief lift of the nozzle during travel moves so it clears the finished print. It reduces scars on top surfaces and can add a little stringing.",
    ["travel-scars", "retraction", "travel-move"],
  ],
  [
    "parametric-model",
    "Parametric model",
    "A design controlled by dimensions, constraints and feature relationships. Edit a parameter to regenerate geometry that depends on it.",
    ["cad", "tolerance", "cut-prints"],
  ],
  [
    "anisotropy",
    "Anisotropy",
    "A difference in material properties by direction. In a filament print, strength across layer bonds can be lower than strength along continuous extrusion lines.",
    ["layer-separation", "composites"],
  ],
  [
    "bed-mesh",
    "Bed mesh",
    "A map of the build surface height that compensates for small differences across the plate during printing. Many printers measure it with a probe.",
    ["z-offset", "first-layer"],
  ],
  [
    "bowden",
    "Bowden extruder",
    "A filament drive mounted away from the print head, with a tube guiding filament to the hotend. The longer path can affect flexible-filament feeding and retraction.",
    ["extruder", "tpu"],
  ],
  [
    "bridge",
    "Bridge",
    "A line or layer printed across open space with both ends anchored. Short bridges can often print without supports.",
    ["poor-bridging", "overhang"],
  ],
  [
    "brim",
    "Brim",
    "A thin extension of the first layer that touches or nearly touches the part, giving it a wider footprint to hold onto the bed.",
    ["first-layer", "warping", "skirt"],
  ],
  [
    "build-plate",
    "Build plate",
    "The surface on which a print starts. Plate coatings and materials differ in what they grip or release safely.",
    ["first-layer", "petg"],
  ],
  [
    "direct-drive",
    "Direct drive",
    "An extruder mounted close to the hotend, which shortens the constrained path from drive gears to nozzle.",
    ["bowden", "tpu"],
  ],
  [
    "extruder",
    "Extruder",
    "The drive mechanism that pushes and pulls filament through the hotend. The terms extruder and hotend sometimes describe parts of the same assembly.",
    ["hotend", "under-extrusion"],
  ],
  [
    "fff",
    "FFF / FDM",
    "Fused filament fabrication or fused deposition modeling. A nozzle deposits softened filament in layers to form the part. RepRap builders adopted FFF because FDM is a Stratasys trademark.",
    ["hotend", "slicer", "stratasys", "reprap-history"],
  ],
  [
    "flow-ratio",
    "Flow ratio",
    "Also called extrusion multiplier. Scales how much filament the slicer asks the printer to feed for a path. Calibrate it after confirming the hardware is feeding consistently.",
    ["volumetric-flow", "under-extrusion"],
  ],
  [
    "gcode",
    "G-code",
    "The machine instructions produced by a slicer for a filament printer, including motion, extrusion and temperatures. Use instructions generated for the target machine.",
    ["slicer", "fff"],
  ],
  [
    "heat-creep",
    "Heat creep",
    "Heat moves too far up the hotend and softens filament early, which can restrict or stop feeding.",
    ["hotend", "under-extrusion"],
  ],
  [
    "hotend",
    "Hotend",
    "The heated assembly that melts filament and guides it out through a nozzle. A heat break and cooling system help keep the upper path cool.",
    ["extruder", "heat-creep"],
  ],
  [
    "hygroscopic",
    "Hygroscopic",
    "Readily absorbs moisture from the surrounding air. Nylon and soluble supports are particularly sensitive examples.",
    ["filament-drying", "wet-filament", "nylon", "soluble"],
  ],
  [
    "infill",
    "Infill",
    "The internal cellular structure in a filament print. Its pattern and density affect support for top layers, stiffness, material use and time.",
    ["shell-settings", "perimeter", "top-gaps"],
  ],
  [
    "input-shaping",
    "Input shaping",
    "Firmware-controlled changes to commanded motion that reduce vibration at resonant frequencies.",
    ["ringing", "pressure-advance"],
  ],
  [
    "layer-height",
    "Layer height",
    "The vertical thickness of each sliced layer. Smaller layers can make slopes look smoother and usually increase the number of layers.",
    ["print-time", "nozzle-guide", "top-layers", "line-width"],
  ],
  [
    "line-width",
    "Line width",
    "The planned width of an individual extruded road. It usually stays near the nozzle diameter but is set by the profile.",
    ["nozzle-guide", "layer-height", "volumetric-flow"],
  ],
  [
    "overhang",
    "Overhang",
    "A portion of a new layer that extends beyond the one below. Printable limits vary by geometry, material, cooling and layer height.",
    ["bridge", "poor-bridging", "support"],
  ],
  [
    "perimeter",
    "Perimeter / wall",
    "An outer or inner contour printed around a layer. More walls can change strength and stiffness without filling the entire part.",
    ["shell-settings", "infill", "seam"],
  ],
  [
    "pressure-advance",
    "Pressure advance",
    "Firmware compensation for the way extrusion pressure lags when printing speeds change. Also known as linear advance in some firmware.",
    ["flow-ratio", "input-shaping"],
  ],
  [
    "raft",
    "Raft",
    "A disposable foundation printed beneath the part. It raises the model off the build plate and uses extra material.",
    ["brim", "skirt", "first-layer"],
  ],
  [
    "retraction",
    "Retraction",
    "A temporary pullback of filament before some travel moves to reduce oozing. Appropriate settings depend on the filament path and material.",
    ["stringing", "travel-move", "bowden"],
  ],
  [
    "seam",
    "Seam",
    "The visible meeting point where a closed wall starts and ends. The slicer may align seams, hide them in corners or distribute them.",
    ["perimeter", "slicer"],
  ],
  [
    "shore",
    "Shore hardness",
    "A scale for resistance to indentation. Flexible filaments are often rated on Shore A. Compare values on the same scale.",
    ["tpu"],
  ],
  [
    "skirt",
    "Skirt",
    "A separate outline around the part used to prime extrusion or check its initial flow. It does not anchor the part.",
    ["brim", "first-layer"],
  ],
  [
    "slicer",
    "Slicer",
    "Software that converts a 3D model into layers and printer instructions using the selected printer and material profiles.",
    ["gcode", "layer-height", "support"],
  ],
  [
    "stl-3mf",
    "STL and 3MF",
    "STL stores triangle geometry without a standard unit declaration. 3MF carries units and can also store multiple objects or slicer project information.",
    ["slicer", "gcode"],
  ],
  [
    "support",
    "Support",
    "A temporary printed structure beneath otherwise unsupported geometry. Angle, contact size and removal method depend on the printing process and material.",
    ["bridge", "overhang", "soluble"],
  ],
  [
    "tolerance",
    "Tolerance and clearance",
    "Tolerance is allowed dimensional variation. Clearance is the intentional gap between parts that need to fit or move. Print a sample to verify both with your setup.",
    ["elephant-foot", "anisotropy"],
  ],
  [
    "top-layers",
    "Top layers",
    "Solid layers that close the upper skin over infill. Overall thickness depends on both layer height and the number of solid layers.",
    ["shell-settings", "top-gaps", "infill"],
  ],
  [
    "travel-move",
    "Travel move",
    "A repositioning movement with no intended extrusion. Oozing during travel can leave stringing.",
    ["stringing", "retraction"],
  ],
  [
    "volumetric-flow",
    "Volumetric flow",
    "The volume extruded per second, measured in mm³/s. Higher speed, wider lines and thicker layers all demand more flow from the hotend.",
    ["print-time", "under-extrusion", "flow-ratio"],
  ],
  [
    "z-offset",
    "Z offset",
    "A calibration adjustment that affects the distance between the nozzle and the build plate at the first layer. Its sign and workflow depend on the printer.",
    ["bed-mesh", "first-layer", "elephant-foot"],
  ],
];

export const terms = definitions
  .map(([id, title, summary, related]) => ({ id, title, summary, related, section: "Glossary", ...termStudies[id] }))
  .sort((a, b) => a.title.localeCompare(b.title, "en"));

export const guides = [
  guide(
    "first-print",
    "From model to first print",
    "A repeatable workflow for a new printer, nozzle or spool.",
    [
      [
        "Match the hardware",
        "Choose the exact printer, nozzle, build surface and material profiles. For a downloaded project, check its embedded settings before slicing. Use the machine’s startup and first-layer calibration procedures.",
      ],
      [
        "Review before starting",
        "Check the size and units, bed contact, unsupported areas, layer direction, thin walls and changes of filament in the layer preview. Slice for the target printer. A model file can be reused across printers, but ready-to-run G-code is machine-specific.",
      ],
      [
        "Watch the first layer",
        "Look for continuous, slightly flattened lines that stay attached. Stop and correct a dragging nozzle or loose material before it is buried under more layers.",
      ],
      [
        "Test small",
        "For a difficult part, cut out a representative corner, joint or bridge and test it first. Record the filament and profile, and change one variable at a time.",
      ],
    ],
    ["slicers", "layer-height", "filament-drying", "cut-prints", "first-layer", "gcode"],
    [["Prusa · First layer issues", prusa("first-layer-issues_1804")]],
  ),
  ...studyGuides,
  guide(
    "cut-prints",
    "Cut models into printable parts",
    "Split oversized parts, reduce supports, hide joins and improve layer direction.",
    [
      [
        "Choose a cut that helps the print",
        "Use the slicer’s Cut tool for a simple plane. Cut at an existing edge, along a color change or across a thick, low-stress area. Keep both sides as separate objects if you need to orient and print them independently.",
      ],
      [
        "Use CAD for engineered joints",
        "For keyed joins, mating fasteners, screw bosses or a split with several planes, edit the original CAD model. A removable dowel can register a seam. For a permanently loaded join, design appropriate fasteners or other mechanical support.",
      ],
      [
        "Allow for fit",
        "Print a small sample of the pin and socket in the same orientation, material and profile. Adjust clearance before committing to the full print. A zero-clearance design often binds, especially near an oversized first layer.",
      ],
      [
        "Preview each piece",
        "Lay a useful cut face flat or choose a different orientation to protect a show surface. Check that connector holes still appear in the layer preview. Confirm that each piece, its brim and any supports fit the usable area, and dry-fit the test pieces before assembly.",
      ],
      [
        "Split existing shells when appropriate",
        "Split to Objects separates disconnected shells already in a file. Use Cut to create a new boundary through a single connected solid. A single multicolor assembly may need to stay aligned rather than be spread across the bed.",
      ],
    ],
    ["tolerance", "orientation", "cad", "slicers", "elephant-foot"],
    [
      ["PrusaSlicer · Cut tool", prusa("cut-tool_1779")],
      ["Prusa · Modeling for printing", prusa("modeling-with-3d-printing-in-mind_164135")],
    ],
  ),
  guide(
    "slicers",
    "Choose and use a slicer",
    "Set up profiles, then inspect supports, speeds and toolpaths layer by layer.",
    [
      [
        "Start with machine support",
        "PrusaSlicer pairs with Original Prusa profiles. Bambu Studio handles Bambu profiles and device integration. OrcaSlicer has a broad set of printer profiles and calibration tools. UltiMaker Cura is useful for UltiMaker and many other supported printers. Check the specific model, firmware and device features you need.",
      ],
      [
        "Know your three profiles",
        "The printer profile describes machine and nozzle limits. The filament profile controls material temperatures, cooling and flow limits. The process profile sets layer height, walls, infill, supports and other part-specific choices.",
      ],
      [
        "Read the preview",
        "Scroll layer by layer and switch to line type, speed or flow views if available. Check whether narrow features vanished, where bridging begins, how supports contact the part, and whether first-layer contact is continuous.",
      ],
      [
        "Keep geometry and jobs separate",
        "Save a project file to preserve layout and settings. Keep editable geometry in CAD. Regenerate G-code when switching machines, nozzles or material profiles.",
      ],
    ],
    ["slicer", "first-print", "cad", "gcode", "stl-3mf"],
    [
      ["PrusaSlicer", "https://github.com/prusa3d/PrusaSlicer"],
      ["Bambu Studio", "https://github.com/bambulab/BambuStudio"],
      ["OrcaSlicer", "https://github.com/OrcaSlicer/OrcaSlicer"],
      ["UltiMaker Cura", "https://ultimaker.com/software/ultimaker-cura/"],
    ],
  ),
  guide(
    "cad",
    "Choose a CAD or modeling tool",
    "Pick the workflow that fits your part, from measured brackets to organic shapes.",
    [
      [
        "Dimensioned mechanical parts",
        "Use a parametric solid modeler such as FreeCAD, Autodesk Fusion or Onshape when clearances, hole patterns and repeatable dimensions matter. Keep the original project so you can change the sketch or a parameter later.",
      ],
      [
        "Simple shapes and variations",
        "Tinkercad is approachable for assembling basic shapes and cutouts. OpenSCAD is a good fit for scripted, dimension-driven shapes such as trays, adapters or repeated patterns.",
      ],
      [
        "Organic forms and mesh edits",
        "Use a mesh tool such as Blender for sculpting figurines or editing scanned geometry. Check that the result is closed and has enough wall thickness before exporting.",
      ],
      [
        "Hand off to the slicer",
        "Export 3MF or STL for slicing and verify scale in the preview. Keep STEP or the native file when you need editable solid geometry. If an STL looks faceted around holes, increase the source mesh resolution and re-export.",
      ],
    ],
    ["cut-prints", "stl-3mf", "slicers", "tolerance"],
    [
      ["FreeCAD", "https://www.freecad.org/"],
      ["Autodesk Fusion", "https://www.autodesk.com/products/fusion-360/overview"],
      ["Onshape", "https://www.onshape.com/"],
      ["Tinkercad", "https://www.tinkercad.com/3d-design"],
      ["OpenSCAD", "https://openscad.org/"],
      ["Blender", "https://www.blender.org/"],
    ],
  ),
  guide(
    "orientation",
    "Orient parts and place supports",
    "Balance surface quality, load direction, bed contact and support removal.",
    [
      [
        "Choose the most important surface",
        "Put a surface on the plate if a flat plate finish suits it. Try a different face when the bed texture, visible seam or support marks would be undesirable.",
      ],
      [
        "Plan for loads",
        "Use continuous roads and walls in the direction of the main load where practical. If a feature would get pulled apart across layer bonds, change the orientation or cut the part to print that feature separately.",
      ],
      [
        "Check removal access",
        "Check paint-on or localized supports where available. Avoid trapping supports in closed spaces. Print a small sample to set enough support gap for removal without leaving unacceptable droop.",
      ],
      [
        "Compare two orientations",
        "Slice the alternatives and compare unsupported spans, base area, time, mass and support contact points. A tall narrow part may benefit from a brim or a flatter orientation.",
      ],
    ],
    ["cut-prints", "bridge", "support", "anisotropy", "brim"],
    [["Prusa · Modeling for printing", prusa("modeling-with-3d-printing-in-mind_164135")]],
  ),
  guide(
    "bridging-guide",
    "Design and tune bridges",
    "Make short unsupported spans work and handle larger overhangs.",
    [
      [
        "Determine what the printer has to span",
        "A bridge has an anchor at each end. A projecting edge is an overhang. Check the sliced line type and direction so the toolpath actually runs between supports.",
      ],
      [
        "Use a test with the same filament",
        "Try several spans at the same layer height and profile. Change bridge flow, speed or cooling one at a time. Fan increases that help one filament may weaken layer bonding or increase shrinkage in another.",
      ],
      [
        "Make the shape easier to print",
        "Shorten the free span, add a removable intermediate support, rotate the part or split it. On a projecting ledge, a chamfer or smaller layer height can improve overlap. A teardrop or chamfered roof on a horizontal hole can replace a wide flat bridge.",
      ],
    ],
    ["bridge", "overhang", "poor-bridging", "cut-prints"],
    [["Prusa · Poor bridging", prusa("poor-bridging_1802")]],
  ),
  guide(
    "tuning",
    "Tune with small test prints",
    "Isolate problems with a baseline profile and targeted test pieces.",
    [
      [
        "Fix the baseline first",
        "Confirm that filament feeds freely and the profile matches the machine and nozzle. Check a first-layer patch before tuning further.",
      ],
      [
        "Match the test to the symptom",
        "Use a two-post sample for stringing, short spans for bridging, a stepped flow test for high-speed extrusion, or a pin and socket for fit. Stop the test when an obvious failure makes the result unusable.",
      ],
      [
        "Record what changes",
        "Keep the material and orientation constant. Change one setting at a time and write down the direction and size of the change. Test the successful setting on a small section of the real part.",
      ],
      [
        "Watch speed and flow together",
        "A wider or taller line needs more polymer per millimeter. If gaps begin only at higher speeds or with larger lines, check the volumetric flow limit before increasing extrusion multiplier.",
      ],
    ],
    ["first-print", "temperature-cooling", "stringing", "bridging-guide", "volumetric-flow", "flow-ratio"],
    [["OrcaSlicer · Calibration", "https://github.com/OrcaSlicer/OrcaSlicer/wiki/calibration_guide"]],
  ),
];

export const articles = [...materials, ...issues, ...guides, ...printers, ...history, ...terms];
export const byId = new Map(articles.map((article) => [article.id, article]));

const searchAliases = {
  "first-layer": "bed adhesion poor adhesion peeling failure",
  "under-extrusion": "underextrusion incomplete extrusion clogged nozzle",
  "layer-separation": "delamination splitting cracking",
  "elephant-foot": "elephant foot bulging base",
  "top-gaps": "pillowing top layer holes",
  "wet-filament": "damp moisture bubbles",
  "filament-drying": "dry box drybox dehydrator dry filament drying time humidity temperatures",
  "layer-height": "layer thickness quality settings stair stepping draft print time",
  "print-time": "print speed time estimate print faster acceleration maximum flow",
  "cut-prints": "part splitting joinery cut prints cutting models oversized",
  "printer-types": "popular printers bed slinger enclosed printer",
  "key-settings":
    "important settings best settings slicer settings explained perimeters wall count infill percentage cura prusaslicer orcaslicer bambu studio names",
};

const normalize = (value) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const searchIndex = articles.map((article) => ({
  article,
  title: normalize(article.title),
  summary: normalize(article.summary),
  text: normalize(
    [
      article.title,
      article.summary,
      article.section,
      article.id,
      searchAliases[article.id],
      article.uses,
      article.setup,
      article.limits,
      article.causes,
      article.category,
      article.check,
      article.verify,
      article.keywords,
      ...(article.fixes ?? []),
      ...(article.blocks ?? []).flatMap(([title, block]) =>
        typeof block === "string"
          ? [title, block]
          : [title, block.text, ...block.columns, ...block.rows.flat(), block.note],
      ),
    ]
      .filter(Boolean)
      .join(" "),
  ),
}));

export function searchWiki(query) {
  const phrase = normalize(query);
  if (!phrase) return [];
  const tokens = phrase.split(" ");
  return searchIndex
    .filter(({ text }) => tokens.every((word) => text.includes(word)))
    .map(({ article, title, summary }) => ({
      article,
      score:
        (title === phrase ? 20 : 0) +
        (title.includes(phrase) ? 8 : 0) +
        tokens.filter((word) => title.includes(word)).length * 3 +
        (summary.includes(phrase) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ article }) => article);
}
