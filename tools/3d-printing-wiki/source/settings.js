import { guide, prusa } from "./references.js";

const layers = ["Prusa · Layers and perimeters", prusa("layers-and-perimeters_1748")];
const slicing = [
  "Bambu Studio · Official slicing CLI",
  "https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage",
];
const flow = ["Prusa · Maximum volumetric speed", prusa("max-volumetric-speed_127176")];
const drying = ["Prusa · Drying schedules and spool generations", prusa("drying-filament_332086")];

const layerStudy = {
  text: "A 40 × 30 × 24 mm PLA block, sliced on a Bambu Lab A1 with a 0.4 mm nozzle in Bambu Studio 02.09.01.70. Two walls, 15% grid infill, 0.80 mm minimum top and bottom thickness, and a 0.20 mm first layer stayed fixed.",
  columns: ["Layer height", "Layers", "Estimated model time", "When to try it"],
  rows: [
    ["0.12 mm", "199", "27m 56s", "Small relief and curved display surfaces"],
    ["0.16 mm", "150", "21m 29s", "A smoother finish with a shorter wait"],
    ["0.20 mm", "120", "17m 25s", "Everyday parts and fit checks"],
    ["0.28 mm", "86", "13m 27s", "Drafts, simple bins and quick prototypes"],
  ],
  note: "These are slicer estimates for the model. Smoothness depends on the shape. For this block, 0.12 mm used 66% more layers and took about 60% longer than 0.20 mm.",
};

const shellStudy = {
  text: "The same A1 and PLA block at 0.20 mm. Baseline is two walls and 15% grid infill. Each other row changes a single setting.",
  columns: ["Walls", "Infill", "Estimated model time", "Estimated filament"],
  rows: [
    ["2", "15%", "17m 25s", "10.31 g"],
    ["3", "15%", "17m 55s", "11.72 g"],
    ["2", "30%", "19m 22s", "14.78 g"],
  ],
  note: "The extra wall added 30 seconds and 1.41 g. Doubling infill added 1m 57s and 4.47 g on this part. To compare strength, test the real shape under its intended load.",
};

const dryingSchedules = {
  text: "These are examples from the named products’ documentation. For your spool, cross-check the exact filament instructions, the spool’s temperature limit and your dryer’s operating range.",
  columns: ["Named filament", "Temperature", "Duration"],
  rows: [
    ["Prusament PLA / rPLA", "45°C", "6 h"],
    ["Prusament PETG", "55°C", "6 h"],
    ["Prusament TPU", "60°C", "4–6 h"],
    ["Polymaker PolyLite ASA", "70°C", "7 h"],
    ["Prusament ASA", "80°C", "4 h"],
    ["Polymaker PolyDissolve S1 (PVA)", "80°C", "12 h"],
    ["Prusament PC Blend", "85°C", "5 h"],
    ["Prusament PA11 Carbon Fiber", "90°C", "6 h"],
  ],
  note: "The two ASA examples use cycles 10°C and three hours apart. Prusa also distinguishes spool generations. Check the reel as well as the filament, especially with old, refillable or cardboard-core spools.",
};

