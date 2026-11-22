import { prusa, printQuality } from "./references.js";

function issue(id, title, summary, causes, fixes, related, source, imageAlt) {
  return { id, title, summary, causes, fixes, related, source, imageAlt, section: "Troubleshooting" };
}

const originalIssues = [
  issue(
    "first-layer",
    "First layer won’t stick",
    "First-layer lines stay round, leave gaps, drag around or lift from the build plate.",
    "Oil on the plate, an incompatible surface, the wrong nozzle-to-bed gap, a bad bed mesh or an overly fast first layer.",
    [
      "Clean and prepare the build plate as its maker specifies, then verify the plate and filament presets.",
      "Run the printer’s first-layer calibration. On an adjustable machine, a nozzle too high leaves separated roads. A nozzle too low leaves ridges, scraping or starved areas.",
      "After checking the gap, try the recommended first-layer speed and temperatures. Use a brim for tiny footprints if needed.",
    ],
    ["z-offset", "bed-mesh", "brim", "spaghetti"],
    prusa("first-layer-issues_1804"),
    "Orange first-layer extrusion lines on a dark build plate with dark gaps between the rounded lines.",
  ),
  issue(
    "stringing",
    "Stringing and oozing",
    "Fine hairs or plastic threads stretch across empty space between features.",
    "Plastic oozes during travel. Check the nozzle temperature, retraction profile, wet filament and deposits on the nozzle.",
    [
      "Compare with a dry spool using its normal profile. Check the nozzle for deposits following the printer manual.",
      "Print a small temperature test within the material’s recommended range. If appropriate, test retraction in small steps from the printer preset.",
      "Review travel routing in the slicer. Change one variable per test so you can identify what helped.",
    ],
    ["petg", "wet-filament", "retraction", "travel-move"],
    prusa("stringing-and-oozing_1805"),
    "Fine orange filament threads span the gap between two printed test posts.",
  ),
  issue(
    "warping",
    "Warping and lifting corners",
    "Corners curl upward and the underside loses contact after the first layer has stuck.",
    "Uneven cooling makes material contract and pull against the plate. Large footprints, drafts and high-shrinkage materials make this more likely.",
    [
      "Check that the first layer is sound and the plate is suitable. Add a brim to increase contact near the corners.",
      "Use the recommended plate temperature and control drafts. Use a compatible enclosure if the material calls for one.",
      "Try rounded corners, a different orientation or smaller sections on parts you can redesign.",
    ],
    ["first-layer", "brim", "asa", "layer-separation"],
    prusa("warping_2011"),
    "A thin flat orange print with the near corner curled up and casting a gap shadow.",
  ),
  issue(
    "layer-shift",
    "Layer shift",
    "Part of the print suddenly steps sideways, with every layer above the step offset.",
    "The motion system may have lost position because of a loose pulley, incorrect belt tension, a blocked axis or a nozzle collision.",
    [
      "Identify the shift direction, stop the print and let the machine cool. Follow its service instructions to inspect the relevant belt, pulley and axis for looseness or obstructions.",
      "Look for evidence that the nozzle hit curled corners, infill or supports. Check the sliced preview and correct the collision’s cause.",
      "Retest with a known-good profile. If your previous settings were unusually aggressive, lower acceleration.",
    ],
    ["spaghetti", "warping", "ringing"],
    prusa("layer-shifting_2020"),
    "An orange tower with its entire upper half displaced sideways at one layer.",
  ),
  issue(
    "under-extrusion",
    "Under-extrusion",
    "Thin, incomplete roads leave gaps or weak bands in walls and infill.",
    "A partial clog, slipping feed gear, spool drag, the wrong nozzle preset or printing beyond the hotend’s flow capacity.",
    [
      "Confirm the correct nozzle, filament and slicer profiles and check that the spool and feed path move freely.",
      "Test slower printing with the manufacturer’s normal temperature. If material is still missing, inspect the feed gears and follow the nozzle service instructions.",
      "Retest with dry filament and investigate hotend cooling if flow fades only after the printer heats up. Tune flow after the feed path is working reliably.",
    ],
    ["volumetric-flow", "extruder", "hotend", "wet-filament"],
    prusa("under-extrusion_2007"),
    "An upright orange wall has multiple rows of narrow holes where extrusion is missing.",
  ),
  issue(
    "spaghetti",
    "Spaghetti failure",
    "A loose nest of filament collects around a toppled or incomplete part.",
    "The part or a support may have let go, or a missing feature in the sliced model caused extrusion into air.",
    [
      "Stop the print as soon as you see the failure. Remove the waste after the moving parts have stopped and according to the printer’s cool-down and cleaning instructions.",
      "Check the first layer, the contact area under tall parts and the stability of supports.",
      "Inspect each affected layer in the slicer preview for floating features. Change orientation or reinforce supports before retrying.",
    ],
    ["first-layer", "support", "warping", "layer-shift"],
    prusa("spaghetti-monster_1999"),
    "A failed orange box is surrounded by a loose tangle of long, looping filament.",
  ),
  issue(
    "ringing",
    "Ringing and ghosting",
    "Regular, fading ripples follow a sharp corner or raised feature.",
    "Rapid changes in motion excite vibration in the frame or moving components. Loose or poorly adjusted hardware can make it worse.",
    [
      "Check the frame and motion components using the manufacturer’s instructions and verify the printer is on a stable surface.",
      "Repeat a short test at lower acceleration. Confirm the ripples are linked to corners, since repeating horizontal bands can have different causes.",
      "If the printer supports it, calibrate input shaping according to the firmware’s procedure.",
    ],
    ["layer-shift", "input-shaping", "pressure-advance"],
    "https://www.klipper3d.org/Resonance_Compensation.html",
    "Vertical ripples appear beside a sharp feature on an orange printed wall.",
  ),
  issue(
    "elephant-foot",
    "Elephant’s foot",
    "The bottom layer or two flare outward, so pieces bind at the base.",
    "An overly tight first layer or too much heat at the base can widen the first layers.",
    [
      "Inspect the first layer and calibrate the nozzle gap before changing compensation.",
      "Check the recommended bed temperature for the spool and surface. Verify that fit problems are limited to the base.",
      "Use a small first-layer compensation in the slicer or a chamfer on the part’s bottom edge if the fit still needs correction.",
    ],
    ["first-layer", "z-offset", "tolerance"],
    prusa("elephant-foot-compensation_114487"),
    "An orange cube has a thin outward flare along its bottom edge.",
  ),
  issue(
    "layer-separation",
    "Layer separation",
    "Layers split along horizontal planes. The print may fracture easily in that direction.",
    "Layer bonds can be weak when the print is too cold, cooling is too aggressive, flow is insufficient or material is damp. Residual stress can then open a crack.",
    [
      "Look for missing extrusion and confirm the material is dry. Compare against a part from the manufacturer’s standard profile.",
      "Within the recommended profile range, test reducing excessive fan cooling, printing more slowly or raising nozzle temperature. Avoid drafts for shrink-prone filaments.",
      "If the part is loaded in use, orient or redesign it so the primary tension does not pull the layers apart.",
    ],
    ["under-extrusion", "anisotropy", "wet-filament", "warping"],
    printQuality,
    "A horizontal crack separates two aligned sections of an orange printed tower.",
  ),
  issue(
    "poor-bridging",
    "Sagging bridges and overhangs",
    "Extruded strands droop beneath a span, or curl at an unsupported edge.",
    "A bridge may be too long, or material may stay hot too long as it crosses the gap. An overhang may lack enough overlap with the preceding layer.",
    [
      "In the slice preview, check whether the line is a bridge supported at both ends or an overhang extending from one side.",
      "For a short bridge, test the bridge speed, flow and cooling settings for your material. For a steep overhang, try lower layer height or an orientation with better overlap.",
      "Add supports, shorten the bridge or reorient the part when the profile cannot print the span cleanly.",
    ],
    ["bridge", "overhang", "support", "layer-height"],
    prusa("poor-bridging_1802"),
    "Orange strands hang down from the underside of a small bridge between two printed legs.",
  ),
  issue(
    "wet-filament",
    "Moisture, popping and pitting",
    "Filament pops while extruding and leaves bubbles, rough spots or irregular strings.",
    "Moisture in the spool is one common cause. The problem is especially common with nylon, TPU and water-soluble support material. Roughness alone has other possible causes.",
    [
      "Compare with a known-dry spool or dry the affected spool to its maker’s temperature and time. Respect the spool’s own heat limit.",
      "Store dried filament in a sealed container with active desiccant. Use a dry box while printing for grades that take up moisture quickly.",
      "If drying makes no difference, investigate feed, temperature and retraction instead of assuming every string is moisture.",
    ],
    ["filament-drying", "hygroscopic", "nylon", "tpu", "stringing"],
    prusa("drying-filament_332086"),
    "The wall of an orange print has scattered small pits and rough spots.",
  ),
  issue(
    "top-gaps",
    "Holes in top surfaces",
    "The closed roof has holes or dips over the infill, sometimes called pillowing.",
    "Top layers lack enough backing or thickness, or the flow or cooling is insufficient for the roof to close cleanly.",
    [
      "Inspect the preview to confirm the roof has solid top layers. Increase overall top thickness when using a fine layer height.",
      "Use a denser or better-supporting infill under broad roofs. Test a smaller sample to check that top lines bridge the spaces.",
      "If gaps also appear on walls or solid sections, investigate under-extrusion before adding top layers.",
    ],
    ["infill", "top-layers", "under-extrusion", "poor-bridging"],
    printQuality,
    "Irregular holes in an orange top skin expose crosshatched infill underneath.",
  ),
];

