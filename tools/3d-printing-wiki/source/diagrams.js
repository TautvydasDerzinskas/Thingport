// Small diagrams for quiz questions. Their colors come from the window's stylesheet (.wiki-diagram), which takes them
// from the theme, so they read in light and dark. Each label describes the drawing without naming the answer.
const svgNamespace = "http://www.w3.org/2000/svg";

function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text != null) element.textContent = text;
  return element;
}

const diagramBed = (x, width, y = 150) => ["rect", { class: "wd-bed", x, y, width, height: 10, rx: 3 }];
const diagramLabel = (x, y, text) => ["text", { class: "wd-label", x, y, "text-anchor": "middle" }, text];

// A row of printed roads in cross-section: each a rounded rectangle.
function diagramRoads(x, y, count, width, height, gap) {
  return Array.from({ length: count }, (_, index) => [
    "rect",
    { class: "wd-part wd-outline", x: x + index * (width + gap), y, width, height, rx: Math.min(height / 2, 8) },
  ]);
}

export const diagrams = {
  "bridge-overhang": {
    label:
      "Side view of two printed features. A: a ledge sticks out from the top of a single pillar. B: a flat span joins the tops of two pillars.",
    shapes: () => [
      diagramBed(14, 292),
      ["rect", { class: "wd-part", x: 44, y: 66, width: 30, height: 84, rx: 2 }],
      ["rect", { class: "wd-part", x: 74, y: 66, width: 50, height: 12, rx: 2 }],
      diagramLabel(86, 52, "A"),
      ["rect", { class: "wd-part", x: 180, y: 66, width: 26, height: 84, rx: 2 }],
      ["rect", { class: "wd-part", x: 266, y: 66, width: 26, height: 84, rx: 2 }],
      ["rect", { class: "wd-part", x: 206, y: 66, width: 60, height: 12 }],
      diagramLabel(236, 52, "B"),
    ],
  },
  adhesion: {
    label:
      "Three top views of the same square part. A: a flat band joined to its edges. B: a thin loop a short distance away from it. C: a hatched pad that reaches under and around it.",
    shapes: () => {
      const shapes = [];
      [58, 160, 262].forEach((cx, index) => {
        const square = { x: cx - 20, y: 58, width: 40, height: 40, rx: 3 };
        if (index === 0) shapes.push(["rect", { class: "wd-soft", x: cx - 33, y: 45, width: 66, height: 66, rx: 6 }]);
        if (index === 1) shapes.push(["rect", { class: "wd-stroke", x: cx - 38, y: 40, width: 76, height: 76, rx: 8 }]);
        if (index === 2) {
          shapes.push(["rect", { class: "wd-soft", x: cx - 31, y: 47, width: 62, height: 62, rx: 3 }]);
          for (let offset = -24; offset <= 24; offset += 8)
            shapes.push([
              "path",
              { class: "wd-hatch", d: `M${cx + offset} 49 V107 M${cx - 29} ${78 + offset} H${cx + 29}` },
            ]);
        }
        shapes.push(["rect", { class: "wd-part", ...square }], diagramLabel(cx, 146, "ABC"[index]));
      });
      return shapes;
    },
  },
  seam: {
    label: "A printed cylinder with even layer lines and one vertical line of small bumps down one side.",
    shapes: () => {
      const shapes = [
        ["rect", { class: "wd-part", x: 104, y: 34, width: 112, height: 116, rx: 4 }],
        ["ellipse", { class: "wd-soft wd-outline", cx: 160, cy: 34, rx: 56, ry: 12 }],
      ];
      for (let y = 46; y < 150; y += 8) {
        shapes.push(["path", { class: "wd-layer", d: `M104 ${y} Q160 ${y + 10} 216 ${y}` }]);
        shapes.push(["circle", { class: "wd-dot", cx: 182, cy: y + 4, r: 2.6 }]);
      }
      return [...shapes, diagramBed(70, 180, 150)];
    },
  },
  "layer-line": {
    label:
      "Cross-section of stacked printed roads under a nozzle. The height of one road is marked h and its width is marked w.",
    shapes: () => [
      ...diagramRoads(60, 126, 4, 46, 18, 2),
      ...diagramRoads(60, 106, 4, 46, 18, 2),
      ...diagramRoads(60, 86, 3, 46, 18, 2),
      ["path", { class: "wd-nozzle", d: "M206 36 H246 L236 74 H216 Z" }],
      ["rect", { class: "wd-part wd-outline", x: 204, y: 86, width: 46, height: 18, rx: 8 }],
      ["path", { class: "wd-dimension", d: "M262 86 V104 M256 86 H268 M256 104 H268" }],
      diagramLabel(282, 100, "h"),
      ["path", { class: "wd-dimension", d: "M108 76 H154 M108 70 V82 M154 70 V82" }],
      diagramLabel(131, 64, "w"),
      diagramBed(40, 240, 146),
    ],
  },
  threshold: {
    label:
      "Side view of a part whose underside slopes up and away from the plate. The angle θ between that slope and a horizontal line is marked, with supports under the far end of the slope.",
    shapes: () => {
      const shapes = [diagramBed(30, 270), ["path", { class: "wd-part", d: "M62 150 V44 H250 V72 L104 150 Z" }]];
      for (let x = 196; x <= 240; x += 11) {
        const top = 150 - ((x - 104) * 78) / 146;
        shapes.push(["path", { class: "wd-support", d: `M${x} 150 V${top + 4}` }]);
      }
      return [
        ...shapes,
        ["path", { class: "wd-guide", d: "M104 150 H290" }],
        ["path", { class: "wd-dimension", d: "M164 150 A60 60 0 0 0 155 119" }],
        diagramLabel(178, 143, "θ"),
      ];
    },
  },
  "first-layer-gap": {
    label:
      "Three cross-sections of first-layer roads under a nozzle. A: round roads with gaps between them. B: slightly flattened roads that just touch. C: very thin, squashed roads with ridges pushed up between them.",
    shapes: () => {
      const shapes = [];
      [58, 160, 262].forEach((cx, index) => {
        const nozzleTip = [92, 108, 120][index];
        shapes.push([
          "path",
          { class: "wd-nozzle", d: `M${cx - 14} ${nozzleTip - 38} H${cx + 14} L${cx + 6} ${nozzleTip} H${cx - 6} Z` },
        ]);
        if (index === 0)
          for (const x of [-30, -10, 10, 30])
            shapes.push(["circle", { class: "wd-part wd-outline", cx: cx + x, cy: 122, r: 7 }]);
        if (index === 1) shapes.push(...diagramRoads(cx - 44, 117, 4, 22, 11, 0));
        if (index === 2) {
          shapes.push(...diagramRoads(cx - 46, 123, 4, 23, 6, 0));
          for (const x of [-23, 0, 23])
            shapes.push([
              "path",
              { class: "wd-part wd-outline", d: `M${cx + x - 4} 124 Q${cx + x} 112 ${cx + x + 4} 124 Z` },
            ]);
        }
        shapes.push(diagramBed(cx - 48, 96, 129), diagramLabel(cx, 162, "ABC"[index]));
      });
      return shapes;
    },
  },
  "elephant-foot": {
    label:
      "Side view of a printed wall in layers. The lowest layers bulge outward past a dashed line that shows the intended outline.",
    shapes: () => {
      const shapes = [];
      for (let layer = 0; layer < 9; layer++) {
        const y = 136 - layer * 12;
        const spread = [14, 8, 3][layer] ?? 0;
        shapes.push([
          "rect",
          { class: "wd-part wd-outline", x: 110 - spread, y, width: 100 + spread * 2, height: 12, rx: 5 },
        ]);
      }
      return [...shapes, ["path", { class: "wd-guide", d: "M110 30 V150 M210 30 V150" }], diagramBed(60, 200, 148)];
    },
  },
  "walls-infill": {
    label: "Top view of one printed layer: two loops run around the outside, and a grid pattern fills the middle.",
    shapes: () => {
      const shapes = [
        ["rect", { class: "wd-stroke wd-thick", x: 92, y: 22, width: 136, height: 136, rx: 12 }],
        ["rect", { class: "wd-stroke wd-thick", x: 101, y: 31, width: 118, height: 118, rx: 8 }],
      ];
      for (let offset = 124; offset <= 196; offset += 18)
        shapes.push(["path", { class: "wd-hatch", d: `M${offset} 40 V140 M110 ${offset - 70} H210` }]);
      return shapes;
    },
  },
};

/** One of `diagrams` as an SVG element, sized by the stylesheet. */
export function drawDiagram(id) {
  const { label: description, shapes } = diagrams[id];
  const svg = svgElement("svg", {
    viewBox: "0 0 320 180",
    role: "img",
    "aria-label": description,
    class: "wiki-diagram",
  });
  for (const [tag, attributes, text] of shapes()) svg.append(svgElement(tag, attributes, text));
  return svg;
}

/** The small flame beside a practice streak. */
export function flameIcon() {
  const svg = svgElement("svg", { viewBox: "0 0 16 16", "aria-hidden": "true", class: "wiki-flame" });
  svg.append(
    svgElement("path", {
      d: "M8.6 1.2c.4 2.3-.9 3.6-2.1 4.9C5.3 7.4 4 8.8 4 10.6 4 13 5.8 15 8 15s4-1.8 4-4.3c0-1.7-.8-3-1.7-4 .1 1.2-.4 2.1-1.2 2.5.4-2.9-.2-5.6-.5-8Z",
    }),
  );
  return svg;
}