const keySettings = {
  text: "Most of these are process settings: they belong to the part, not the printer. Change them before the rest.",
  columns: ["Setting", "What it changes", "Change it when", "Starting point · 0.4 mm nozzle"],
  rows: [
    [
      "Layer height",
      "Vertical detail and print time",
      "Curves and slopes look stepped, or you need a quick draft",
      "0.20 mm; 0.12–0.16 mm for detail, 0.24–0.28 mm for drafts",
    ],
    [
      "Walls",
      "Strength at edges, holes and screws, and whether a part holds water",
      "The part carries load, takes screws or must seal",
      "2–3; 4 or more for loaded or watertight parts",
    ],
    [
      "Top and bottom shells",
      "Whether flat roofs close and floors seal",
      "A roof shows gaps or bumps, or you switch to fine layers",
      "About 0.8–1.0 mm of roof and 0.6 mm of floor, as a thickness where the slicer allows it",
    ],
    [
      "Infill density",
      "Mass, time and support under the roof",
      "The part is loaded, or a display piece could be lighter",
      "10–15% for display parts, 20–40% for functional ones",
    ],
    [
      "Infill pattern",
      "Stiffness by direction, time and nozzle strikes",
      "The nozzle catches the infill, or the load comes from several directions",
      "Grid or gyroid for general parts; lightning only for display parts",
    ],
    [
      "Supports",
      "Where supports appear and how steep an overhang may print without them",
      "Overhangs droop, or supports appear where they aren’t needed",
      "Tree or organic for figures, normal for flat ledges; paint or block them locally",
    ],
    [
      "Support top distance",
      "How easily supports come off and how rough the face above them is",
      "Supports fuse to the part, or the face above them sags",
      "Keep the profile’s value, often about one layer height",
    ],
    [
      "Brim, skirt or raft",
      "First-layer grip",
      "Corners lift, or a tall part stands on a small footprint",
      "A 3–5 mm brim for small footprints and shrink-prone materials",
    ],
    [
      "Seam position",
      "Where each wall loop starts and ends",
      "A zipper line runs down a show face",
      "Aligned or rear to hide it on a corner or the back; random spreads it",
    ],
    [
      "Nozzle temperature",
      "Layer bonding, stringing and gloss",
      "Layers split, or strings appear",
      "The filament maker’s range; test in 5°C steps",
    ],
    [
      "Part cooling fan",
      "Overhangs and bridges against layer bonding",
      "Overhangs curl, or ABS and ASA layers crack",
      "The filament profile’s values; less for ABS, ASA and PC",
    ],
    [
      "Max volumetric speed",
      "How much plastic the hotend can melt per second, which caps every speed",
      "Walls show gaps only at speed, or a high-flow hotend is fitted",
      "The filament profile’s value; raise it only after a flow test",
    ],
    [
      "Ironing",
      "Smoothness of flat top faces",
      "A flat top must look polished, such as a sign or a lid",
      "Topmost surface only; it adds time",
    ],
  ],
  note: "These starting points suit common PLA and PETG profiles. The printer and filament maker’s presets come first.",
};

const settingNames = {
  text: "Each slicer family names the same setting its own way. Use this table to follow a guide written for another slicer.",
  columns: ["Setting", "Bambu Studio and OrcaSlicer", "PrusaSlicer", "UltiMaker Cura"],
  rows: [
    ["Number of walls", "Wall loops", "Perimeters", "Wall Line Count"],
    ["Top solid layers", "Top shell layers", "Solid layers · Top", "Top Layers"],
    ["Minimum roof thickness", "Top shell thickness", "Minimum shell thickness · Top", "Top Thickness"],
    ["Infill amount", "Sparse infill density", "Fill density", "Infill Density"],
    ["Infill shape", "Sparse infill pattern", "Fill pattern", "Infill Pattern"],
    ["Supports on", "Enable support", "Generate support material", "Generate Support"],
    ["When to support", "Threshold angle", "Overhang threshold", "Support Overhang Angle"],
    [
      "Supports from the plate only",
      "On build plate only",
      "Support on build plate only",
      "Support Placement · Touching Buildplate",
    ],
    ["Gap above supports", "Top Z distance", "Top contact Z distance", "Support Top Distance"],
    ["First-layer grip", "Brim type, Brim width", "Brim type, Brim width", "Build Plate Adhesion Type, Brim Width"],
    ["Where loops start", "Seam position", "Seam position", "Z Seam Alignment"],
    ["Flow correction", "Flow ratio", "Extrusion multiplier", "Flow"],
    [
      "Shrink the first layer",
      "Elephant foot compensation",
      "Elephant foot compensation",
      "Initial Layer Horizontal Expansion",
    ],
    ["Variable-width walls", "Wall generator · Arachne", "Perimeter generator · Arachne", "Built in since Cura 5.0"],
    ["One continuous wall", "Spiral vase", "Spiral vase", "Spiralize Outer Contour"],
    ["Polish flat tops", "Ironing type", "Enable ironing", "Enable Ironing"],
  ],
  note: "The support angles point in opposite directions. Bambu Studio, OrcaSlicer and PrusaSlicer support overhangs flatter than the threshold, measured from the horizontal, so a higher number adds supports. Cura measures from the vertical: 0° supports every overhang and a higher number adds fewer. A 30° threshold in the first group is roughly 60° in Cura.",
};