// Diagnostic checks for the twelve common symptoms. Each one points to an observable difference or a small test.
const diagnosticNotes = {
  "first-layer": [
    "Print a one-layer patch. Round roads with dark gaps point to excessive nozzle height. Ridges between flattened roads point to too much squish. A good center with a poor edge suggests a local plate or mesh problem.",
    "Print the same patch in the problem spot. Look for joined, even roads without scraping or loose strands.",
  ],
  stringing: [
    "True stringing spans open travel moves between features. Compare the threads with the slicer’s travel preview. A row of bumps on one solid wall is more likely a seam.",
    "Compare identical two-post tests. Check that reducing strings caused no gaps where the next perimeter starts.",
  ],
  warping: [
    "Watch the base over time. A corner initially bonded to the bed that later rises suggests shrinkage. A road that never adheres points first to the plate or nozzle gap.",
    "Check that the same corners remain flat at the end of the print and after cooling.",
  ],
  "layer-shift": [
    "Find the first shifted layer and note its direction. A sharp step remains in all layers above it. A repeating ripple after features points to ringing instead.",
    "Use a test with the same orientation and the travel moves that exposed the fault. Check the outline above the old failure height.",
  ],
  "under-extrusion": [
    "Check whether the gaps appear only on high-flow lines or even on slow walls. Missing paths in the slicer preview point to model or slicing settings before hardware.",
    "Test at normal and reduced speed. A baseline wall should have continuous roads at the flow rates you intend to use.",
  ],
  spaghetti: [
    "Look for the first place the extrusion became unsupported. A whole part sliding around implicates its footprint. Local loops above an intact base point toward a support, geometry or collision problem.",
    "Inspect the first layer and watch the retry past the height where it lost its foundation.",
  ],
  ringing: [
    "Compare several corners. Vibration echoes start just after sharp features and fade along the face. Horizontal ridges at the same heights around every face suggest Z banding.",
    "Use the same test and compare the first few echoes after each corner. Check that fine features remain sharp after tuning input shaping.",
  ],
  "elephant-foot": [
    "Compare the dimensions at the bottom with the same feature higher up. Try the mating part from both sides if the design allows it.",
    "The bottom flange should shrink without making the first layer detach or changing fit elsewhere.",
  ],
  "layer-separation": [
    "A split follows an existing layer plane, often with the upper section still aligned. Inspect other walls for thin roads and note whether cracks appeared during cooling or only under load.",
    "Use a small coupon printed with the same layer direction. Compare bonding and cracks after it fully cools.",
  ],
  "poor-bridging": [
    "Use the layer preview to see which roads span between two anchors. A curled ledge with just one anchor needs overhang tuning or support.",
    "Check the underside of a test with the same span and orientation. Normal walls should still bond well after changing bridge cooling.",
  ],
  "wet-filament": [
    "Listen for popping during steady extrusion, then check for pitted roads and irregular strings. Compare with dry filament of the same material at the same settings.",
    "A controlled dry-spool test should reduce popping and surface defects. Recurrence after humid storage suggests the spool is absorbing moisture again.",
  ],
  "top-gaps": [
    "Gaps over sparse infill with sound outer walls point to the roof’s thickness, support or cooling. Gaps in walls as well suggest a feeding or flow problem.",
    "Repeat the same roof at the same layer height. Check that the surface closes without leaving raised ridges.",
  ],
};

const cooling = "https://github.com/OrcaSlicer/OrcaSlicer/wiki/material_cooling";
const supports = prusa("support-material_1698");
const filamentFlow = "https://github.com/OrcaSlicer/OrcaSlicer/wiki/flow_ratio_calib";
const solidWalls =
  "https://github.com/OrcaSlicer/OrcaSlicer_WIKI/blob/main/print_settings/quality/quality_settings_wall_and_surfaces.md";

