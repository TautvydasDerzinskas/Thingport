import { reference } from "./references.js";

const milestone = (...args) => reference("History", ...args);

export const history = [
  milestone(
    "fdm-history",
    "FDM through the decades",
    "From early industrial extrusion to open desktop printers and automated workflows.",
    [
      [
        "1989–1992 · Early extrusion printing",
        "Scott Crump’s U.S. patent application described dispensing material in layers to form an object. It was filed in 1989 and granted in 1992, with Stratasys as the original assignee. Fused Deposition Modeling is the name Stratasys uses. The open desktop community often calls the process fused filament fabrication, or FFF.",
      ],
      [
        "2000s · RepRap",
        "Adrian Bowyer’s open design project aimed to make desktop printers more accessible and let them print many of their own components. The Science Museum Group holds a Darwin machine made in Bath in 2007 by Bowyer and Ed Sells.",
      ],
      [
        "2010s · Desktop growth",
        "RepRap-style kits and i3-style printers helped spread the process among hobbyists, educators and makers. Printers still combined printed pieces with purchased components such as motors, electronics and bearings.",
      ],
      [
        "2020s · Integration",
        "Motion tuning, repeatable first-layer sensing, enclosed CoreXY machines and automated filament systems became common across many desktop lines. Finish, strength and reliability still depend on orientation, material and a suitable profile.",
      ],
    ],
    ["fff", "stratasys", "reprap-history", "makerbot-history", "motion-history"],
    [
      ["Scott Crump · US5121329A", "https://patents.google.com/patent/US5121329A/en"],
      [
        "Science Museum Group · Darwin RepRap",
        "https://collection.sciencemuseumgroup.org.uk/objects/co8357315/darwin-reprap-self-replicating-3d-printer-printer",
      ],
      [
        "Adrian Bowyer et al. · RepRap project paper",
        "https://www.cambridge.org/core/journals/robotica/article/reprap-the-replicating-rapid-prototyper/5979FD7B0C066CBCE43EEAD869E871AA",
      ],
    ],
  ),
  milestone(
    "reprap-history",
    "RepRap, Darwin and the road to the i3",
    "A printer that could make many of its own parts helped bring extrusion printing to workbenches.",
    [
      [
        "A printer you could build",
        "Adrian Bowyer’s RepRap project at the University of Bath released designs and software for a printer that could reproduce many of its plastic components. Builders supplied the motors, electronics, fasteners and other hardware separately.",
      ],
      [
        "From Darwin to Mendel",
        "The Science Museum Group holds a Darwin built in Bath in 2007 by Bowyer and Ed Sells. The RepRap project’s 2011 paper describes Darwin and its successor Mendel. In 2012, Josef Průša introduced his Prusa Mendel i3 design.",
      ],
      [
        "A design pattern that spread",
        "The i3 arrangement put a vertical frame over a moving build plate. It became a recognizable template that other builders and manufacturers could adapt. A familiar shape is a clue to the motion layout, while profiles, parts and electronics still depend on the model.",
      ],
    ],
    ["fdm-history", "prusa", "creality", "voron", "printer-types"],
    [
      [
        "Science Museum Group · Darwin RepRap",
        "https://collection.sciencemuseumgroup.org.uk/objects/co8357315/darwin-reprap-self-replicating-3d-printer-printer",
      ],
      [
        "RepRap project paper",
        "https://www.cambridge.org/core/journals/robotica/article/reprap-the-replicating-rapid-prototyper/5979FD7B0C066CBCE43EEAD869E871AA",
      ],
      ["Josef Průša · Early Prusa designs", "https://blog.prusa3d.com/celebrating-10-years-of-prusa-research_68570/"],
    ],
  ),
  milestone(
    "makerbot-history",
    "The Cupcake CNC and early desktop kits",
    "MakerBot’s 2009 kit shows how hobbyists learned to build and run early desktop machines.",
    [
      [
        "A desktop kit from a hackerspace",
        "MakerBot’s Cupcake CNC was released in 2009. The Powerhouse Museum’s example comes from the first release. Its kit and published instructions made assembly part of the experience.",
      ],
      [
        "How the software worked",
        "MakerBot’s own instructions sent users to Skeinforge to turn STL geometry into G-code and to ReplicatorG to send jobs to the machine. Modern slicers and printer apps often integrate those roles.",
      ],
      [
        "What changed",
        "MakerBot followed the Cupcake with the Thing-O-Matic and the Replicator line. In 2022 MakerBot and Ultimaker combined as UltiMaker, bringing two separate strands of early desktop printing under one company.",
      ],
    ],
    ["reprap-history", "ultimaker", "slicer-history", "gcode"],
    [
      [
        "Powerhouse Museum · Cupcake CNC",
        "https://artsandculture.google.com/asset/cupcake-cnc-3d-printer-makerbot-industries/agFr3MaWv7HOYg",
      ],
      ["MakerBot · Cupcake kit docs", "https://makerbot.wikidot.com/cupcake"],
      [
        "UltiMaker · 2022 company recap",
        "https://ultimaker.com/learn/2022-year-in-review-big-changes-for-ultimaker-in-2022/",
      ],
    ],
  ),
  milestone(
    "slicer-history",
    "How desktop slicers developed",
    "From early community tools to Slic3r, PrusaSlicer, Bambu Studio and OrcaSlicer.",
    [
      [
        "2011 · Slic3r",
        "Alessandro Ranellucci began Slic3r in 2011. An open slicer let printer builders and users experiment with how geometry became extrusion paths, from support and infill to multiple materials.",
      ],
      [
        "2019 · PrusaSlicer",
        "Prusa Research built its Slic3r Prusa Edition on that work and renamed it PrusaSlicer with the 2.0 release. Cura developed as a separate open-source project from Ultimaker.",
      ],
      [
        "The family tree keeps branching",
        "Bambu Studio forked from PrusaSlicer, and OrcaSlicer began with Bambu Studio as its base, drawing on ideas from several slicers. Related control names can look familiar across applications. Check your specific slicer and profile for what each control does.",
      ],
    ],
    ["slicers", "slicer", "prusa", "bambu-lab", "ultimaker"],
    [
      ["Slic3r · Project history", "https://slic3r.org/about/"],
      ["Prusa Research · PrusaSlicer 2.0 release", "https://blog.prusa3d.com/prusaslicer-2-release_30008/"],
      ["UltiMaker · Cura source", "https://github.com/Ultimaker/Cura"],
      ["OrcaSlicer · Project acknowledgements", "https://github.com/OrcaSlicer/OrcaSlicer#acknowledgements"],
    ],
  ),
  milestone(
    "benchy-history",
    "Why there’s a little boat on so many build plates",
    "Creative Tools released 3DBenchy in April 2015 as a compact test of several difficult features.",
    [
      [
        "What the shape tests",
        "The hull, cabin, roof and chimney put curves, holes, overhangs, bridging and narrow layers into one familiar print. Daniel Norée designed the boat at Creative Tools and the team published it on April 9, 2015.",
      ],
      [
        "Make the comparison useful",
        "Compare two boats with the same model, material and orientation. Record the profile and which parameter changed. Inspect a particular feature, such as the cabin bridges or bow overhang, before changing anything else.",
      ],
      [
        "The hull line is a clue",
        "A line near the deck can come from changes in geometry, layer time, temperature or how adjacent material cools. Test a simple tower if you also see repeated horizontal ridges at unrelated heights.",
      ],
    ],
    ["fdm-history", "gloss-bands", "z-banding", "bridging-guide", "tuning"],
    [
      [
        "3DBenchy · Original story and development",
        "https://www.3dbenchy.com/3dbenchy-a-small-giant-in-the-world-of-3d-printing/",
      ],
      ["Prusa Research · The Benchy hull line", "https://help.prusa3d.com/article/the-benchy-hull-line_124745"],
    ],
  ),
  milestone(
    "3mf-history",
    "How 3MF made print files more descriptive",
    "The first 3MF core specification arrived in 2015 with a way to carry units and several objects together.",
    [
      [
        "Why grow beyond STL",
        "STL represents triangle surfaces and leaves unit assumptions to the importer. That can turn a usable millimeter-sized part into the wrong size downstream, and users often needed extra files to describe the assembly.",
      ],
      [
        "What 3MF added",
        "The 3MF Consortium published its first core specification in 2015. A 3MF package can describe units, multiple objects and how they are placed. Extensions can carry additional manufacturing data.",
      ],
      [
        "Why two 3MF files can behave differently",
        "A CAD export can be a model package, while a slicer project can include app-specific profiles or settings. Before printing a shared project, verify its printer, nozzle and material assignments and slice for your own setup.",
      ],
    ],
    ["stl-3mf", "slicers", "first-print", "cad"],
    [
      ["3MF Consortium · Mission and format history", "https://3mf.io/3mf-mission/"],
      ["3MF Consortium · Core specification", "https://3mf.io/specification/"],
    ],
  ),
  milestone(
    "motion-history",
    "How printers learned to compensate for vibration",
    "Modern firmware can measure or model vibration and adjust motion commands to reduce visible echoes.",
    [
      [
        "Why speed exposed a problem",
        "A moving head or bed can ring when it changes direction. That mechanical vibration leaves echoes beside raised features. Heavier parts and a flexible frame change which frequencies are most visible.",
      ],
      [
        "Measure, then shape",
        "Open firmware such as Klipper documents test prints and accelerometer-based measurement. An input shaper modifies the timing of motion commands to reduce excitation near a measured resonance.",
      ],
      [
        "There is still a trade-off",
        "Aggressive smoothing can round fine features. Print a comparison and check detail as well as ringing. Belt or frame problems still call for mechanical diagnosis.",
      ],
    ],
    ["input-shaping", "ringing", "z-banding", "voron", "bambu-lab"],
    [
      ["Klipper · Measuring resonances", "https://www.klipper3d.org/Measuring_Resonances.html"],
      ["Klipper · Resonance compensation", "https://www.klipper3d.org/Resonance_Compensation.html"],
    ],
  ),
  milestone(
    "multimaterial-history",
    "From swapping filament to swapping toolheads",
    "A shared nozzle, independent carriage and toolchanger each solve a different part of the multicolor problem.",
    [
      [
        "A shared nozzle",
        "Spool systems such as Prusa MMU feed different filaments into the same hotend. Each switch replaces some material still inside the melt zone, which is why purge volume can vary by color transition.",
      ],
      [
        "An independent carriage",
        "An IDEX design such as the Raise3D E2 has two independently moving carriages. It can park one nozzle when the other prints and, with suitable models and layout, duplicate or mirror a part.",
      ],
      [
        "Docked tools",
        "Printers such as the Original Prusa XL and Snapmaker U1 can pick up separate toolheads. Keeping materials in different nozzles avoids flushing one color out of the same nozzle at every switch. Priming, ooze control and tool alignment still matter.",
      ],
    ],
    ["color-bleed", "soluble", "prusa", "raise3d", "snapmaker"],
    [
      ["Prusa Research · MMU purge volumes", "https://help.prusa3d.com/article/purging-volumes-mmu_125097"],
      [
        "Prusa Research · Combining materials on the XL",
        "https://help.prusa3d.com/article/combining-materials-xl_498103",
      ],
      ["Raise3D · E2 independent dual extruders", "https://www.raise3d.com/e2/"],
      ["Snapmaker · U1 toolchanger specifications", "https://www.snapmaker.com/en-US/snapmaker-u1/specs"],
    ],
  ),
];