const goalSettings = {
  text: "Start from the matching preset, then change these first.",
  columns: ["Goal", "Change first", "Material to consider"],
  rows: [
    ["Fine detail", "0.12 mm layers, a slower outer wall, tree supports; a 0.2–0.25 mm nozzle for tiny parts", "PLA"],
    ["Quick draft or fit check", "0.28 mm layers, 2 walls, 10% infill, no ironing", "PLA"],
    [
      "Strong functional part",
      "4–6 walls, 25–40% gyroid or cubic infill, layers running along the load",
      "PETG, ABS, ASA or PA",
    ],
    ["Outdoor part", "4 walls, 20% or more infill, a seam on a hidden face", "ASA for sun, PETG for shade"],
    [
      "Container that holds water",
      "4 walls or spiral vase, 5 or more bottom layers, a little more flow or temperature within the range",
      "PETG or PP",
    ],
    ["Flexible part", "3 or more walls, low speed, the preset’s retraction, low infill for squish", "TPU"],
    ["Smooth flat top", "Ironing on the topmost surface, a monotonic top pattern, more top layers", "PLA or PETG"],
    ["Toy", "Rounded edges in the design, 3–4 walls, 15–20% infill, no small loose pieces", "PLA or PETG"],
  ],
  note: "A print profile can’t make a part food-safe or child-safe on its own. Material grade, printer parts, surface texture and cleaning all matter, as does the age group for small pieces.",
};