const additionalIssues = [
  {
    id: "uneven-first-layer",
    title: "First layer varies across the plate",
    summary: "The center looks right, while one corner scrapes or another leaves loose lines.",
    check:
      "Slice five small one-layer patches, one in each corner and one in the center. Note which positions are tight or loose. If the defect stays at the same spot on the machine when you move the test model, focus on the plate or calibration.",
    causes:
      "Debris between a removable sheet and its bed, a tilted bed or gantry, nozzle residue during probing, or a bed mesh made for different conditions.",
    fixes: [
      "With the printer cool, remove the plate if the maker permits it. Clear debris and reseat it fully in its locating features.",
      "Use the manufacturer’s leveling and calibration sequence, including any heat-up step. Clean the nozzle as prescribed before a nozzle-contact probe routine.",
      "If the same area remains wrong, check the bed and gantry per the service manual. A global offset moves all regions by the same amount.",
    ],
    verify: "All five patches form joined lines with close to the same finish and release behavior.",
    related: ["first-layer", "bed-mesh", "z-offset"],
    source: prusa("first-layer-issues_1804"),
    keywords: "one side too close high spot low spot uneven bed tramming probing",
  },
  {
    id: "part-wont-release",
    title: "Print bonded too strongly to the plate",
    summary: "A cooled part resists removal or starts to peel the build surface with it.",
    check:
      "Identify the exact surface and filament grades. PETG on some smooth PEI sheets can bond aggressively. A print that grabs only in the lowest layer may also show elephant’s foot.",
    causes:
      "An incompatible filament and sheet pairing, missing release layer, removal before the plate cools, or excess first-layer squish.",
    fixes: [
      "Let the plate cool to the release temperature recommended by the maker. Remove a flexible sheet from the bed before gently flexing it as directed.",
      "If the part stays attached, follow the sheet maker’s removal instructions. Stop levering when you see the coating lift.",
      "For the next job, select an approved surface or release layer and run a small adhesion test with the calibrated first-layer gap.",
    ],
    verify: "The test patch holds during printing and releases cleanly after cooling without pulling up the coating.",
    related: ["petg", "build-plate", "elephant-foot", "first-layer"],
    source: prusa("flexible-steel-sheets-guidepost_2195"),
    keywords: "stuck print removing over adhesion pei sheet damage",
  },
  {
    id: "support-collapses",
    title: "Supports detach, wobble or break",
    summary: "A support tower disappears halfway up, leaving loose strands beneath the model.",
    check:
      "Examine the earliest failed layer and the loose piece. A support lying intact on the bed lost its foot. A base that is still attached with a broken stem points to slender geometry or a strike.",
    causes:
      "A tiny support footprint, a tall thin branch, sparse connections, a curled feature, or a travel move hitting a support that flexed.",
    fixes: [
      "Confirm support toolpaths exist through the affected height and the foot has room to attach. Use a support brim or widen the base where available.",
      "Change support style or placement so long stems have enough stiffness. A conventional support can be a useful comparison for a narrow tree branch.",
      "Check for collision marks and reorient the model to shorten the support or reduce how far it sticks out.",
    ],
    verify: "The support stays upright past the old failure height and the supported feature forms continuously.",
    related: ["spaghetti", "rough-supports", "support", "orientation"],
    source: supports,
    keywords: "tree support organic support snapped support broken",
  },
  {
    id: "rough-supports",
    title: "Rough underside above supports",
    summary: "Scars, loose lines or patches of fused material remain where the support was removed.",
    check:
      "Compare the supported face with nearby free spans and look at the interface layers in preview. Loose sagging roads suggest too large a gap or a sparse interface. Torn patches and hard removal suggest the interface is bonding too well.",
    causes:
      "The contact distance, interface density, material pairing, or orientation leaves the bottom skin under-supported or too tightly attached.",
    fixes: [
      "Start with the slicer’s normal support preset and add interface layers if the affected face has none. Tune one setting on a small sample with the same underside.",
      "Test contact distance and interface spacing in small changes. Material pairing matters when the model and interface use different filaments.",
      "Reorient the part, split it, or move the support contact to a less visible surface if the required finish is hard to achieve.",
    ],
    verify: "Supports come off with reasonable effort and the test face has visibly more continuous roads.",
    related: ["poor-bridging", "support", "support-collapses", "orientation", "soluble"],
    source: supports,
    imageAlt: "An orange print has a rough downward-facing surface with traces of removed supports.",
    keywords: "ugly supports underside scar hard removal interface z distance",
  },
  {
    id: "over-extrusion",
    title: "Over-extrusion and raised top ridges",
    summary: "Solid areas have raised furrows, edges swell, or the nozzle drags through later layers.",
    check:
      "Locate the excess material. Ridges only on the first layer suggest nozzle gap. A filled top surface with extra material between adjacent roads suggests excess flow. Raised lines limited to infill intersections can be pattern-related.",
    causes:
      "An incorrect material flow setting, a nozzle or filament diameter profile mismatch, or a surface-specific flow setting stacked on the filament multiplier.",
    fixes: [
      "Check nozzle size, filament diameter and profile, then look for both material-level and object-level flow adjustments in the slicer.",
      "Calibrate flow on a small solid-top sample using the slicer’s procedure. Start from the stock profile before changing overrides.",
      "If only the roof shows the issue, check its toolpaths and top-surface settings before lowering flow for the entire part.",
    ],
    verify: "The top roads touch without raised ridges, and walls remain continuous and well bonded.",
    related: ["under-extrusion", "first-layer", "infill-collision", "flow-ratio"],
    source: filamentFlow,
    imageAlt: "Raised diagonal ridges run across the fully filled top of an orange test tile.",
    keywords: "too much plastic overextrusion rough solid top nozzle scraping ridges",
  },
  {
    id: "clogged-nozzle",
    title: "No filament comes out at the start",
    summary: "The printer moves as if printing, but the purge or first lines are missing.",
    check:
      "Run the maker’s loading or purge function above the plate. A good purge followed by a scraped first layer points to nozzle gap. Little or no filament in a purge points to feeding, temperature or an obstruction.",
    causes:
      "A stalled spool, filament left in the path, a partial or complete clog, a wrong loading temperature, or an extruder gear that cannot grip the filament.",
    fixes: [
      "Verify loaded material, target temperature and spool movement. Listen for clicking and inspect any safely accessible portion of the feed path.",
      "Reload using the printer’s guided procedure. If the flow remains blocked, follow the maker’s clog-clearing steps for that hotend and material.",
      "Check nozzle size after abrasive or particle-filled filament. Use a compatible nozzle before retesting the same profile.",
    ],
    verify: "A purge is continuous and the machine lays down a complete first-layer patch.",
    related: ["extruder-clicking", "first-layer", "heat-creep-jam", "under-extrusion"],
    source: prusa("clogged-nozzle-core-one-core-one-l-xl-mk4-s-mk3-9-s_411823"),
    keywords: "printer printing air no extrusion blocked nozzle not purging filament wont load",
  },
  {
    id: "heat-creep-jam",
    title: "Extrusion stops after the printer heats up",
    summary: "Flow starts normally, then fades or stops while the head keeps moving.",
    check:
      "Note when the failure begins. A repeated delay, especially with PLA in a hot chamber or after long sections of slow extrusion, suggests heat creep. Gaps only in fast lines point more toward the hotend’s flow limit.",
    causes:
      "Heat moves above the melt zone. A blocked, poorly working or incorrectly installed hotend fan, a hot enclosure or material dwelling too long can soften filament early.",
    fixes: [
      "Cancel the print. With the printer safe to inspect, check that the hotend cooling fan and its air path work as the maker specifies.",
      "Use the maker’s enclosure guidance for the material. For PLA the guidance may call for more chamber ventilation.",
      "Unload and clear any jam using the approved procedure. Test the same material and nozzle with a known-good profile before changing retraction.",
    ],
    verify:
      "Run the test long enough to exceed the original failure time, then check that the nozzle still purges steadily.",
    related: ["heat-creep", "extruder-clicking", "clogged-nozzle", "under-extrusion"],
    source: prusa("extrusion-stopped-mid-print-heat-creep_1948"),
    keywords: "heatcreep stops halfway intermittent hotend fan jams in chamber pla",
  },
  {
    id: "extruder-clicking",
    title: "Extruder clicks or chews filament",
    summary: "The feed gear skips or leaves a ground notch in the filament.",
    check:
      "Identify whether the sound follows extrusion or motion. Clicking only at high flow suggests resistance in the melt zone. Clicking during a purge calls for checking the path and hotend. A rough notch shows the gears were turning against resistance.",
    causes:
      "Sudden spool drag, a kink or constrained tube, wrong idler tension, a partial clog, or a requested speed the hotend cannot sustain.",
    fixes: [
      "Check that the spool unwinds freely and the routing follows the manufacturer’s guidance. Inspect the unloaded filament for a crushed or carved section.",
      "Use the approved procedure to clean drive gears and check idler tension. Test a purge at the material’s normal load temperature.",
      "If the purge works, test lower print speed or the stock volumetric-flow limit. Persistent skipping at ordinary load flow needs printer-specific service checks.",
    ],
    verify:
      "The filament advances with no clicking and extrusion stays continuous on both a purge and a small real print.",
    related: ["extruder", "clogged-nozzle", "heat-creep-jam", "volumetric-flow", "tpu"],
    source: prusa("under-extrusion_2007"),
    keywords: "clicking motor skipping ticking grinding gear filaments chewed",
  },
  {
    id: "nozzle-blob",
    title: "Plastic blob around the hotend",
    summary: "A growing mass of filament wraps the nozzle or heater block.",
    check:
      "After stopping the printer, compare the failure with the first layer and look for the origin from a safe distance. A loose part can be dragged around the nozzle. Plastic emerging higher up around the heater or nozzle joint can indicate a leak.",
    causes:
      "First-layer detachment lets molten filament build up around the head. An incorrectly seated or damaged nozzle assembly can also leak, depending on the hotend design.",
    fixes: [
      "Cancel the print and follow the manufacturer’s blob-removal procedure for the exact toolhead. Wires can be embedded in the mass and are easy to pull loose.",
      "Have damaged wiring, heater or sensor parts serviced per the manual before restarting. If the hotend leaks, use its specified installation procedure or replace the affected assembly.",
      "After service, rerun first-layer calibration and watch a small print to verify that it remains attached.",
    ],
    verify:
      "The print stays on the bed, filament emerges only at the nozzle tip, and temperatures stay stable during a supervised test.",
    related: ["spaghetti", "first-layer", "temperature-error", "hotend"],
    source: prusa("extruder-blob_2005"),
    keywords: "blob of death extruder blob plastic leaking heater block snowball hot end",
  },
  {
    id: "temperature-error",
    title: "Printer stops with a temperature error",
    summary: "The machine aborts with thermal runaway, heating failed, MINTEMP, or a related warning.",
    check:
      "Record the exact message, which heater it names and whether it appeared during heat-up, at fan start or after movement. An implausible reading while the printer is cold suggests checking the sensor path.",
    causes:
      "The controller may be reading an unstable sensor, detecting an open or damaged connection, or seeing a heater fail to reach or hold its target.",
    fixes: [
      "Leave the job stopped. Power down and let the printer cool before doing any physical inspection per its service manual.",
      "Check the manufacturer’s error-code instructions for the affected hotend or bed. If the printer reports damaged electrical parts, have them serviced or replaced.",
      "Keep thermal protection enabled. Resume normal printing after the underlying fault is corrected and the manufacturer’s checks pass.",
    ],
    verify:
      "Perform the recommended post-service test and confirm both heaters report plausible readings and hold their targets without another shutdown.",
    related: ["hotend", "nozzle-blob", "heat-creep-jam"],
    source: prusa("thermal-runaway-i3-series_2131"),
    keywords: "mintemp maxtemp thermal runaway hotend bed heating failed thermistor emergency",
  },
  {
    id: "z-banding",
    title: "Z banding and regularly spaced ridges",
    summary: "Repeating horizontal bands wrap around a vertical wall without a single abrupt offset.",
    check:
      "Measure the spacing between bands and compare all faces on a simple, straight tower. Bands at the same height across different models suggest Z motion or recurring extrusion variation. A line tied to a transition in the model may follow a layer-time or cooling change instead.",
    causes:
      "Periodic Z-axis motion, binding or play where the gantry or bed moves, or periodic feed inconsistency. Geometry and cooling can also produce horizontal lines.",
    fixes: [
      "Print a straight tower at a stock profile and compare it with the problem model. Check whether the bands run all the way around or begin after specific corners.",
      "Inspect the printer’s Z motion using its service instructions. Check lead screws, couplers, belts or guides as applicable to that design.",
      "Compare against a different dry spool and inspect feed if motion checks are sound. Re-test after changing one factor.",
    ],
    verify:
      "On the same tower, periodic ribs diminish without introducing layer shifts or changing material profiles mid-test.",
    related: ["layer-shift", "ringing", "gloss-bands", "under-extrusion"],
    source: printQuality,
    imageAlt: "A straight orange calibration tower has evenly spaced raised horizontal bands.",
    keywords: "zwobble z wobble z axis lead screw horizontal repeating bands ridges",
  },
  {
    id: "seam-blobs",
    title: "Seam blobs, pits or a vertical zipper",
    summary: "Small bumps or divots line up where outer walls begin and end.",
    check:
      "Turn on the seam markers in preview. If the dots move when you set a different seam location, you have identified the start-and-stop behavior. Random pits unrelated to seams may be moisture or feed.",
    causes:
      "Residual nozzle pressure, oozing during travel, a restart that is starved, or a seam gap or wipe setting poorly matched to the profile.",
    fixes: [
      "Start with stock flow and retraction and confirm steady feeding. Tune pressure advance only if your firmware and profile support it.",
      "Place the seam at a corner or less visible side. On a curved wall, compare alignment with a supported scarf-seam option if your slicer offers it.",
      "Change one restart, wipe or seam setting at a time. Inspect the result for both bumps and gaps.",
    ],
    verify: "The line of dots follows the chosen seam and shows less bunching without tiny holes at the restart.",
    related: ["seam", "stringing", "pressure-advance", "wet-filament"],
    source: "https://github.com/OrcaSlicer/OrcaSlicer/wiki/quality_settings_seam",
    imageAlt: "A single vertical line of raised dots runs along an otherwise even orange cylinder.",
    keywords: "zits seam line pimples zipper seam gap start stop scarf seam",
  },
  {
    id: "gloss-bands",
    title: "Shiny and matte bands on an even wall",
    summary: "The part changes sheen at certain heights even though the outline stays aligned.",
    check:
      "Hold the part in raking light and feel for actual ridges. Use the speed and layer-time preview around the bands. A sheen change that follows speed or a short layer can appear without a dimensional step.",
    causes:
      "Different extrusion rates and cooling histories change the surface finish. A new infill pattern, smaller layer area or material temperature change can produce a band.",
    fixes: [
      "Compare the marked height with outer-wall speed, flow and fan changes in the slicer. Check if the same transition appears on another copy.",
      "Test a more consistent outer-wall speed within the spool’s range. For small cross-sections, compare the layer-time and cooling settings.",
      "If there is a real ridge at a geometry transition, test the orientation or wall and top-skin transition before altering mechanical settings.",
    ],
    verify: "A repeat print shows a more even sheen under the same lighting, with sound adhesion and no lost detail.",
    related: ["z-banding", "small-layer-overheating", "benchy-history", "tuning"],
    source: prusa("the-benchy-hull-line_124745"),
    keywords: "matte glossy shiny stripes sheen benchy hull line layer time color change",
  },
  {
    id: "small-layer-overheating",
    title: "Small tips curl or turn soft",
    summary: "Narrow spires, horns or the top of a cone deform while the wider base prints cleanly.",
    check:
      "Inspect the preview where layers get short. If printing two well-spaced copies by layer improves the tips, the original layers likely needed more time to cool.",
    causes:
      "The next pass returns before the previous layer has solidified. High temperature, a short toolpath and weak airflow can make the nozzle push softened material aside.",
    fixes: [
      "Check that the part-cooling fan works and the preset matches the filament. Try the slicer’s minimum layer-time or small-layer cooling controls within the material’s limits.",
      "Test two copies printed together by layer to allow cooling between visits. Compare a short sample at a lower approved nozzle temperature.",
      "Orient the model to give very small features more support if practicable. Excess cooling can reduce layer bonding on shrink-prone materials.",
    ],
    verify: "Narrow layers hold their shape and the tip remains sharp while the base retains good bonding.",
    related: ["gloss-bands", "poor-bridging", "layer-separation", "tuning"],
    source: cooling,
    imageAlt: "An orange tapered cone has a clean base and a softened, bent tip.",
    keywords: "droopy pointed tips melted spike miniatures overheating minimum layer time cooling",
  },
  {
    id: "infill-wall-gap",
    title: "Infill separates from the walls",
    summary: "The ends of infill roads stop short or peel away from the inner perimeter.",
    check:
      "Watch the infill before the roof closes, or print an open test piece. A consistent gap at line ends points to overlap or anchoring. Thin gaps along the entire infill network suggest flow or speed.",
    causes: "Too little wall overlap, weak infill anchors, a high infill flow demand, or inconsistent feed.",
    fixes: [
      "Use the preview to check that infill reaches the perimeter. Reset custom overlap and line-width settings to the stock profile as a baseline.",
      "If the path meets the wall but the roads are thin, test a slower infill speed or an appropriate volumetric limit.",
      "Tune infill overlap in small steps once flow is stable. Excess overlap can show as a texture or bulge on the outer wall.",
    ],
    verify: "Infill roads bond at their ends and the external wall remains smooth.",
    related: ["infill", "under-extrusion", "over-extrusion", "infill-collision"],
    source: "https://github.com/OrcaSlicer/OrcaSlicer/wiki/strength_settings_infill",
    imageAlt: "A dark gap separates the diagonal infill lines from the solid inner walls of an open orange sample.",
    keywords: "infill perimeter gaps detached infill wall overlap anchor",
  },
  {
    id: "infill-collision",
    title: "Nozzle clicks or scrapes across infill",
    summary: "The nozzle knocks on raised crossing points or catches during internal travel.",
    check:
      "Compare the noise with line types in preview. A strike at grid intersections points to raised crossings. A strike near an edge suggests curling or a loose part. A feed gear clicking while no extrusion comes out needs a separate feed check.",
    causes:
      "Patterns with same-layer crossings, excess extrusion, curled infill or an unstable part. A nozzle strike can become a layer shift or knock a support free.",
    fixes: [
      "Inspect the part for curled edges and correct adhesion or overlap before retrying a print that shifts or comes loose.",
      "Try an infill pattern without same-layer crossings, such as gyroid when your slicer implements it that way. Check that the new pattern supports the roof adequately.",
      "If roads are consistently too high, check flow and nozzle profile. Use any lift-on-travel option as a secondary measure after the source of the raised feature is understood.",
    ],
    verify: "The same region prints and travels quietly, and the roof above it still closes properly.",
    related: ["infill-wall-gap", "over-extrusion", "layer-shift", "warping", "extruder-clicking"],
    source: prusa("infill-patterns_177130"),
    keywords: "nozzle hitting infill clicking grid scraping gyroid z hop travel collision",
  },
  {
    id: "missing-thin-walls",
    title: "Thin walls, lettering or details disappear",
    summary: "A feature is visible in CAD but vanishes from the print or slicer preview.",
    check:
      "Inspect the affected layer in the slicer. If there is no path, check the feature’s width, height and mesh. If a path exists but fails on the part, examine speed, cooling, support and feeding.",
    causes:
      "The feature is narrower than the profile’s usable line width, shallower than the chosen layer height, or represented by invalid or overlapping geometry.",
    fixes: [
      "Verify model scale and that the model is a closed solid. Increase feature width or letter height in CAD where dimensions allow.",
      "Try the slicer’s variable-width wall generator or a smaller supported nozzle with its own profile. Use a finer layer height for shallow relief.",
      "Review the layers again and print only the affected feature for the first test.",
    ],
    verify: "The preview has continuous paths through the detail and the printed sample preserves it.",
    related: ["cad", "line-width", "layer-height", "first-print"],
    source: prusa("arachne-perimeter-generator_352769"),
    keywords: "invisible text small letters absent details broken mesh missing walls arachne",
  },
  {
    id: "undersized-holes",
    title: "Holes print small or mating parts bind",
    summary: "A pin or fastener fits in the CAD model but will not enter the printed hole.",
    check:
      "Measure above the first layer and test holes in more than one orientation. Binding just at the bottom points to first-layer flare. Horizontal holes can lose height from sagging. A repeatable undersize on vertical holes may need a clearance or hole compensation adjustment.",
    causes:
      "Insufficient design clearance, extrusion width, thermal shrinkage, rough seams, unsupported hole ceilings, or a mismatch between the CAD and sliced geometry.",
    fixes: [
      "Verify the input dimensions and inspect the hole in preview for line placement and overhangs. Use a stock preset with calibrated flow.",
      "Print a small gauge with several pin and hole sizes in the real material and orientations. Use the successful clearance in CAD or apply a suitable slicer hole correction.",
      "For horizontal holes, consider a teardrop or chamfered roof, a different orientation, or a separate part.",
    ],
    verify: "A sample assembled in the intended direction has usable clearance above and at the first layer.",
    related: ["tolerance", "elephant-foot", "bridging-guide", "cut-prints", "cad"],
    source: prusa("modeling-with-3d-printing-in-mind_164135"),
    keywords: "dimension inaccurate xy hole compensation tight fit tolerance bore horizontal hole shrinkage",
  },
  {
    id: "color-bleed",
    title: "Old color carries into the next filament",
    summary: "A light color looks stained for a while after a darker material was printed.",
    check:
      "Inspect the first new-color paths and the prime or wipe tower. Gradual tint near a change points to residual color in a shared nozzle. Visible dark infill under a clean skin has a different cause.",
    causes:
      "A single nozzle still contains part of the previous melt. Dark-to-light changes can need more purge than the reverse. Dark purge routed into infill can show through thin, light walls.",
    fixes: [
      "Adjust the transition-specific purge volume using a small sample with the actual spools. Use the maker’s change or prime procedure.",
      "Inspect wipe-to-infill or wipe-to-object settings. Keep dark purge away from surfaces that must remain light or translucent.",
      "Check filament loading and the change sequence if the entire region stays the wrong color.",
    ],
    verify:
      "The first visible strokes after the change match the intended color, with no contamination through the outer wall.",
    related: ["slicers", "top-layers", "multimaterial-history", "snapmaker"],
    source: prusa("purging-volumes-mmu_125097"),
    keywords: "purge poop wipe tower color contamination transition multicolor flush",
  },
  {
    id: "leaning-walls",
    title: "Walls lean or square corners print skewed",
    summary: "A tall wall drifts continuously or a nominally square pattern prints as a parallelogram.",
    check:
      "Compare a low square test with a tall straight tower. Unequal diagonals on a flat square suggest XY skew. A tilt visible only in tall narrow samples may come from the part swaying. A single abrupt step is a layer shift.",
    causes:
      "A frame or gantry out of square, an axis misalignment, or a slender print flexing with motion. A model can also lean by design once oriented in the slicer.",
    fixes: [
      "Check the model and measured directions in preview. Measure the print after cooling and compare two independent diagonals.",
      "Follow the manufacturer’s gantry and frame alignment procedure before considering documented firmware skew compensation.",
      "For a moving or flexible part, test a wider base, a different orientation or lower acceleration.",
    ],
    verify:
      "The square’s diagonals agree within the job’s tolerance, and a straight tower stays vertical through the full height.",
    related: ["layer-shift", "tolerance", "ringing", "orientation"],
    source: "https://www.klipper3d.org/Skew_Correction.html",
    keywords: "xy skew slant crooked print leaning taper out of square diagonal frame",
  },
  {
    id: "brittle-filament",
    title: "Filament snaps in the feed path",
    summary: "The strand breaks inside a tube, feeder or multi-material unit, often while loading or retracting.",
    check:
      "Pull a short length off the spool and bend it gently into a loop. A strand that snaps cleanly is brittle. Breaks that always happen at the same bend, gear or tube joint point to the feed path rather than the spool.",
    causes:
      "Old or damp filament can turn brittle. Resting in a tight curve or a sharp tube bend, a pinching idler and repeated retractions through a feeder can also crack the strand.",
    fixes: [
      "With the printer cool and idle, remove the broken pieces using the maker’s procedure for that feeder, tube or hub. Don’t force a fragment past a coupler.",
      "Dry the spool to the maker’s schedule and store it sealed. Drying helps a damp spool, but filament that stays brittle afterward may need replacing.",
      "Route tubes so the strand never waits in a tight bend, and check idler tension against the printer’s instructions.",
      "If breaks happen only during filament changes, compare a fresh spool before changing the change sequence or retraction.",
    ],
    verify:
      "The loop test bends without snapping, and the spool loads, prints and unloads several times with no fragment left behind.",
    related: ["wet-filament", "filament-drying", "pla", "extruder", "bowden"],
    source: "https://wiki.bambulab.com/en/x1/troubleshooting/broken-filament-anywhere",
    keywords:
      "filament breaking snapping brittle pla cracked filament broken in ptfe tube ams feeder snapped stuck in tube",
  },
  {
    id: "feed-tangle",
    title: "Spool tangles or feeding drags",
    summary: "The spool stops turning, the strand pulls tight or a multi-material feeder reports a feed error.",
    check:
      "Watch the spool while the extruder pulls. A wrap trapped under a neighboring loop stops the spool suddenly. A smooth but heavy pull points to the holder, the spool hub or a long tube.",
    causes:
      "A free end released during unloading can slip under another wrap and form a knot. Stiff spool holders, unsupported reel sizes, kinked tubes and long routes add drag.",
    fixes: [
      "Pause or cancel the job. Hold the free end, find the crossed wrap and ease it free without kinking the filament, then rewind the slack.",
      "Clip the free end into the spool’s hole every time before letting go of it.",
      "Check that the holder turns freely and that the reel’s type and size suit the feeder. Use the maker’s adapter for cardboard reels if it requires one.",
      "Route tubes in smooth curves, then test the feed with a long purge or a small part.",
    ],
    verify: "The spool turns smoothly through a full print and the feeder completes its loads without drag or errors.",
    related: ["extruder-clicking", "under-extrusion", "bowden", "multimaterial-history", "print-stops"],
    source: prusa("tangled-filament_421198"),
    keywords: "tangled spool knot filament tangle spool stuck ams feed error ams jam spool holder drag cardboard spool",
  },
  {
    id: "bulging-corners",
    title: "Corners bulge and line width varies",
    summary: "Corners swell or round over, while lines thin out just after each start or speed change.",
    check:
      "Print a thin-walled square or the slicer’s pressure advance test. A bulge at each corner followed by a thin stretch suggests nozzle pressure lagging behind the motion. Fat corners at every speed point to excess flow instead.",
    causes:
      "Molten filament compresses in the melt zone, so flow trails behind quick speed changes. Missing or uncalibrated pressure advance, high acceleration, soft filament and long Bowden paths make it more visible.",
    fixes: [
      "Check flow with the stock profile first. Tune flow and pressure separately, never together.",
      "Run the slicer’s or firmware’s pressure advance calibration for the filament, nozzle and speed you use. Marlin calls its version Linear Advance.",
      "Keep the value with the filament where your slicer or printer allows, since materials and colors can need different values. Lower acceleration if corners still swell.",
    ],
    verify: "On the same test at the same speeds, corners stay sharp and line ends match the middle of each line.",
    related: ["pressure-advance", "over-extrusion", "seam-blobs", "flow-ratio", "bowden"],
    source: "https://github.com/OrcaSlicer/OrcaSlicer/wiki/pressure_advance_calib",
    keywords:
      "bulging corners swollen corners rounded corners linear advance pressure advance k factor uneven line width corner blobs",
  },
  {
    id: "vfa-ripples",
    title: "Fine vertical ripples at certain speeds",
    summary: "Even, closely spaced vertical lines cover flat walls, then fade or change at another speed.",
    check:
      "Print the slicer’s VFA speed tower, or a cube at several outer-wall speeds. Ripples that come and go with speed across whole faces suggest motor or belt resonance. Echoes that start at a corner and fade along the wall are ringing.",
    causes:
      "Stepper motors, belts and pulleys can vibrate at particular speeds. Belt tension, worn pulleys and loose parts make it worse. Input shaping reduces corner echoes but doesn’t always cure this pattern.",
    fixes: [
      "Inspect the tower and note the speed bands with the roughest surface.",
      "Set the outer-wall speed outside those bands. Some slicers let a printer profile list speed ranges to avoid.",
      "If ripples appear at every speed, inspect belts, pulleys and idlers per the service manual, and run the printer’s vibration calibration where offered.",
    ],
    verify: "The wall prints with less ripple at the chosen speed and corners stay as sharp as before.",
    related: ["ringing", "z-banding", "input-shaping", "motion-history", "corexy"],
    source: "https://github.com/OrcaSlicer/OrcaSlicer/wiki/vfa_calib",
    keywords:
      "vfa vertical fine artifacts vertical lines on walls salmon skin motor resonance belt texture ripples mrr",
  },
  {
    id: "blobs-zits",
    title: "Scattered blobs and zits",
    summary: "Small bumps dot the walls instead of lining up along one seam.",
    check:
      "Turn on seam and retraction markers in the preview. Zits that match scattered seam points or retraction spots come from starts and stops. Bumps with no link to toolpath events point to moisture or feeding.",
    causes:
      "A random seam, many retractions on travel moves, pressure left in the nozzle when it stops, a nozzle near the top of its range, or damp filament.",
    fixes: [
      "Choose an aligned or rear seam instead of random, unless the shape has no good place to hide one.",
      "Cut needless retractions with avoid crossing walls (combing in Cura), and check retraction and wipe with the slicer’s retraction test.",
      "Dry the spool and test a slightly cooler nozzle within the material’s range. Calibrate pressure advance where your printer supports it.",
    ],
    verify: "A repeat print shows fewer bumps, and the marks that remain follow the seam you chose.",
    related: ["seam-blobs", "seam", "retraction", "wet-filament", "pressure-advance"],
    source: "https://github.com/OrcaSlicer/OrcaSlicer/wiki/retraction_calib",
    keywords: "zits blobs pimples random bumps on surface scattered blobs retraction wipe random seam",
  },
  {
    id: "travel-scars",
    title: "Nozzle drags scars across top surfaces",
    summary: "Thin lines or scratches cross a finished top surface between features.",
    check:
      "Match the scars to travel moves in the preview. Lines along travel paths over a finished top mean the nozzle is dragging. Raised or curled top edges that catch the nozzle suggest excess flow or curling.",
    causes:
      "Travel moves cross finished surfaces at the height of the last layer. Excess top flow, curled edges and oozing make contact more likely.",
    fixes: [
      "Turn on travel lift: Z hop in Bambu Studio and OrcaSlicer, Lift height in PrusaSlicer’s travel lift settings, Z Hop When Retracted in Cura. Limit it to top surfaces if the option exists, since lifting on every travel can add strings.",
      "Keep travel inside the part with avoid crossing walls in Bambu Studio and OrcaSlicer, avoid crossing perimeters in PrusaSlicer or combing in Cura.",
      "Calibrate top-surface flow and look for curled edges. Ironing can smooth a top that still shows marks.",
    ],
    verify: "The same top surface prints without scars, and the walls show no new stringing.",
    related: ["z-hop", "travel-move", "retraction", "over-extrusion", "infill-collision", "stringing"],
    source: "https://github.com/OrcaSlicer/OrcaSlicer/wiki/printer_extruder_z_hop",
    keywords:
      "z hop zhop nozzle scratches top surface travel marks scars lines on top avoid crossing walls combing lift z",
  },
  {
    id: "one-side-overhangs",
    title: "Overhangs droop on one side only",
    summary: "The same overhang prints cleanly on one face and curls or sags on the opposite face.",
    check:
      "Print a small overhang test with the same angle facing four directions. If the bad side stays the same on the machine wherever the test sits, compare it with the direction the part-cooling air comes from.",
    causes:
      "Many toolheads cool from one side or through an uneven duct. A cracked or loose duct, a slow fan or plastic stuck in the duct weakens airflow further.",
    fixes: [
      "With the printer off and cool, check the part-cooling fan and duct for damage, debris or a loose fit using the service manual.",
      "Rotate the part so its hardest overhang faces the strongest airflow. Slow the overhang walls if your slicer has a separate overhang speed.",
      "Add supports or a chamfer under overhangs that still fail, or use an auxiliary fan if the printer has one and the material suits it.",
    ],
    verify: "The four-direction test shows a similar finish on every face, or the rotated part prints cleanly.",
    related: ["poor-bridging", "overhang", "temperature-cooling", "orientation", "small-layer-overheating"],
    source: cooling,
    keywords: "one side overhang bad fan duct single fan side cooling uneven overhang curling one side droop",
  },
  {
    id: "wall-gaps",
    title: "Gaps between walls",
    summary: "Thin slits run between perimeters, or between the inner wall and the solid fill.",
    check:
      "Find the gap in the slicer’s line-type preview. A gap in the preview means the wall widths don’t fill the space. A solid preview but a gappy print points to flow or feeding.",
    causes:
      "A wall thickness that isn’t a clean multiple of the line width, the classic wall generator leaving thin leftovers, gap fill turned off, or low flow.",
    fixes: [
      "Compare the variable-width wall generator, Arachne, with the classic one in the preview.",
      "Check that gap fill is on for the region, or change the wall line width or count so the walls fill the space.",
      "If the preview is closed, calibrate flow and rule out under-extrusion before changing wall widths.",
    ],
    verify:
      "The preview and the print both show walls that touch along their whole length, with no new bulge on the outer wall.",
    related: ["perimeter", "line-width", "under-extrusion", "infill-wall-gap", "missing-thin-walls"],
    source: prusa("layers-and-perimeters_1748"),
    keywords: "gap between perimeters wall gaps slits in walls gap fill arachne classic perimeters thin gaps in wall",
  },
  {
    id: "infill-show-through",
    title: "Infill pattern shows through the walls",
    summary: "A faint grid or diagonal texture appears on outer walls or under thin top skins.",
    check:
      "Hold the part against a light. A texture that matches the infill in the preview is show-through, sometimes called infill ghosting. It is most visible on thin walls and light or translucent colors.",
    causes:
      "Too few walls, a high infill-to-wall overlap, infill printed before the walls, or thin translucent filament.",
    fixes: [
      "Add one wall loop and compare. An extra wall usually adds strength as well.",
      "Reset infill overlap to the profile’s default and keep walls printing before infill.",
      "Under top skins, add top layers or use denser infill. A more opaque filament helps with light colors.",
    ],
    verify: "The walls look even under the same light, with no new bulges where the infill meets them.",
    related: ["infill", "perimeter", "top-layers", "infill-wall-gap", "shell-settings"],
    source: "https://github.com/OrcaSlicer/OrcaSlicer/wiki/strength_settings_walls",
    keywords:
      "infill visible through walls infill ghosting see infill pattern outer wall translucent shadow grid show through",
  },
  {
    id: "weak-parts",
    title: "Parts break or flex too easily",
    summary: "A part that looks fine snaps, cracks at a corner or bends more than expected in use.",
    check:
      "Examine the break. A clean split along one layer points to layer bonding or orientation. A crack from a sharp inside corner points to the design. A part that bends without breaking may need thicker walls or a stiffer material.",
    causes:
      "Load pulling across the layers, thin walls with sparse infill, sharp inside corners, a cold or fast print with weak bonds, damp filament, or a material that doesn’t suit the load or heat.",
    fixes: [
      "Orient the part so its main load runs along the printed lines rather than across the layers.",
      "Add walls and top and bottom layers before raising infill. Walls often add more strength per gram, but test the real part.",
      "Round sharp inside corners in CAD, and print within the material’s range from a dry spool for good bonding.",
      "Pick a material for the load and temperature, such as PETG or ASA rather than PLA for a part that gets warm.",
    ],
    verify:
      "A test piece with the new orientation and settings survives the real load, or fails somewhere other than the old break.",
    related: ["anisotropy", "layer-separation", "orientation", "shell-settings", "petg"],
    source: prusa("modeling-with-3d-printing-in-mind_164135"),
    keywords:
      "weak prints brittle parts break easily part strength stronger prints snapped part layer lines walls vs infill",
  },
  {
    id: "wrong-size",
    title: "Model prints at the wrong size",
    summary: "A part comes out tiny, huge or slightly off from the size it was designed at.",
    check:
      "Compare the size in the slicer with the intended size. A factor of about 25.4 means inches read as millimeters. A factor of 10 or 1,000 suggests centimeters or meters. A small error, the same on every part, points to shrinkage or calibration.",
    causes:
      "STL files store no units, so slicers assume millimeters. A scale left on the object, material shrinkage or incorrectly configured axis motion can also change the size.",
    fixes: [
      "Re-export from CAD in millimeters, or use the slicer’s convert-from-inches option or a 2540% scale.",
      "Reset the object’s scale to 100% and check the size fields in the object panel before slicing.",
      "Measure a simple calibration part with a trusted tool. For a small consistent error, follow the printer maker’s calibration rather than scaling every model. Shrink-prone materials may take a shrinkage setting in the filament profile, where your slicer has one.",
    ],
    verify: "The slicer shows the intended dimensions and a test part measures within the tolerance you need.",
    related: ["stl-3mf", "cad", "tolerance", "undersized-holes", "3mf-history"],
    source: prusa("object-manipulation-panel_1757"),
    keywords: "wrong size too small tiny model inches mm units scale 2540% shrinkage dimensions off model huge",
  },
  {
    id: "broken-mesh",
    title: "Slicer shows missing walls or holes from a broken mesh",
    summary: "Layers go missing, walls vanish or the slicer warns about errors, open edges or a repaired model.",
    check:
      "Look for the slicer’s mesh error icon or repair notice, then scroll the layer preview for missing areas. A floating-region or empty-layer warning on a sound mesh is an orientation or support question instead.",
    causes:
      "The model isn’t a closed solid. Open edges, flipped faces, overlapping shells, self-intersections and surfaces with no thickness are common in mesh exports, sculpts and game assets.",
    fixes: [
      "Let the slicer repair the model, then check the preview again. Automatic repair can guess wrong on thin or detailed areas.",
      "Fix the source: export a closed solid from CAD, or use a mesh tool to close holes, recalculate normals and merge shells.",
      "If the designer offers a 3MF or STEP file, try it instead of the STL.",
    ],
    verify: "The slicer reports no errors and every layer of the preview shows the expected walls.",
    related: ["manifold", "stl-3mf", "cad", "missing-thin-walls", "orientation", "support"],
    source: prusa("corrupted-3d-models-for-printing_2205"),
    keywords:
      "non manifold nonmanifold broken mesh open edges model errors repair mesh missing layers holes in model flipped normals",
  },
  {
    id: "print-stops",
    title: "Print stops or pauses partway",
    summary: "The printer pauses, cancels or simply halts mid-job, sometimes with no clear message.",
    check:
      "Read the screen, app or log first. A runout message, a temperature error and a lost connection each point somewhere different. Note the layer where it stopped and whether filament is still loaded.",
    causes:
      "The filament ran out or tangled, the runout sensor triggered falsely, extrusion stopped, a temperature fault halted the job, the power dropped, or a USB or network host stopped sending it.",
    fixes: [
      "After a runout or tangle, follow the printer’s resume procedure. Check that the part is still attached before resuming.",
      "If the sensor triggers with filament present, clean or test it as the manual describes. Some printers let you turn it off for a single job.",
      "Print from the printer’s own storage or queue rather than streaming from a computer that can sleep.",
      "After a power cut, use the printer’s recovery feature if it has one. Consider a UPS for long jobs.",
    ],
    verify: "A long test job finishes, or pauses only when the filament really runs out and then resumes cleanly.",
    related: ["feed-tangle", "temperature-error", "heat-creep-jam", "spaghetti", "gcode"],
    source: prusa("filament-runout_916077"),
    keywords:
      "print stopped halfway paused print filament runout sensor power loss resume print usb disconnect print cancelled",
  },
  {
    id: "homing-failure",
    title: "Homing or probing fails before printing",
    summary: "The printer stops during homing, bed leveling or calibration with an axis or probe error.",
    check:
      "Record the error code and the axis or step it names. A failure only from a cold start, only with one plate or only after a nozzle wipe narrows down the cause.",
    causes:
      "Filament or residue on a nozzle-contact probe, a missing or unsuitable plate for an inductive probe, an obstruction or binding axis, a loose cable, or vibration from the surface under the printer.",
    fixes: [
      "Turn the printer off and let it cool. Clear anything in the way of the axes and seat the build plate as the maker specifies.",
      "Clean the nozzle tip as the manual prescribes before nozzle-contact probing, and use the plate type the probe expects.",
      "Look up the error code in the maker’s documentation for your exact model and follow its checks. Don’t disable a failing probe to get past it.",
    ],
    verify: "Homing and calibration complete several times in a row, and the first layer comes out even.",
    related: ["uneven-first-layer", "bed-mesh", "z-offset", "first-layer", "layer-shift"],
    source: "https://help.prusa3d.com/category/printer-troubleshooting_227",
    keywords:
      "homing failed probing failed bed leveling failed homing error z axis probe error crash detection endstop calibration failed",
  },
];

