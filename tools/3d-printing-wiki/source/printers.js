import { reference } from "./references.js";

const printer = (...args) => reference("Printers", ...args);

export const printers = [
  printer(
    "printer-types",
    "Compare desktop printer types",
    "Read build size, motion system, enclosure and material compatibility together.",
    [
      [
        "Open beds and enclosed machines",
        "An open moving-bed printer is easy to access and often well suited to PLA and PETG. An enclosed machine can limit drafts for shrink-prone filament. Check the actual material requirements and ventilation guidance.",
      ],
      [
        "Motion and print size",
        "In a common moving-bed design, the plate moves back and forth in Y. In a CoreXY design, two coordinated motors move the head in X and Y. The motion layout alone tells you little about bed size, quality or material support.",
      ],
      [
        "Compare practical limits",
        "Check usable dimensions for the part and its brim or supports, suitable plate types, nozzle temperature and material, profiles, spare parts, service documentation and local connection options.",
      ],
      [
        "Compare how material changes work",
        "A feeder that swaps spools into one nozzle is mechanically different from two independent carriages or a docked toolchanger. Check purge requirements, material compatibility, usable build area and tool calibration for your intended job.",
      ],
      [
        "Where popularity figures come from",
        "CONTEXT reported Bambu Lab, Creality, Elegoo and Anycubic among the leading vendors by entry-level 3D printer shipments in Q4 2025. That tracks shipments by vendor. The model examples below reflect commonly encountered families and use cases.",
      ],
    ],
    ["bambu-lab", "prusa", "creality", "qidi", "multimaterial-history", "cut-prints", "slicers"],
    [
      [
        "CONTEXT · Q4 2025 shipment report",
        "https://www.contextworld.com/web/guest/quarterly-industrial-3d-printer-shipments-rebound-amid-continued-record-breaking-entry-level-growth",
      ],
    ],
  ),
  printer(
    "bambu-lab",
    "Bambu Lab",
    "A1 and A1 mini for open-bed printing, P1S and P2S for enclosed CoreXY.",
    [
      [
        "Familiar models",
        "The A1 mini uses a compact 180 mm cube build volume. The A1 offers a 256 mm cube. The P1S and P2S are enclosed machines in the same 256 mm build class.",
      ],
      [
        "Where they fit",
        "Use the open A1 family for compatible day-to-day filaments and choose plate size for your parts. For shrink-prone materials, compare the enclosed model’s material and chamber guidance. Check whether the intended spool and filament are compatible with the relevant AMS unit.",
      ],
      [
        "Software",
        "Start with the exact Bambu Studio printer and nozzle profile. Check device and firmware compatibility separately if you want to send jobs from a third-party slicer.",
      ],
      [
        "How the lineup began",
        "Bambu Lab entered the market in 2022 with the X1. Its P1P adapted the X1 platform to a simpler open machine, and the P1S and P2S continued that family in enclosed form. The A1 family uses a moving bed.",
      ],
    ],
    ["printer-types", "slicer-history", "slicers", "color-bleed", "petg", "asa"],
    [
      ["Bambu Lab · A1 and A1 mini", "https://blog.bambulab.com/best-3d-printer-for-miniatures/"],
      [
        "Bambu Lab · P2S",
        "https://blog.bambulab.com/the-icon-redefined-meet-the-p2s-a-completely-reengineered-version-of-the-ultra-productive-p1-series/",
      ],
      ["Bambu Lab · X1 and P1P history", "https://blog.bambulab.com/a-farewell-to-p1p/"],
    ],
  ),
  printer(
    "creality",
    "Creality",
    "Ender-3 is a widely shipped family of affordable desktop machines.",
    [
      [
        "Familiar models",
        "The open-frame Ender-3 V3 SE has a moving bed and direct-drive extrusion. The enclosed K1C uses CoreXY motion. Creality reports more than four million Ender-3 units shipped across the family.",
      ],
      [
        "Where they fit",
        "Compare a V3 SE for basic PLA/PETG work and accessible hardware with an enclosed model for filaments that benefit from fewer drafts. Older Ender-3 models and newer V3 variants have different extrusion, leveling and firmware setups.",
      ],
      [
        "Software",
        "Select the exact suffix in the printer presets. V3 SE, V3 KE and V3 can require different profiles or hardware instructions.",
      ],
      [
        "What to check on a used Ender",
        "Identify the exact revision and any installed upgrades. A different extruder, probe or mainboard can change which configuration and first-layer procedure apply. Start with a small first-layer patch and check if the measured bed matches the configured area.",
      ],
    ],
    ["printer-types", "slicers", "first-layer", "direct-drive"],
    [
      ["Creality · Ender-3 V3 SE", "https://www.creality.com/products/creality-ender-3-v3-se"],
      ["Creality · Ender-3 series shipments", "https://www.creality.com/products/ender-3-v3-mega"],
      ["Creality · K1C", "https://www.creality.com/products/k1c-3d-printer"],
    ],
  ),
  printer(
    "prusa",
    "Prusa Research",
    "Original Prusa i3 and MK4S, plus enclosed CORE One models.",
    [
      [
        "Familiar models",
        "The Original Prusa MK4S is an open moving-bed printer with a 250 × 210 × 220 mm build volume. CORE One+ is an enclosed CoreXY design. The older MK3S+ remains a familiar i3-style printer.",
      ],
      [
        "Where they fit",
        "Prusa offers assembled machines, kits on selected models and documented upgrade paths. Consider serviceability, the build area and enclosure needs when comparing models.",
      ],
      [
        "Software",
        "PrusaSlicer provides Original Prusa profiles. Verify the nozzle, sheet and filament before slicing, especially if the printer has been upgraded.",
      ],
      [
        "From RepRap to toolchanging",
        "The i3 line grew out of Josef Průša’s RepRap work. The Original Prusa XL illustrates a later design choice with separate tools that can carry their own nozzles and filaments. On the MK4S, the optional MMU instead changes filaments through a shared nozzle.",
      ],
    ],
    ["printer-types", "reprap-history", "slicer-history", "slicers", "multimaterial-history"],
    [
      ["Prusa Research · Model comparison", "https://www.prusa3d.com/en/product/prusa-core-one/"],
      ["Prusa Research · MK4S and i3 lineage", "https://www.prusa3d.com/page/about-us_77/"],
      [
        "Prusa Research · Using different materials on the XL",
        "https://help.prusa3d.com/article/combining-materials-xl_498103",
      ],
    ],
  ),
  printer(
    "elegoo",
    "Elegoo",
    "Neptune moving-bed models and the enclosed Centauri Carbon line.",
    [
      [
        "Familiar models",
        "The Neptune 4 Pro is an open moving-bed printer with a 225 × 225 × 265 mm build volume. The Centauri Carbon 2 Combo is an enclosed CoreXY machine with a filament switching system.",
      ],
      [
        "Where they fit",
        "Compare the Neptune family when accessible hardware or a larger moving bed matters. Compare the Centauri models when you need an enclosed setup. Check the hardware revision before using firmware, cables or spare parts.",
      ],
      [
        "Why a revision matters",
        "The Neptune 4 Pro documentation distinguishes ribbon-cable and USB-C versions. Check the actual connection and the replacement part list before ordering or installing a repair. For larger Neptune models, reserve clearance for the full bed travel.",
      ],
    ],
    ["printer-types", "slicers", "first-layer"],
    [
      ["Elegoo · Neptune 4 Pro", "https://us.elegoo.com/products/elegoo-neptune-4-pro-fdm-3d-printer"],
      ["Elegoo · Centauri Carbon 2 Combo", "https://us.elegoo.com/products/centauri-carbon-2-combo"],
    ],
  ),
  printer(
    "anycubic",
    "Anycubic",
    "Kobra 3 and Kobra S1 illustrate two filament printing layouts.",
    [
      [
        "Familiar models",
        "Kobra 3 is a moving-bed design with a 250 × 250 × 260 mm build volume. The Kobra S1 uses enclosed CoreXY motion with a 250 mm cube build volume. Combo kits include a compatible filament switching system.",
      ],
      [
        "Where they fit",
        "Compare the Kobra 3 for easy access to the build plate and the S1 for an enclosed setup. Automatic feeding can restrict flexible filament, so check the spool system and use the approved direct feeding path when required.",
      ],
      [
        "Filament changing in practice",
        "The Kobra 3 Combo uses ACE Pro to select filament. Anycubic lists TPU for the printer but excludes it from the ACE Pro feed path. When slicing a color job, verify the accessory, profile, assigned slots and purging for the actual spool combination.",
      ],
    ],
    ["printer-types", "slicers", "tpu", "color-bleed"],
    [
      ["Anycubic · Kobra 3 Combo", "https://store.anycubic.com/collections/fdm-printer/products/kobra-3-combo"],
      ["Anycubic · Kobra S1 Combo", "https://store.anycubic.com/products/kobra-s1-combo"],
    ],
  ),
  printer(
    "flashforge",
    "Flashforge",
    "The Adventurer 5M and 5M Pro share a CoreXY platform and quick-release nozzles.",
    [
      [
        "Which models to compare",
        "The Adventurer 5M has an open frame. The 5M Pro ships enclosed and includes filtration and a camera. Flashforge offers an enclosure kit for the standard 5M, and the two machines share the quick-release nozzle format.",
      ],
      [
        "What this means in use",
        "The 5M family is a useful example of enclosure and accessibility choices with similar basic mechanics. Check your intended materials, chamber conditions and compatible nozzle types. Confirm profile availability for the nozzle you actually install.",
      ],
      [
        "Software and service",
        "Flashforge documents Flash Studio Desktop and OrcaSlicer support for the 5M series. Use the model-specific firmware and nozzle assembly instructions.",
      ],
    ],
    ["printer-types", "slicers", "clogged-nozzle", "asa"],
    [
      [
        "Flashforge · Adventurer 5M and 5M Pro comparison",
        "https://www.flashforge.com/blogs/news/adventurer-5m-vs-adventurer-5m-pro",
      ],
    ],
  ),
  printer(
    "sovol",
    "Sovol",
    "The SV06 family illustrates moving-bed designs, while the SV08 uses a moving CoreXY gantry.",
    [
      [
        "Which models to compare",
        "The SV06 is an open moving-bed machine with a direct-drive extruder. The larger SV08 uses CoreXY with a bed fixed in Z and a gantry that adjusts height. Sovol publishes source and hardware documentation for the SV08.",
      ],
      [
        "What this means in use",
        "Allow space in front of and behind a moving bed. For an SV08, check which material and enclosure setup your configuration supports, and follow its gantry and bed calibration sequence.",
      ],
      [
        "Software and service",
        "Sovol’s wiki lists model-specific firmware and slicer configurations. Use the page for your exact variant, especially for configurations shared by other owners.",
      ],
    ],
    ["voron", "printer-types", "slicers", "uneven-first-layer"],
    [
      ["Sovol · SV06 documentation", "https://wiki.sovol3d.com/en/SV06"],
      ["Sovol · SV08 documentation", "https://wiki.sovol3d.com/en/SV08"],
      ["Sovol · SV08 source repository", "https://github.com/Sovol3d/SV08"],
    ],
  ),
  printer(
    "voron",
    "Voron Design",
    "Open-source printer designs include the Trident, V2.4 and Switchwire.",
    [
      [
        "How the designs differ",
        "The Trident uses a fixed CoreXY gantry with a bed that moves in Z. The V2.4 uses a fixed bed and a gantry that moves in Z. Switchwire is a moving-bed design with belt-driven X and Z motion.",
      ],
      [
        "What a build involves",
        "Builders choose a bill of materials and source parts themselves or buy a kit from a separate supplier. Toolhead, probe and electronics choices affect the build. Check the documentation and support terms for your actual kit.",
      ],
      [
        "Why it matters",
        "Voron is a good place to see how kinematics, a rigid frame and a well-tuned profile work together. Benchmarks from one configuration may not transfer to another. Use the build documentation to commission and tune the machine.",
      ],
    ],
    ["corexy", "sovol", "reprap-history", "motion-history", "ringing"],
    [
      ["Voron · Choosing a printer and toolhead", "https://docs.vorondesign.com/hardware.html"],
      ["Voron · Mechanical assembly", "https://docs.vorondesign.com/build/mechanical/"],
    ],
  ),
  printer(
    "qidi",
    "QIDI Tech",
    "Q1 Pro and Plus4 are enclosed printers with active chamber heating.",
    [
      [
        "Which models to compare",
        "The Q1 Pro is a compact enclosed machine. The Plus4 expands the advertised build volume to 305 × 305 × 280 mm. Both illustrate a chamber that the printer can actively heat for compatible materials.",
      ],
      [
        "What this means in use",
        "A controlled chamber helps when a material needs stable conditions to limit shrinkage and splitting. For PLA, use the maker’s guidance on chamber ventilation and cooling. Match the sheet, hotend and nozzle material to the actual spool.",
      ],
      [
        "Service and exact configuration",
        "Use the manufacturer’s documentation for your model, hardware revision and region. Confirm the chamber and hotend configuration against the material data sheet before choosing a profile.",
      ],
    ],
    ["printer-types", "pc", "nylon", "warping", "heat-creep-jam"],
    [
      ["QIDI · Q1 Pro documentation", "https://wiki.qidi3d.com/en/Q1-Pro"],
      ["QIDI · Plus4 specifications", "https://us.qidi3d.com/products/plus4-3d-printer"],
    ],
  ),
  printer(
    "snapmaker",
    "Snapmaker",
    "The U1 changes among separate toolheads for multicolor or compatible multimaterial jobs.",
    [
      [
        "Which models to compare",
        "The U1 is a filament printer with four docked toolheads and a 270 mm cube build volume. The Artisan belongs to an earlier modular line with a different toolhead system and workflow.",
      ],
      [
        "What changes with a toolchanger",
        "Each active tool can keep its own filament loaded. That reduces how much old color has to be pushed out of one nozzle during a change. Tool offsets, standby behavior and priming still affect seam quality and registration.",
      ],
      [
        "Software and materials",
        "Snapmaker provides a U1-specific Orca-based slicer. Follow its supported material combinations and calibrate the tools for a test section before doing a full multimaterial job.",
      ],
    ],
    ["multimaterial-history", "color-bleed", "slicers", "soluble"],
    [
      ["Snapmaker · U1 specifications and model links", "https://www.snapmaker.com/en-US/snapmaker-u1/specs"],
      ["Snapmaker · U1 setup and operation", "https://wiki.snapmaker.com/en/FAQ/u1"],
    ],
  ),
  printer(
    "ultimaker",
    "UltiMaker",
    "The S5 and S8 use swappable print cores and a Cura-based workflow.",
    [
      [
        "Which models to compare",
        "S-series printers such as the S5 and S8 support dual extrusion with swappable print cores. Select the correct core type for the material, diameter and support strategy.",
      ],
      [
        "What this means in use",
        "A second nozzle can print a compatible support material and reduce manual removal on intricate parts. Check the material and core compatibility table and preview the tool changes and their time cost.",
      ],
      [
        "Software and company history",
        "UltiMaker develops Cura, which also supports many other printer profiles. Ultimaker and MakerBot combined in 2022, bringing the Cura ecosystem and MakerBot’s education-oriented printers into the same company.",
      ],
    ],
    ["makerbot-history", "slicer-history", "soluble", "rough-supports"],
    [
      ["UltiMaker · S5", "https://ultimaker.com/3d-printers/s-series/ultimaker-s5/"],
      ["UltiMaker · S8", "https://ultimaker.com/3d-printers/s-series/ultimaker-s8/"],
      ["UltiMaker · 2022 recap", "https://ultimaker.com/learn/2022-year-in-review-big-changes-for-ultimaker-in-2022/"],
    ],
  ),
  printer(
    "raise3d",
    "Raise3D",
    "The E2 uses independent dual extruders, and Pro3 Plus offers extra height.",
    [
      [
        "Which models to compare",
        "On the E2, two independent carriages allow separate nozzles, duplication and mirroring when the job fits those modes. Pro3 Plus offers a taller enclosure and separate published usable widths for single- and dual-nozzle jobs.",
      ],
      [
        "What this means in use",
        "When comparing dual-extrusion machines, check the build area for the chosen mode and the compatibility of both materials. Two nozzles introduce alignment and idle-nozzle behavior that matter around a seam or interface.",
      ],
      [
        "Software",
        "Raise3D documents profiles and dual-extruder workflows through ideaMaker. Preview both tools and confirm the usable bed layout before printing multiple parts at once.",
      ],
    ],
    ["multimaterial-history", "printer-types", "orientation", "slicers"],
    [
      ["Raise3D · E2 and IDEX", "https://www.raise3d.com/e2/"],
      ["Raise3D · Pro3 series", "https://www.raise3d.com/pro3-series/"],
    ],
  ),
  printer(
    "stratasys",
    "Stratasys",
    "Scott Crump’s early FDM work led to industrial systems such as Fortus and F3300.",
    [
      [
        "Role in the history",
        "Stratasys was the original assignee of Scott Crump’s 1989 extrusion-printing patent application. It commercialized the process under the name Fused Deposition Modeling.",
      ],
      [
        "Which machines to know",
        "Fortus 450mc and F3300 are examples of industrial FDM systems. Their documentation specifies supported materials, tips and operating workflows for the platform.",
      ],
      [
        "What to compare",
        "Industrial workflows can prioritize process repeatability, compatible support removal, traceable material and service procedures. Use the manufacturer’s approved profiles and compare the complete workflow with what a desktop job needs.",
      ],
    ],
    ["fdm-history", "printer-types", "fff", "soluble"],
    [
      ["Scott Crump · US5121329A", "https://patents.google.com/patent/US5121329A/en"],
      ["Stratasys · Fortus 450mc", "https://support.stratasys.com/en/Printers/FDM/Fortus-450mc"],
      ["Stratasys · F3300", "https://support.stratasys.com/en/Printers/FDM/F3300"],
    ],
  ),
];
