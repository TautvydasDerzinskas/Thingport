// Builds the enclosure in many configurations and checks each part is a closed solid a slicer takes as it is: every
// edge shared by exactly two triangles, facing the same way round, and a volume above nothing. Run with
//   node source/test_enclosure.mjs

import { buildEnclosure, lidForPrint } from "./enclosure.js";
import { normalize, PORTS } from "./data.js";
import { stl } from "./csg.js";

function check(tris) {
  const key = (v) => v.map((c) => c.toFixed(4)).join(",");
  const edges = new Map();
  let degenerate = 0;
  for (const [a, b, c] of tris) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const area = Math.hypot(
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    );
    if (area < 1e-9) degenerate++;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = `${key(p)}>${key(q)}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  // Each edge once each way: closed, and wound the same way on both sides.
  let open = 0;
  for (const [k, n] of edges) {
    const [p, q] = k.split(">");
    if (n !== 1 || edges.get(`${q}>${p}`) !== 1) open++;
  }
  return { open, degenerate };
}

function volumeOf(tris) {
  let sum = 0;
  for (const [a, b, c] of tris)
    sum += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  return sum / 6;
}

const port = (id, wall, x, z, extra = {}) => {
  const t = PORTS.find((p) => p.id === id);
  return {
    id,
    wall,
    shape: t.shape,
    width: t.width,
    height: t.height,
    diameter: t.diameter,
    x,
    z,
    portTemplate: id,
    ...extra,
  };
};

const cases = [
  ["default: lip, corner screws, PCB grid", {}],
  [
    "flat lid, no screws, sharp corners",
    { lidType: "flat", hasCornerScrews: false, radius: 0, hasPcbStandoffs: false },
  ],
  ["no lid", { hasLid: false }],
  [
    "snap latches with an opening groove",
    { lidFixation: "snap", latchWalls: ["left", "right"], latchCount: 2, hasLidGroove: true },
  ],
  ["snap joint on all walls", { lidFixation: "snapJoint", thickness: 3, latchCount: 1 }],
  ["flanges left and right", { hasFlanges: true, flangeWalls: ["left", "right"] }],
  ["lid vents, slots", { hasVentilation: true, ventPattern: "slots" }],
  [
    "honeycomb vents on the lid and two walls",
    {
      hasVentilation: true,
      ventPattern: "honeycomb",
      ventWalls: ["left", "right"],
      ventSlotLength: 40,
      ventSlotCount: 5,
    },
  ],
  ["dot and diamond vents", { hasVentilation: true, ventPattern: "dots", ventWalls: ["front"], ventOrientation: "Y" }],
  ["diamonds", { hasVentilation: true, ventPattern: "diamonds" }],
  [
    "ports on every wall and the lid, with labels",
    {
      cutouts: [
        port("usb-c", "front", 30, 12, { label: "USB" }),
        port("dc5521", "front", 70, 15, { label: "12V", labelPosition: "below" }),
        port("rj45", "back", 50, 20),
        port("hdmi", "left", 40, 18),
        port("db9", "right", 40, 20, { label: "RS-232" }),
        port("xt60", "back", 20, 15, { rotation: 90 }),
        port("oled-096", "lid", 50, 40, { label: "OLED", labelPosition: "above" }),
      ],
    },
  ],
  ["text debossed on the lid", { hasText: true, textString: "Hello 123!", textType: "deboss" }],
  [
    "text embossed on the front",
    { hasText: true, textString: "PI-HOLE", textType: "emboss", textPlacement: "front", textSize: 9 },
  ],
  ["standoffs under the lid", { pcbOnLid: true, pcbWidth: 40, pcbLength: 30 }],
  [
    "custom standoffs (Raspberry Pi 4)",
    {
      width: 110,
      length: 85,
      standoffMode: "list",
      pcbStandoffs: [
        [-29, -24.5],
        [29, -24.5],
        [-29, 24.5],
        [29, 24.5],
      ].map(([x, y]) => ({ x, y, height: 6, outerDia: 6, innerDia: 2.7 })),
    },
  ],
  ["big and thick, high quality", { width: 220, length: 160, height: 80, thickness: 4, radius: 20, quality: "high" }],
  [
    "small and thin",
    { width: 30, length: 30, height: 15, thickness: 1.2, radius: 3, bossRadius: 3, hasPcbStandoffs: false },
  ],
];

let failed = 0;
for (const [name, settings] of cases) {
  const started = performance.now();
  const { quality, ...input } = settings;
  const model = buildEnclosure(input, { quality: quality ?? "normal" });
  const ms = Math.round(performance.now() - started);
  const parts = [["base", model.base]];
  if (model.lid.length) parts.push(["lid", model.lid], ["lid to print", lidForPrint(model.lid)]);
  for (const [part, tris] of parts) {
    const { open, degenerate } = check(tris);
    const vol = volumeOf(tris) / 1000;
    const ok = tris.length > 0 && open === 0 && vol > 0;
    if (!ok) failed++;
    console.log(
      `${ok ? "✓" : "✗"} ${name}: ${part} ${tris.length} triangles, ${vol.toFixed(1)} cm³, ${open} open edges, ${degenerate} degenerate${part === "base" ? `, ${ms} ms` : ""}`,
    );
  }
  if (model.warnings.length) console.log(`    notes: ${model.warnings.join(" | ")}`);
  const bytes = stl(model.base, name);
  if (bytes.length !== 84 + model.base.length * 50) {
    failed++;
    console.log("✗ STL size");
  }
}

// PrintCasing's own saved projects open: {version, params} and its keys.
const imported = normalize({
  ventSurfaces: ["lid", "front"],
  pcbWall: "lid",
  radius: 99,
  lidType: "flat",
  lidFixation: "snap",
});
const expectations = [
  [imported.params.hasVentilation, true],
  [imported.params.ventWalls.join(), "front"],
  [imported.params.pcbOnLid, true],
  [imported.params.radius, 30],
  [imported.params.lidType, "lip"],
];
for (const [actual, expected] of expectations)
  if (actual !== expected) {
    failed++;
    console.log(`✗ normalize: ${actual} isn't ${expected}`);
  }
console.log(failed ? `${failed} failed` : "all passed");
process.exitCode = failed ? 1 : 0;
