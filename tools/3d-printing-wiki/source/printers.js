import { reference } from "./references.js";

const printer = (...args) => reference("Printers", ...args);
const timeline = (text, rows, note) => ({ text, columns: ["Year", "Milestone"], rows, note });

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
      [
        "Three ways makers work",
        "Some makers ship closed, tightly integrated products. Others publish design files so owners can repair and modify the machine. Community projects such as Voron publish the design and leave the build to you. Look at who supplies spare parts, firmware sources and documentation before you buy.",
      ],
    ],
    [
      "bambu-lab",
      "prusa",
      "creality",
      "qidi",
      "voron",
      "lulzbot",
      "e3d",
      "multimaterial-history",
      "cut-prints",
      "slicers",
    ],
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
        "A drone team builds a printer",
        "Bambu Lab was founded in Shenzhen in 2020. Its CEO, Dr. Ye Tao, previously led DJI’s consumer drone department, and most of the founding team also came from DJI. They treated the printer as a consumer product: the X1 combined fast CoreXY motion, automatic calibration, a camera and the AMS filament changer in one machine. Its Kickstarter in 2022 raised about US$7 million.",
      ],
      [
        "How the lineup grew",
        "The P1P adapted the X1 platform to a simpler open machine, and the P1S and P2S continued that family in enclosed form. The A1 and A1 mini brought the AMS Lite to moving-bed printers. The H2D added a second nozzle for two materials without a full purge between them.",
      ],
      [
        "Software and models",
        "Bambu Studio is a fork of PrusaSlicer, which descends from Slic3r. OrcaSlicer began in 2022 as a community fork of Bambu Studio and now supports many other brands. MakerWorld, announced in 2023, pairs each model with pre-sliced print profiles.",
      ],
      [
        "Changes owners noticed",
        "In January 2025 a firmware update put actions such as starting a print over the network behind an authorization system. On updated firmware, third-party tools go through the Bambu Connect app, or the printer can run a LAN-only Developer Mode. In 2024, early A1 printers were recalled because a bent heatbed cable could short. On a used A1, check that the replacement was fitted.",
      ],
      [
        "Timeline",
        timeline(
          "Key dates for Bambu Lab’s printers and software.",
          [
            ["2020", "Founded in Shenzhen by former DJI engineers"],
            ["2022", "X1 on Kickstarter in May, P1P in November, first Bambu Studio release"],
            ["2023", "P1S, A1 mini and A1 released; MakerWorld announced"],
            ["2024", "A1 heatbed cable recall in the US and Canada"],
            ["2025", "Authorization firmware in January, H2D in March, P2S in October"],
          ],
          "Release dates follow the maker’s announcements. Regional availability can differ.",
        ),
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
      ["Bambu Lab · The team behind the X1", "https://blog.bambulab.com/the-team-behind-bambu-lab-x1"],
      ["Bambu Lab · MakerWorld announcement", "https://blog.bambulab.com/makerworld-3d-model-platform"],
      [
        "Bambu Lab · Authorization control system",
        "https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2",
      ],
      [
        "CPSC · A1 recall",
        "https://www.cpsc.gov/Recalls/2024/Bambu-Lab-Recalls-A1-3D-Printers-Due-to-Electric-Shock-and-Fire-Hazards",
      ],
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
      [
        "From a big cheap bed to the Ender-3",
        "Four founders started Creality in Shenzhen in 2014. The CR-10 of 2016 offered a large build plate at a low price. The Ender-3 followed in 2018 and became one of the most modified printers ever sold. That year Creality published its design files and firmware on GitHub, and the Ender-3 became the first Chinese printer certified by the Open Source Hardware Association.",
      ],
      [
        "Why upgrades are everywhere",
        "Open files, a simple aluminium-extrusion frame and a huge owner base made the Ender-3 a platform for printed and bought upgrades: new extruders, probes, boards and firmware such as Klipper. That is why two Enders of the same name can behave very differently.",
      ],
      [
        "Timeline",
        timeline(
          "Key dates for Creality’s FDM printers.",
          [
            ["2014", "Founded in Shenzhen"],
            ["2016", "CR-10 large-format printer"],
            ["2018", "Ender-3 released; design files and firmware published"],
            ["2020", "Creality Cloud platform and Ender-3 V2"],
            ["2023", "K1 fast enclosed CoreXY printer"],
            ["2026", "Listed on the Hong Kong Stock Exchange in May"],
          ],
          "In its 2025 listing documents, Creality reported 4.4 million printers shipped from 2020 to 2024.",
        ),
      ],
    ],
    ["printer-types", "slicers", "first-layer", "direct-drive", "reprap-history"],
    [
      ["Creality · Ender-3 V3 SE", "https://www.creality.com/products/creality-ender-3-v3-se"],
      ["Creality · Ender-3 series shipments", "https://www.creality.com/products/ender-3-v3-mega"],
      ["Creality · K1C", "https://www.creality.com/products/k1c-3d-printer"],
      ["Creality · Company milestones", "https://www.creality.com/about"],
      ["Creality · Ender-3 open-source files", "https://github.com/Creality3DPrinting/Ender-3"],
      [
        "Creality · Ender series open source",
        "https://www.creality.com/blog/creality-releases-open-source-code-for-ender-series-introduces-upgraded-features-and-special-offers",
      ],
      [
        "3D Printing Industry · Creality IPO",
        "https://3dprintingindustry.com/news/oversubscribed-creality-ipo-raises-177m-valuing-desktop-3d-printing-company-at-1-12-billion-252037/",
      ],
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
      [
        "A RepRap developer’s company",
        "Josef Průša was a core RepRap developer, and his Prusa i3 design of 2012 became one of the most copied printers in the world. He founded Prusa Research in Prague the same year. The MK2 of 2016 added mesh bed leveling and automatic skew correction, rare on hobby printers then. PrusaSlicer grew from Slic3r, and Printables is its model site.",
      ],
      [
        "Made in Prague",
        "Prusa builds its printers in Prague, has made Prusament filament there since 2018 and prints many plastic parts for its machines on its own print farm. Each Prusament spool has a code that shows its measured diameter.",
      ],
      [
        "Rethinking open hardware",
        "In 2023 Josef Průša wrote that cheap copies and closed forks were testing the open-source model. Firmware and PrusaSlicer stay open source. Later designs, such as the CORE One frame, use Prusa’s Open Community License, which limits commercial use.",
      ],
      [
        "Timeline",
        timeline(
          "Key dates for Prusa Research.",
          [
            ["2012", "Prusa i3 design and the company founded in Prague"],
            ["2016", "Original Prusa i3 MK2 with mesh bed leveling"],
            ["2018", "Prusament filament made in-house"],
            ["2019", "PrusaSlicer 2.0 and the MINI; a large-format XL first named"],
            ["2021", "XL shown as a five-tool toolchanger at Formnext"],
            ["2023", "MK4 with the Nextruder and MMU3"],
            ["2024", "CORE One enclosed CoreXY printer announced at Formnext"],
          ],
          "PrusaPrinters.org became Printables.com in 2022.",
        ),
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
      [
        "Prusa Research · Launching Prusament",
        "https://blog.prusa3d.com/launching-prusament-the-best-filament-that-you-can-inspect-yourself_8810/",
      ],
      ["Prusa Research · Announcing the MK4", "https://blog.prusa3d.com/announcing-original-prusa-mk4_76585/"],
      [
        "Prusa Research · Introducing the CORE One",
        "https://blog.prusa3d.com/introducing-prusa-core-one-fully-enclosed-corexy-3d-printer-with-active-temperature-control_105477/",
      ],
      [
        "Josef Průša · The state of open source in 3D printing",
        "https://blog.prusa3d.com/the-state-of-open-source-in-3d-printing-in-2023_76659/",
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
      [
        "From electronics kits to resin and filament",
        "Elegoo was founded in Shenzhen in 2015 and started out with electronics kits for makers. Its Mars resin printer of 2019 made it a major name in resin printing. The Neptune series took it into filament printing, and the Centauri Carbon, its first enclosed CoreXY machine, opened for orders in 2025.",
      ],
      [
        "Timeline",
        timeline("Key dates for Elegoo.", [
          ["2015", "Founded in Shenzhen, selling electronics kits"],
          ["2019", "Mars LCD resin printer"],
          ["2025", "Centauri Carbon pre-orders open in February"],
          ["2025", "DJI becomes a shareholder in Elegoo’s parent company in November"],
        ]),
      ],
    ],
    ["printer-types", "slicers", "first-layer"],
    [
      ["Elegoo · Neptune 4 Pro", "https://us.elegoo.com/products/elegoo-neptune-4-pro-fdm-3d-printer"],
      ["Elegoo · Centauri Carbon 2 Combo", "https://us.elegoo.com/products/centauri-carbon-2-combo"],
      ["Elegoo · About", "https://www.elegoo.com/pages/about-us"],
      [
        "Elegoo · Ten years",
        "https://elegoo.com/blogs/news/create-the-future-elegoo-celebrates-10-years-and-prepares-new-offerings-for-global-3d-printing-community",
      ],
      [
        "TechNode · DJI invests in Elegoo",
        "https://technode.com/2025/11/20/dji-becomes-shareholder-in-consumer-3d-printer-maker-elegoo/",
      ],
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
      [
        "From a delta kit to multicolor",
        "Anycubic was founded in Shenzhen in 2015. Its first printer was the Kossel, a delta kit. The i3 Mega made it a popular budget brand, and the Photon of 2017 was an early low-cost LCD resin printer. The Vyper added automatic leveling, and the Kobra 3 Combo and Kobra S1 brought filament switching to its filament printers.",
      ],
      [
        "Timeline",
        timeline("Key dates from Anycubic’s own product history.", [
          ["2015", "Founded; Kossel delta printer"],
          ["2016", "i3 Mega"],
          ["2017", "Photon LCD resin printer"],
          ["2021", "Vyper with automatic leveling"],
          ["2024", "Kobra 3 Combo with ACE Pro"],
          ["2025", "Kobra S1 Combo enclosed CoreXY printer in January"],
        ]),
      ],
    ],
    ["printer-types", "slicers", "tpu", "color-bleed"],
    [
      ["Anycubic · Kobra 3 Combo", "https://store.anycubic.com/collections/fdm-printer/products/kobra-3-combo"],
      ["Anycubic · Kobra S1 Combo", "https://store.anycubic.com/products/kobra-s1-combo"],
      ["Anycubic · About and history", "https://anycubic.com/about"],
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
      [
        "One of China’s early printer makers",
        "Zhejiang Flashforge was founded in 2011 and is based in Jinhua, Zhejiang. Its Creator and Adventurer lines came before the 5M. The Adventurer 5M series moved to CoreXY motion and Klipper firmware, and in January 2024 Flashforge published its Klipper source on GitHub under the GPL.",
      ],
      [
        "Timeline",
        timeline("Key dates for Flashforge.", [
          ["2011", "Founded in Zhejiang"],
          ["2023", "Adventurer 5M and 5M Pro CoreXY printers announced"],
          ["2024", "Klipper source for the 5M series published"],
        ]),
      ],
    ],
    ["printer-types", "slicers", "clogged-nozzle", "asa"],
    [
      [
        "Flashforge · Adventurer 5M and 5M Pro comparison",
        "https://www.flashforge.com/blogs/news/adventurer-5m-vs-adventurer-5m-pro",
      ],
      ["Flashforge · About", "https://www.flashforge.com/pages/about-us"],
      ["Flashforge · 5M series Klipper source", "https://github.com/FlashForge/AD5M_Series_Klipper"],
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
      [
        "Building on open designs",
        "Sovol, founded in 2018, openly builds on community designs. The SV06 of 2022 follows the open Original Prusa i3 MK3S+ layout. The SV08 of 2024 is a factory-built printer based on the Voron 2.4 that runs Klipper, with its mechanical and electrical files on GitHub. Sovol also set up a donation program for the Voron team.",
      ],
      [
        "Timeline",
        timeline("Key dates for Sovol.", [
          ["2018", "Founded"],
          ["2022", "SV06, based on the open Prusa i3 design"],
          ["2023", "SV06 Plus with a larger bed"],
          ["2024", "SV08 based on the Voron 2.4, with its source on GitHub"],
        ]),
      ],
    ],
    ["voron", "printer-types", "slicers", "uneven-first-layer"],
    [
      ["Sovol · SV06 documentation", "https://wiki.sovol3d.com/en/SV06"],
      ["Sovol · SV08 documentation", "https://wiki.sovol3d.com/en/SV08"],
      ["Sovol · SV08 source repository", "https://github.com/Sovol3d/SV08"],
      ["Sovol · About", "https://www.sovol3d.com/pages/about-us-1"],
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
      [
        "One builder, then a community",
        "Maks Zolin wanted a faster, quieter printer than the one he could buy, so he designed his own. In 2015 he sold 18 kits through his company MZBot. “Voron” is Russian for crow or raven, and the first printers were black. When MZBot wound down, he opened the designs and invited collaborators, who became Voron Design.",
      ],
      [
        "The serial number tradition",
        "Builders who finish a printer can submit it for a serial number, a custom that started with the first kits. By 2025 more than 15,000 Vorons had been built. Voron printers run Klipper, and many printers sold today borrow from the Voron designs.",
      ],
      [
        "Timeline",
        timeline("Key dates for Voron Design.", [
          ["2015", "First prototype and 18 kits"],
          ["2016", "Voron 1 design released"],
          ["2020", "V2.4 and Switchwire"],
          ["2021", "Trident and V0.1"],
          ["2023", "V0.2"],
        ]),
      ],
    ],
    ["corexy", "sovol", "reprap-history", "motion-history", "ringing"],
    [
      ["Voron · Choosing a printer and toolhead", "https://docs.vorondesign.com/hardware.html"],
      ["Voron · Mechanical assembly", "https://docs.vorondesign.com/build/mechanical/"],
      [
        "Make: · The story of Voron Design",
        "https://makezine.com/article/digital-fabrication/3d-printing-workshop/the-story-of-voron-design/",
      ],
      ["Wikipedia · Voron Design", "https://en.wikipedia.org/wiki/Voron_Design"],
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
      [
        "Heated chambers for less",
        "QIDI Tech was founded in 2014 in Rui’an, Zhejiang, and was early to sell directly through Amazon. With the X-Plus 3 and X-Max 3 of 2023 it moved to Klipper and an actively heated chamber at a lower price than earlier heated-chamber printers. The Plus4 raised the chamber limit to 65 °C.",
      ],
      [
        "Timeline",
        timeline("Key dates for QIDI Tech.", [
          ["2014", "Founded in Rui’an, Zhejiang"],
          ["2023", "X-Plus 3 and X-Max 3 with Klipper and heated chambers"],
          ["2024", "Q1 Pro, then the Plus4 in September"],
          ["2025", "Max4 shown at Formnext"],
        ]),
      ],
    ],
    ["printer-types", "pc", "nylon", "warping", "heat-creep-jam"],
    [
      ["QIDI · Q1 Pro documentation", "https://wiki.qidi3d.com/en/Q1-Pro"],
      ["QIDI · Plus4 specifications", "https://us.qidi3d.com/products/plus4-3d-printer"],
      ["QIDI · About", "https://wiki.qidi3d.com/en/others/aboutus"],
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
      [
        "A crowdfunding story",
        "Snapmaker was founded in Shenzhen in 2016. Its first machine, the Snapmaker Original of 2017, printed, laser-engraved and carved with swappable heads. Snapmaker 2.0 raised US$7.85 million on Kickstarter in 2019, a record for 3D printing then. The U1 campaign in 2025 raised about US$20.6 million from more than 20,000 backers, the most for any 3D printer on Kickstarter.",
      ],
      [
        "Timeline",
        timeline("Key dates for Snapmaker.", [
          ["2016", "Founded in Shenzhen"],
          ["2017", "Snapmaker Original 3-in-1 on Kickstarter"],
          ["2019", "Snapmaker 2.0 modular machines"],
          ["2022", "J1 IDEX printer and Artisan 3-in-1 announced"],
          ["2025", "U1 toolchanger; Kickstarter orders shipped by December"],
        ]),
      ],
    ],
    ["multimaterial-history", "color-bleed", "slicers", "soluble"],
    [
      ["Snapmaker · U1 specifications and model links", "https://www.snapmaker.com/en-US/snapmaker-u1/specs"],
      ["Snapmaker · U1 setup and operation", "https://wiki.snapmaker.com/en/FAQ/u1"],
      ["Snapmaker · About and campaigns", "https://www.snapmaker.com/about-us"],
      [
        "3D Printing Industry · U1 Kickstarter record",
        "https://3dprintingindustry.com/news/snapmaker-u1-becomes-most-funded-3d-printer-in-kickstarter-history-244988/",
      ],
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
      [
        "Born in a Dutch fab lab",
        "Ultimaker grew out of RepRap Darwin build workshops at ProtoSpace in Utrecht. Martijn Elserman, Erik de Bruijn and Siert Wijnia founded it in 2011 and shipped the Ultimaker kit that year, later called the Ultimaker Original. Cura began as David Braam’s open-source slicer and became the company’s main software after he joined.",
      ],
      [
        "Timeline",
        timeline("Key dates for UltiMaker.", [
          ["2011", "Founded; Ultimaker kit released in March"],
          ["2013", "Ultimaker 2, an assembled printer"],
          ["2016", "Ultimaker 3 with dual extrusion"],
          ["2022", "Merged with MakerBot; the company becomes UltiMaker"],
        ]),
      ],
    ],
    ["makerbot-history", "slicer-history", "reprap-history", "soluble", "rough-supports"],
    [
      ["UltiMaker · S5", "https://ultimaker.com/3d-printers/s-series/ultimaker-s5/"],
      ["UltiMaker · S8", "https://ultimaker.com/3d-printers/s-series/ultimaker-s8/"],
      ["UltiMaker · 2022 recap", "https://ultimaker.com/learn/2022-year-in-review-big-changes-for-ultimaker-in-2022/"],
      ["UltiMaker · Ten years", "https://ultimaker.com/learn/ultimaker-turns-10/"],
      ["Wikipedia · Ultimaker", "https://en.wikipedia.org/wiki/Ultimaker"],
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
      [
        "From Kickstarter to the workshop",
        "Raise3D was founded in 2015 and introduced itself with a Kickstarter for the N series, which reached its US$50,000 goal in 41 minutes. It then wrote its own slicer, ideaMaker, and moved toward professional and factory users. It is based in Irvine, California, with offices in Europe and Shanghai.",
      ],
      [
        "Timeline",
        timeline("Key dates for Raise3D.", [
          ["2015", "Founded; N series on Kickstarter"],
          ["2016", "ideaMaker slicer"],
          ["2018", "Pro2 series"],
          ["2021", "Pro3 series"],
          ["2025", "First SLS printer, the RMS220"],
        ]),
      ],
    ],
    ["multimaterial-history", "printer-types", "orientation", "slicers"],
    [
      ["Raise3D · E2 and IDEX", "https://www.raise3d.com/e2/"],
      ["Raise3D · Pro3 series", "https://www.raise3d.com/pro3-series/"],
      ["Raise3D · About and milestones", "https://raise3d.com/about-us/"],
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
      [
        "A glue gun and a toy frog",
        "In 1988 Scott Crump made a toy frog for his daughter with a hot glue gun and saw a way to build objects layer by layer. He and Lisa Crump founded Stratasys in Eden Prairie, Minnesota, in 1989. Because “FDM” is a Stratasys trademark, the RepRap community named the same idea fused filament fabrication (FFF).",
      ],
      [
        "Timeline",
        timeline("Key dates for Stratasys.", [
          ["1989", "Founded in Eden Prairie, Minnesota"],
          ["1992", "First product, the 3D Modeler"],
          ["1994", "Listed on Nasdaq"],
          ["2012", "Merged with Objet, maker of PolyJet printers"],
          ["2013", "Acquired MakerBot"],
          ["2022", "MakerBot merged with Ultimaker"],
        ]),
      ],
    ],
    ["fdm-history", "makerbot-history", "printer-types", "fff", "soluble"],
    [
      ["Scott Crump · US5121329A", "https://patents.google.com/patent/US5121329A/en"],
      ["Stratasys · Fortus 450mc", "https://support.stratasys.com/en/Printers/FDM/Fortus-450mc"],
      ["Stratasys · F3300", "https://support.stratasys.com/en/Printers/FDM/F3300"],
      ["Stratasys · About", "https://www.stratasys.com/en/about-us/"],
      ["Wikipedia · Stratasys", "https://en.wikipedia.org/wiki/Stratasys"],
    ],
  ),
  printer(
    "lulzbot",
    "LulzBot",
    "TAZ and Mini printers built as free software and open hardware.",
    [
      [
        "A fully open commercial printer",
        "Jeff Moe founded Aleph Objects in Loveland, Colorado, in 2011 to make LulzBot printers. Each machine shipped with its design files, firmware and documentation published under free licenses, so owners could repair, modify or build one themselves.",
      ],
      [
        "Certified for freedom",
        "In 2012 the LulzBot AO-100 became the first device to earn the Free Software Foundation’s Respects Your Freedom certification. Later models such as the TAZ 3 earned it too.",
      ],
      [
        "A new owner",
        "After heavy layoffs, Aleph Objects sold its assets in 2019 to Fargo Additive Manufacturing Equipment 3D (FAME 3D), which continues the LulzBot line. Check which owner made a used machine before ordering parts or firmware.",
      ],
      [
        "Timeline",
        timeline("Key dates for LulzBot.", [
          ["2011", "Aleph Objects founded in Loveland, Colorado"],
          ["2012", "AO-100 earns the FSF’s Respects Your Freedom certification"],
          ["2014", "TAZ 3 certified"],
          ["2019", "Assets bought by FAME 3D"],
        ]),
      ],
    ],
    ["reprap-history", "fdm-history", "printer-types", "slicers"],
    [
      [
        "FSF · The LulzBot AO-100 is certified",
        "https://www.fsf.org/bulletin/2012/fall/lulzbot-ao-100-3d-printer-is-certifiably-fun",
      ],
      [
        "LulzBot · Interview with founder Jeff Moe",
        "https://lulzbot.com/learn/interview-with-aleph-objects-inc-founder-slash-ceo-jeff-moe",
      ],
      ["Wikipedia · Aleph Objects", "https://en.wikipedia.org/wiki/Aleph_Objects"],
    ],
  ),
  printer(
    "e3d",
    "E3D",
    "The V6 hotend, Revo quick-change nozzles and the ToolChanger research platform.",
    [
      [
        "Two teachers and a hotend",
        "E3D started in 2012 in a bedroom on the Isle of Wight. Two teachers who owned one of the first Mendel90 printers machined their first hotend, the V4, with their school’s tools, and the first batch sold out within 48 hours.",
      ],
      [
        "Why the V6 matters",
        "The all-metal V6 of 2014 became a reference hotend. Prusa fitted it to the i3 MK2, and many printers, mounts and nozzles still follow its pattern. A “V6” nozzle is made to the thread and length that hotend uses.",
      ],
      [
        "Later ideas",
        "The Titan and Hemera extruders, hardened Nozzle X and ObXidian nozzles, and the Revo system, whose nozzles change by hand without hot tightening, followed. The ToolChanger of 2019 was a research platform for swapping whole toolheads and has since been discontinued.",
      ],
      [
        "Timeline",
        timeline("Key dates for E3D.", [
          ["2012", "Founded; V4 hotend"],
          ["2014", "V6 hotend"],
          ["2016", "Titan extruder; the V6 ships on the Prusa i3 MK2"],
          ["2019", "ToolChanger research platform"],
          ["2020", "Hemera extruder"],
          ["2021", "RapidChange Revo"],
        ]),
      ],
    ],
    ["hotend", "nozzle-guide", "clogged-nozzle", "direct-drive", "multimaterial-history", "prusa"],
    [["E3D · About and history", "https://e3d-online.com/pages/about-us"]],
  ),
];