export const studyGuides = [
  guide(
    "key-settings",
    "The slicer settings that matter most",
    "What to change first, what each setting is called in Bambu Studio, OrcaSlicer, PrusaSlicer and Cura, and what to leave to the profile.",
    [
      [
        "Start with the right three profiles",
        "Most print quality comes from picking the printer, nozzle and filament profiles that match the hardware. The printer profile holds the machine’s limits, retraction and start code. The filament profile holds temperatures, cooling, flow ratio and the maximum volumetric speed. The process profile holds the part’s choices: layer height, walls, shells, infill, supports and adhesion. Change process settings first, filament settings after a calibration test, and printer settings only when the hardware changed.",
      ],
      ["The settings worth knowing", keySettings],
      ["Same setting, different names", settingNames],
      ["Change these first for a goal", goalSettings],
      [
        "Where each setting lives",
        "Bambu Studio and OrcaSlicer split settings into printer, filament and process presets, and a project can override process settings per object or part. Temperatures, fan speeds, flow ratio and maximum volumetric speed are filament settings there. PrusaSlicer uses Print, Filament and Printer Settings tabs with the same split. Cura combines a material and a quality profile, adds an intent such as Engineering or Visual on supported printers, and keeps your edits as a custom profile.",
      ],
      [
        "Opening a project from another slicer",
        "A 3MF project carries geometry, plates and usually the designer’s process settings. Bambu Studio and the slicers built on it read each other’s projects most completely, though a project tagged by another brand may keep its geometry and drop its settings. PrusaSlicer and Cura take the geometry and only some per-object settings, and opening a file as a project can swap your printer for one made from the file. Check the selected printer, nozzle and filament before slicing, then compare walls, infill and supports with what the designer describes.",
      ],
      [
        "Settings to leave to the profile",
        "Line widths, acceleration, jerk or junction deviation, retraction length, start and end G-code and the bed shape belong to the printer and nozzle. Change them to match changed hardware or after a test shows what’s wrong. When a print looks wrong, check the filament’s dryness and the first layer before editing any of these.",
      ],
      [
        "Example · A wall-mounted hook",
        "Print the hook on its side, so the layers run along the arm instead of across it. Use four walls and 25–30% gyroid infill and keep 0.20 mm layers. Compare the estimate with two walls: on a small part the extra walls usually cost little time and add strength where the load is.",
      ],
    ],
    [
      "layer-height",
      "shell-settings",
      "temperature-cooling",
      "print-time",
      "nozzle-guide",
      "orientation",
      "slicers",
      "seam",
      "support",
      "brim",
      "volumetric-flow",
      "flow-ratio",
    ],
    [
      [
        "OrcaSlicer · Setting definitions",
        "https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/libslic3r/PrintConfig.cpp",
      ],
      [
        "PrusaSlicer 2.9.2 · Setting definitions",
        "https://github.com/prusa3d/PrusaSlicer/blob/version_2.9.2/src/libslic3r/PrintConfig.cpp",
      ],
      [
        "UltiMaker Cura · Setting definitions",
        "https://github.com/Ultimaker/Cura/blob/main/resources/definitions/fdmprinter.def.json",
      ],
      layers,
      ["Prusa · Seam position", prusa("seam-position_151069")],
      ["Prusa · Support material", prusa("support-material_1698")],
      ["Prusa · Ironing", prusa("ironing_177488")],
    ],
  ),
  guide(
    "temperature-cooling",
    "Tune nozzle temperature, bed and cooling",
    "Start from a compatible material preset, then use small tests to tune layer bonds, overhangs and first-layer grip.",
    [
      [
        "How much presets can differ",
        {
          text: "These are published Prusament examples. Start with the matching preset for the exact spool, surface and printer. Cooling percentages describe the maker’s examples and depend on the printer’s airflow.",
          columns: ["Filament", "Nozzle", "Bed", "Part fan example"],
          rows: [
            ["Prusament PLA", "200–220°C", "40–60°C", "100%"],
            ["Prusament PETG", "240–260°C", "70–90°C", "50%"],
            ["Prusament PETG V0", "220–240°C", "70–90°C", "50%"],
            ["Prusament ASA", "255–265°C", "105–115°C", "30%"],
          ],
          note: "The regular PETG and PETG V0 examples have the same bed range but different nozzle targets. The first few layers and bridges can use separate fan settings.",
        },
      ],
      [
        "Example · PETG with hairy travel moves",
        "Dry a suspect spool first. Compare a small two-post test at your preset and 5°C cooler, both within the spool’s specified range. Keep retraction and speed fixed and check that the cooler sample still has sound walls and bridges. If it strings less but bonds poorly, keep the warmer temperature and test retraction or travel routing separately.",
      ],
      [
        "Example · Good sides, melted tip",
        "A tiny layer may finish before its plastic has set. Use the speed and layer time preview to check where the layers become short. Try the preset’s minimum-layer-time controls or print two spaced copies together by layer. For an ASA plate that curls at the corners, a stable chamber and the correct build surface are better first checks than more cooling.",
      ],
      [
        "Separate the three temperatures",
        "The hotend controls how the filament flows. The bed and the first-layer profile help the print attach. The chamber affects how evenly the whole part cools. Use approved settings for each and re-run a first-layer patch when changing the surface or material.",
      ],
    ],
    ["pla", "petg", "asa", "small-layer-overheating", "stringing", "first-layer", "filament-drying"],
    [
      ["Prusament · PLA", "https://prusament.com/materials/pla/"],
      ["Prusament · PETG", "https://prusament.com/materials/prusament-petg/"],
      ["Prusament · PETG V0", "https://prusament.com/materials/prusament-petg-v0/"],
      ["Prusament · ASA", "https://prusament.com/materials/prusament-asa/"],
      ["OrcaSlicer · Cooling and layer time", "https://github.com/OrcaSlicer/OrcaSlicer/wiki/material_cooling"],
    ],
  ),
  guide(
    "filament-drying",
    "Filament drying and storage",
    "Recognize a damp spool, choose a drying cycle, and keep sensitive materials dry while printing.",
    [
      [
        "When to dry a spool",
        "A previously reliable spool starts popping during extrusion, making pinholes, or turning a clean two-post test into a web. Try the same model with a known-dry spool of the same grade, or compare the suspect spool before and after a proper drying cycle. Dry nylon and water-soluble support filament as their makers specify, especially for long jobs. PETG and TPU can also change noticeably after humid storage.",
      ],
      ["Drying settings by product", dryingSchedules],
      [
        "Use controlled heat and airflow",
        "Use a filament dryer that can maintain the temperature the manufacturer specifies. Follow the dryer maker’s ventilation and loading instructions so moisture can leave the chamber. A dryer that tops out at 70°C cannot run a specified 90°C cycle. For low-temperature spools such as PLA, a kitchen oven can overshoot enough to soften the filament or reel. A purpose-built, regulated dryer is easier to control.",
      ],
      [
        "Store it dry after the cycle",
        "Let the spool cool as the dryer manual directs, then store it in a sealed bag or box with fresh or regenerated desiccant. Use a dry box with a feed-through on long nylon or PVA jobs. Desiccant helps maintain dry air. A hygrometer reads the air in the box, so use a test print to judge whether the filament itself has recovered.",
      ],
      [
        "Example · PETG starts stringing after a humid week",
        "Dry the exact grade to the supplier’s schedule. Repeat the same two-post print at the same nozzle temperature and retraction. If popping and pitting improve, keep the spool sealed between jobs. If the test still shows threads only across travel moves, check nozzle temperature and retraction next. A faint vertical line down the posts is likely a seam.",
      ],
    ],
    ["wet-filament", "hygroscopic", "petg", "nylon", "tpu", "soluble", "seam-blobs"],
    [
      drying,
      [
        "Polymaker · Wet filament and storage",
        "https://wiki.polymaker.com/printing-tips/common-printing-issues/wet-filament",
      ],
      [
        "Polymaker · PolyLite ASA technical data",
        "https://polymaker.com/wp-content/uploads/lana-downloads/PolyLite_ASA_TDS_EN_V5.4.pdf",
      ],
      [
        "Polymaker · PolyDissolve S1 technical data",
        "https://polymaker.com/wp-content/tech-docs/PolyDissolve_S1_PIS_EN_V1.1.pdf",
      ],
      ["r/3DPrinting · Community filament-drying notes", "https://www.reddit.com/r/3Dprinting/wiki/filament_drying/"],
    ],
  ),
  guide(
    "print-time",
    "Make prints faster without guessing",
    "Use the slicer preview to separate motion limits, hotend flow, cooling and support time.",
    [
      [
        "Start with the preview",
        "Slice two copies of the same model with the same orientation, material and printer. Change one setting and compare the estimated model time, filament mass and toolpath. Check the speed or flow view where time is being spent. A display figure in mm/s describes commanded motion; acceleration and short segments often keep the print below it.",
      ],
      ["Work an example with layer height", layerStudy],
      [
        "When thicker layers hit the hotend limit",
        "As a quick rectangular approximation, multiply line width × layer height × print speed. A 0.45 mm line at 100 mm/s needs roughly 9 mm³/s at 0.20 mm or 12.6 mm³/s at 0.28 mm. With a 10 mm³/s cap, the 0.28 mm layer would be limited to roughly 79 mm/s in that simplified model. Slicers can model a rounded cross-section and calculate a different cap. Keep the actual tested limit for your nozzle and filament.",
      ],
      [
        "Look for a different bottleneck",
        "Compare the areas colored by speed, volumetric flow and feature type. Thin spires may already be slowing for cooling. A bracket with long supports can gain more from reorientation or a split. If walls are already limited by flow, reducing a speed number may leave the estimate unchanged. Re-slice and compare before committing the job.",
      ],
      [
        "Compare the cost you actually pay",
        "If material costs 20 per kilogram, 10 g costs 0.20 in the same currency. Use the slicer’s total mass when comparing options with supports or filament changes, then consider machine time and cleanup separately. A quicker draft is useful when it answers the fit question and avoids repeating a polished print.",
      ],
    ],
    ["layer-height", "volumetric-flow", "orientation", "cut-prints", "shell-settings", "small-layer-overheating"],
    [
      flow,
      slicing,
      ["OrcaSlicer · Cooling and minimum layer time", "https://github.com/OrcaSlicer/OrcaSlicer/wiki/material_cooling"],
    ],
  ),
  guide(
    "shell-settings",
    "Choose walls, infill and roof thickness",
    "Compare where extra filament goes and why a flat roof behaves differently from a loaded wall.",
    [
      [
        "A practical first slice",
        "On a 0.4 mm nozzle, try the preset with two or three wall loops and around 10–15% sparse infill for a typical noncritical model. A broad flat roof, a fastener pocket or a bracket with bending loads may need different choices. Preview real wall thickness and roof layers before printing.",
      ],
      ["Compare an extra wall with more infill", shellStudy],
      [
        "Think in millimeters for the roof",
        "Four solid layers at 0.20 mm make a nominal 0.80 mm roof. At 0.12 mm, four layers give 0.48 mm. Seven give 0.84 mm. Set a minimum solid thickness when the slicer supports it, then confirm the layer count in preview. A broad roof can also benefit from denser support immediately beneath it.",
      ],
      [
        "Use the pattern to solve the right problem",
        "A sparse pattern supports the roof and can change stiffness and mass. At the same percentage, patterns vary in roof span, time and crossings. Try a pattern without same-layer crossings if grid intersections are causing nozzle strikes. For a loaded bracket, inspect load direction, strengthen the wall or corner where it matters, and test a part before relying on it.",
      ],
    ],
    ["perimeter", "infill", "top-layers", "top-gaps", "infill-collision", "orientation"],
    [
      layers,
      slicing,
      ["Prusa · Infill density", prusa("infill_42")],
      ["Prusa · Infill patterns", prusa("infill-patterns_177130")],
    ],
  ),
  guide(
    "nozzle-guide",
    "Choose a nozzle and line width",
    "Use 0.4 mm for everyday work, then choose smaller for fine features or wider for larger parts when the profile supports it.",
    [
      [
        "Pick the feature you want to improve",
        {
          text: "The nozzle and line width shape detail across the bed. Layer height shapes detail vertically. Start with a stock profile for the nozzle you physically installed.",
          columns: ["Typical nozzle", "Try it for", "Trade-off"],
          rows: [
            [
              "0.2–0.25 mm",
              "Miniatures, narrow raised text, thin walls",
              "More paths and greater sensitivity to dust and filler",
            ],
            ["0.4 mm", "General parts, prototypes, brackets", "Versatile stock profiles and common spares"],
            [
              "0.6 mm",
              "Large bins, thick walls, supported particle-filled filaments",
              "Wider roads can replace several loops, but need more flow",
            ],
            [
              "0.8 mm",
              "Large forms with little fine detail",
              "Check hotend throughput, supported layer heights and corners",
            ],
          ],
        },
      ],
      [
        "Example · A label still looks muddy at 0.12 mm",
        "Compare the text in the slicer preview. A 0.4 mm nozzle may omit narrow horizontal strokes even at a fine layer height. Try taller text for shallow relief, wider lettering, or a smaller nozzle with its own preset depending on which feature is missing.",
      ],
      [
        "Example · Make a large tray in fewer passes",
        "A compatible 0.6 mm profile may achieve the same wall thickness with fewer, wider roads. Check that the tray still has the intended wall thickness and inspect the new speed and flow preview. A hotend operating at its flow cap can eat up the expected time saving.",
      ],
    ],
    ["layer-height", "line-width", "missing-thin-walls", "print-time", "composites"],
    [
      ["Prusa · Nozzle types and diameters", prusa("prusa-nozzle-types-for-nextruder-printers_928993")],
      ["Prusa · Creating nozzle profiles", prusa("creating-profiles-for-different-nozzles_127540")],
      flow,
    ],
  ),
];