const groupedIds = [
  ["First layer and bed", ["first-layer", "uneven-first-layer", "warping", "elephant-foot", "part-wont-release"]],
  [
    "Filament and hotend",
    [
      "under-extrusion",
      "over-extrusion",
      "stringing",
      "wet-filament",
      "clogged-nozzle",
      "extruder-clicking",
      "heat-creep-jam",
      "nozzle-blob",
      "temperature-error",
      "brittle-filament",
      "feed-tangle",
    ],
  ],
  [
    "Walls, motion and finish",
    [
      "layer-shift",
      "ringing",
      "vfa-ripples",
      "z-banding",
      "leaning-walls",
      "layer-separation",
      "seam-blobs",
      "blobs-zits",
      "bulging-corners",
      "travel-scars",
      "gloss-bands",
      "color-bleed",
    ],
  ],
  [
    "Supports and cooling",
    [
      "spaghetti",
      "poor-bridging",
      "one-side-overhangs",
      "support-collapses",
      "rough-supports",
      "small-layer-overheating",
    ],
  ],
  [
    "Geometry, fit and infill",
    [
      "top-gaps",
      "infill-wall-gap",
      "wall-gaps",
      "infill-show-through",
      "infill-collision",
      "missing-thin-walls",
      "undersized-holes",
      "weak-parts",
    ],
  ],
  ["Files, slicing and machine", ["wrong-size", "broken-mesh", "print-stops", "homing-failure"]],
];

const availableIssues = new Map(
  [
    ...originalIssues.map((entry) => {
      const [check, verify] = diagnosticNotes[entry.id];
      return { ...entry, check, verify };
    }),
    ...additionalIssues,
  ].map((entry) => [entry.id, { ...entry, section: "Troubleshooting" }]),
);

export const issueGroups = groupedIds.map(([title, ids]) => ({
  title,
  entries: ids.map((id) => {
    const entry = availableIssues.get(id);
    if (!entry) throw new Error(`Unknown troubleshooting case ${id}`);
    return { ...entry, category: title };
  }),
}));

export const issues = issueGroups.flatMap(({ entries }) => entries);
if (new Set(issues.map(({ id }) => id)).size !== availableIssues.size || issues.length !== availableIssues.size)
  throw new Error("Every troubleshooting case must belong to one group");