export const termStudies = {
  "layer-height": {
    blocks: [
      [
        "A useful starting range for 0.4 mm nozzles",
        "A fine 0.10–0.12 mm profile makes shallow curves and slopes look less stepped. Try around 0.15–0.16 mm when finish matters, 0.20 mm for a first general-purpose slice, and a supported 0.24–0.28 mm draft profile for prototypes and simple shapes. Some setups use special very fine heights or a larger nozzle for 0.40 mm layers. As a rule of thumb, many profiles keep the height below about 80% of nozzle diameter, or about 0.32 mm for a 0.4 mm nozzle. Use the preset’s narrower limits when applicable.",
      ],
      ["Compare the same part at four heights", layerStudy],
      [
        "Example · Keep detail only where you can see it",
        "On a box with a rounded lid, fine layers improve the lid’s shoulder more than the box’s vertical sides. Use adaptive or variable layer height in a supported slicer to refine the curve and leave thicker layers where the profile permits. A smaller nozzle or wider text helps when flat lettering disappears in X/Y. The first layer has its own setting and may stay at 0.20 mm even on a fine preset.",
      ],
    ],
    sources: [
      layers,
      ["Prusa · Variable layer height", prusa("variable-layer-height-function_1750")],
      ["Prusa · First print and profile choice", prusa("first-print-with-prusaslicer-3-0-0_1079761")],
      slicing,
      [
        "Top 3D Shop · FDM parameter overview",
        "https://top3dshop.com/blog/fused-deposition-modeling-all-you-need-to-know-about-fdm-3d-printing-technology#anchor23",
      ],
    ],
  },
  "line-width": {
    blocks: [
      [
        "Start from the nozzle profile",
        "A 0.4 mm nozzle commonly lays roads around 0.4–0.45 mm wide. Wall, first-layer and infill widths can differ. A variable-width wall generator can squeeze or widen some roads to fill gaps. Look at actual toolpaths if a wall is missing or a part has a narrow channel.",
      ],
      [
        "Example · A 0.9 mm wall",
        "Two roads close to 0.45 mm each can cover roughly 0.9 mm before allowance for overlap. A slicer may adjust the actual widths to fit. For a tighter dimensional target, measure a test printed with the intended wall generator and nozzle.",
      ],
    ],
    sources: [layers, ["Prusa · Arachne wall generation", prusa("arachne-perimeter-generator_352769")]],
  },
  infill: {
    blocks: [
      [
        "Start with the roof and the load",
        "For a small ornament, 10–15% is a useful starting point for supporting the upper skin. A wide flat roof may need closer backing or thicker top layers. If the part bends at a screw hole, compare a thicker wall or local reinforcement before filling the entire model.",
      ],
      [
        "Read the trade-off",
        "In the A1 block example, going from 15% to 30% infill with two walls added nearly two minutes and about 4.5 g. The time and mass effect depends on how much of the model is infill. Compare in your slicer and test the actual part.",
      ],
    ],
    sources: [["Prusa · Infill density", prusa("infill_42")], slicing],
  },
  perimeter: {
    blocks: [
      [
        "Try a third wall when the shell matters",
        "Two loops are common for simple shapes. On the A1 example, a third loop cost only 30 seconds at the same infill. Inspect whether a new loop actually fits around the feature. Extra walls often help around screw holes or shafts, where a change in the infill deep inside might have less effect.",
      ],
    ],
    sources: [layers, slicing],
  },
  "top-layers": {
    blocks: [
      [
        "Example · Preserve a 0.80 mm roof",
        "Four solid layers at 0.20 mm give 0.80 mm. With a 0.12 mm profile, keep at least seven for about 0.84 mm. This matters when a fine preset otherwise leaves just a few thin layers to bridge the spaces in sparse infill.",
      ],
    ],
    sources: [layers],
  },
  "volumetric-flow": {
    blocks: [
      [
        "Example · Same motion speed, more plastic",
        "At a 0.45 mm line width and 100 mm/s, increasing layer height from 0.20 to 0.28 mm raises the rough demand from 9 to 12.6 mm³/s. If the test profile limits flow to 10 mm³/s, the thicker road must slow. The slicer uses its own cross-section model to calculate the exact speed.",
      ],
    ],
    sources: [flow],
  },
  hygroscopic: {
    blocks: [
      [
        "What you can actually observe",
        "Water in the filament can turn into vapor in the hotend. Listen for several pops during steady extrusion and check for small pits or rough, bubbly roads. Compare with a correctly dried spool at the same temperatures and speed. Nylon and soluble supports can pick up moisture during long prints, so feed those from a dry box if the maker recommends it.",
      ],
    ],
    sources: [drying],
  },
};
