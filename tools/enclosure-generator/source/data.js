// The enclosure's settings: their defaults and limits, the PCB boards it knows the mounting holes of, and the ports
// it knows the size of. The names of the settings are PrintCasing's, so its saved projects open here too.

export const DEFAULTS = {
  width: 100,
  length: 80,
  height: 40,
  thickness: 2.4,
  radius: 8,
  tolerance: 0.2,
  hasLid: true,
  lidThickness: 2.4,
  lidType: "lip",
  lidLipHeight: 1.6,
  lidLipThickness: 1.5,
  lidFixation: "screws",
  latchWidth: 4,
  latchDepth: 1,
  latchHeight: 5,
  latchCount: 2,
  latchWalls: ["left", "right", "front", "back"],
  hasLidGroove: false,
  grooveWall: "auto",
  grooveHeight: 1.2,
  grooveWidth: 8,
  grooveDepth: 1.5,
  hasCornerScrews: true,
  screwDiameter: 2.8,
  lidScrewDiameter: 3.3,
  screwHeadDiameter: 6,
  screwHeadDepth: 2.2,
  bossRadius: 4.5,
  bossInset: 6.9,
  hasFlanges: false,
  flangeLength: 15,
  flangeWidth: 25,
  flangeHoleDiameter: 4.2,
  flangeThickness: 3,
  flangeWalls: ["left", "right"],
  hasPcbStandoffs: true,
  pcbPreset: "none",
  pcbOnLid: false,
  pcbRotated: false,
  pcbWidth: 70,
  pcbLength: 50,
  pcbStandoffHeight: 6,
  pcbStandoffOuterDia: 6,
  pcbStandoffInnerDia: 2.5,
  pcbOffsetX: 0,
  pcbOffsetY: 0,
  standoffMode: "grid",
  pcbStandoffs: [],
  hasVentilation: false,
  ventPattern: "slots",
  ventSlotWidth: 2,
  ventSlotSpacing: 3,
  ventSlotLength: 45,
  ventSlotCount: 8,
  ventOrientation: "X",
  ventWalls: [],
  hasText: false,
  textString: "THINGPORT",
  textPlacement: "lid",
  textType: "deboss",
  textSize: 7,
  textDepth: 0.6,
  textOffsetX: 0,
  textOffsetY: 0,
  cutouts: [],
};

/** Each number's limits and step, in mm unless it's a count. */
export const RANGES = {
  width: [30, 300, 1],
  length: [30, 300, 1],
  height: [15, 200, 1],
  thickness: [1.2, 6, 0.2],
  radius: [0, 30, 1],
  tolerance: [0.05, 0.6, 0.05],
  lidThickness: [1.2, 6, 0.2],
  lidLipHeight: [0.8, 4, 0.2],
  lidLipThickness: [0.8, 3, 0.1],
  screwDiameter: [1.5, 5, 0.1],
  lidScrewDiameter: [1.8, 6, 0.1],
  screwHeadDiameter: [3, 10, 0.1],
  screwHeadDepth: [0, 6, 0.1],
  bossRadius: [3, 12, 0.5],
  bossInset: [4, 20, 0.1],
  latchWidth: [2, 30, 0.5],
  latchDepth: [0.5, 2, 0.05],
  latchHeight: [3, 15, 0.5],
  latchCount: [1, 4, 1],
  grooveWidth: [3, 25, 0.5],
  grooveDepth: [0.5, 5, 0.1],
  grooveHeight: [0.5, 5, 0.1],
  flangeLength: [5, 40, 1],
  flangeWidth: [10, 80, 1],
  flangeHoleDiameter: [2, 8, 0.5],
  flangeThickness: [1.6, 6, 0.5],
  pcbWidth: [10, 280, 1],
  pcbLength: [10, 280, 1],
  pcbStandoffHeight: [2, 40, 0.5],
  pcbStandoffOuterDia: [4, 12, 0.5],
  pcbStandoffInnerDia: [1.2, 5, 0.1],
  pcbOffsetX: [-100, 100, 1],
  pcbOffsetY: [-100, 100, 1],
  ventSlotCount: [2, 30, 1],
  ventSlotWidth: [1, 6, 0.5],
  ventSlotSpacing: [1, 8, 0.5],
  ventSlotLength: [10, 250, 1],
  textSize: [4, 30, 0.5],
  textDepth: [0.2, 3, 0.1],
  textOffsetX: [-150, 150, 1],
  textOffsetY: [-150, 150, 1],
  standoffX: [-150, 150, 0.1],
  standoffY: [-150, 150, 0.1],
  standoffHeight: [2, 40, 0.5],
  standoffOuterDia: [4, 12, 0.5],
  standoffInnerDia: [1.2, 5, 0.1],
  cutoutDiameter: [2, 100, 0.1],
  cutoutWidth: [2, 100, 0.1],
  cutoutHeight: [2, 100, 0.1],
  cutoutLabelSize: [2, 8, 0.5],
  cutoutRotation: [-180, 180, 15],
  cutoutPosition: [-300, 600, 0.5],
};

export const WALLS = ["front", "back", "left", "right"];

/** Mounting holes of common boards, from the board's centre, in mm. */
export const BOARDS = [
  [
    "arduino_uno",
    "Arduino Uno",
    6,
    2.5,
    6,
    [
      [-20.3, -24.15],
      [-19.1, 24.15],
      [31.7, -19.05],
      [31.7, 8.95],
    ],
  ],
  ["arduino_mega", "Arduino Mega 2560", 6, 3, 6, grid(48.26, 15.24)],
  ["arduino_nano", "Arduino Nano", 4, 1.8, 4, grid(20.3, 6.35)],
  ["arduino_micro", "Arduino Micro", 4, 2, 3, grid(12.7, 7.62)],
  ["arduino_pro_mini", "Arduino Pro Mini", 4, 2, 3, grid(15.24, 10.16)],
  ["arduino_uno_wifi", "Arduino Uno WiFi Rev2", 5, 2.5, 4, grid(27.94, 17.78)],
  ["esp32_wroom", "ESP32 WROOM", 4.5, 2, 4, grid(23.25, 11.75)],
  ["esp32_devkitc", "ESP32 DevKitC V4", 4, 2, 4, grid(17.78, 12.7)],
  ["esp32_s3_devkitc", "ESP32-S3 DevKitC", 4, 2, 4, grid(17.78, 12.7)],
  ["esp8266_nodemcu", "ESP8266 NodeMCU", 4.5, 2, 4, grid(21.5, 10.5)],
  ["nodemcu_32s", "NodeMCU-32S", 4.5, 2, 4, grid(21.5, 10.5)],
  ["wemos_d1_mini", "Wemos D1 Mini", 3.5, 1.6, 3, grid(12, 8)],
  ["wemos_d1_r32", "Wemos D1 R32", 4, 2, 4, grid(17, 10)],
  ["raspberry_pi_4_5", "Raspberry Pi 4 / 5", 6, 2.7, 6, grid(29, 24.5)],
  ["raspberry_pi_3bp", "Raspberry Pi 3 B+", 6, 2.7, 6, grid(29, 24.5)],
  ["raspberry_pi_zero", "Raspberry Pi Zero", 5, 2.5, 4, grid(29, 11.5)],
  ["raspberry_pi_pico", "Raspberry Pi Pico", 4, 1.8, 4, grid(23.5, 8.5)],
  ["raspberry_pi_cm4", "Raspberry Pi CM4", 3.2, 1.6, 3, grid(27.5, 27.5)],
  ["raspberry_pi_400", "Raspberry Pi 400", 6, 2.7, 6, grid(49, 17.5)],
  [
    "teensy_41",
    "Teensy 4.1",
    4,
    1.8,
    4,
    [
      [-28.5, 0],
      [28.5, 0],
    ],
  ],
  [
    "teensy_40",
    "Teensy 4.0",
    4,
    1.8,
    4,
    [
      [-28.5, 0],
      [28.5, 0],
    ],
  ],
  [
    "teensy_35",
    "Teensy 3.5 / 3.6",
    4,
    1.8,
    4,
    [
      [-28.5, 0],
      [28.5, 0],
    ],
  ],
  [
    "teensy_lc",
    "Teensy LC",
    3.2,
    1.6,
    3,
    [
      [-12.7, 0],
      [12.7, 0],
    ],
  ],
  ["stm32_blue_pill", "STM32 Blue Pill", 4, 2, 3, grid(13.97, 10.16)],
  ["stm32_black_pill", "STM32 Black Pill", 4, 2, 3, grid(13.97, 10.16)],
  ["stm32_nucleo_64", "STM32 Nucleo-64", 4, 2.5, 4, grid(24.13, 12.7)],
  ["beaglebone_black", "BeagleBone Black", 6, 3, 6, grid(33.02, 19.05)],
  ["jetson_nano", "Jetson Nano", 6, 3, 6, grid(45, 25)],
  ["jetson_orin_nano", "Jetson Orin Nano", 6, 3, 6, grid(45, 25)],
  ["banana_pi_m5", "Banana Pi M5", 6, 3, 6, grid(45, 32.5)],
  ["orange_pi_5", "Orange Pi 5", 4, 2.5, 4, grid(40, 25)],
  ["odroid_xu4", "ODROID-XU4", 4, 2.5, 4, grid(36, 26)],
  ["khadas_vim4", "Khadas VIM4", 4, 2.5, 4, grid(27.5, 17.5)],
].map(([id, name, outerDia, innerDia, height, holes]) => ({ id, name, outerDia, innerDia, height, holes }));

function grid(x, y) {
  return [
    [-x, -y],
    [x, -y],
    [-x, y],
    [x, y],
  ];
}

/** Openings for common sockets, as the shape and size of the hole, in mm. */
export const PORTS = [
  ["USB", "usb-a", "USB-A", "rect", 13, 6],
  ["USB", "usb-b", "USB-B", "rect", 12, 11],
  ["USB", "usb-c", "USB-C", "type-c", 9, 3.2],
  ["USB", "microusb", "Micro USB", "rect", 8, 3.5],
  ["USB", "miniusb", "Mini USB", "rect", 8, 5.5],
  ["USB", "lightning", "Lightning", "rect", 8.4, 3],
  ["Power", "dc5521", "DC jack 5.5/2.1", "circle", 11],
  ["Power", "dc5525", "DC jack 5.5/2.5", "circle", 11],
  ["Power", "dc-eiaj-3", "DC EIAJ-3", "circle", 9.5],
  ["Power", "dc-4017", "DC jack 4.0/1.7", "circle", 7],
  ["Power", "xt60", "XT60", "xt60", 15.5, 8.1],
  ["Power", "xt30", "XT30", "xt60", 10.5, 5.5],
  ["Power", "ec3", "EC3", "circle", 5.5],
  ["Power", "switch", "ON/OFF switch", "rect", 9, 18.5],
  ["Network", "rj45", "RJ45 Ethernet", "rect", 16, 14],
  ["Network", "rj11", "RJ11", "rect", 9.5, 9.5],
  ["Network", "rj12", "RJ12", "rect", 9.5, 9.5],
  ["Video", "hdmi", "HDMI", "hdmi", 14.5, 5],
  ["Video", "mini-hdmi", "Mini HDMI", "rect", 10.5, 3],
  ["Video", "micro-hdmi", "Micro HDMI", "rect", 7, 2.8],
  ["Video", "displayport", "DisplayPort", "rect", 16, 7],
  ["D-sub", "vga", "VGA (DE-15)", "dsub", 20.5, 12.5],
  ["D-sub", "db9", "DB9 / RS-232", "dsub", 20.5, 11.4],
  ["D-sub", "db25", "DB25", "dsub", 38.3, 12.5],
  ["RF", "sma", "SMA", "circle", 6.5],
  ["RF", "bnc", "BNC", "circle", 10],
  ["RF", "f-type", "F-type", "circle", 9.5],
  ["Pin headers", "jst-xh-2", "JST-XH 2-pin", "rect", 5, 7],
  ["Pin headers", "jst-ph-2", "JST-PH 2-pin", "rect", 4, 6],
  ["Pin headers", "molex-kk", "Molex KK 2.54", "rect", 5, 7],
  ["Pin headers", "dupont-4", "Dupont 4-pin", "rect", 10, 7],
  ["Cards", "microsd", "microSD slot", "rect", 15, 2],
  ["Cards", "nano-sim", "Nano-SIM tray", "rect", 12, 10],
  ["Screens", "oled-091", 'OLED 0.91"', "rect", 24, 8],
  ["Screens", "oled-096", 'OLED 0.96"', "rect", 24, 14],
  ["Screens", "oled-13", 'OLED 1.3"', "rect", 32, 17],
  ["Screens", "tft-177", 'TFT 1.77"', "rect", 30, 37],
  ["Screens", "tft-20", 'TFT 2.0"', "rect", 33, 43],
  ["Screens", "tft-24", 'TFT 2.4"', "rect", 39, 51],
  ["Screens", "tft-28", 'TFT 2.8"', "rect", 46, 60],
  ["Screens", "tft-32", 'TFT 3.2"', "rect", 51, 67],
  ["Screens", "tft-35", 'TFT 3.5"', "rect", 51, 76],
  ["Screens", "lcd-162", "LCD 16×2", "rect", 67, 18],
].map(([group, id, name, shape, a, b]) =>
  shape === "circle" ? { group, id, name, shape, diameter: a } : { group, id, name, shape, width: a, height: b },
);

const clampTo = (value, [min, max]) => Math.min(max, Math.max(min, value));
const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const listOf = (value, allowed) => (Array.isArray(value) ? value.filter((v) => allowed.includes(v)) : []);

/**
 * Settings made safe to build: every key present, numbers in range, and the few that depend on others brought in
 * line. Returns the settings and what had to change, in words.
 */
export function normalize(input) {
  const raw = input && typeof input === "object" ? input : {};
  const p = { ...DEFAULTS };
  const notes = [];
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] === undefined) continue;
    const fallback = DEFAULTS[key];
    if (typeof fallback === "number") p[key] = numberOr(raw[key], fallback);
    else if (typeof fallback === "boolean") p[key] = Boolean(raw[key]);
    else if (typeof fallback === "string") p[key] = String(raw[key]);
    else p[key] = raw[key];
  }
  for (const [key, range] of Object.entries(RANGES)) if (key in p) p[key] = clampTo(p[key], range);
  // PrintCasing's: a PCB on the lid is pcbWall "lid", or pcbOnLid.
  if (raw.pcbWall === "lid") p.pcbOnLid = true;
  p.lidType = ["flat", "lip"].includes(p.lidType) ? p.lidType : "lip";
  p.lidFixation = ["screws", "snap", "snapJoint"].includes(p.lidFixation) ? p.lidFixation : "screws";
  p.ventPattern = ["slots", "honeycomb", "dots", "diamonds"].includes(p.ventPattern) ? p.ventPattern : "slots";
  p.ventOrientation = p.ventOrientation === "Y" ? "Y" : "X";
  p.textPlacement = ["lid", "front", "back", "left", "right"].includes(p.textPlacement) ? p.textPlacement : "lid";
  p.textType = p.textType === "emboss" ? "emboss" : "deboss";
  p.standoffMode = p.standoffMode === "list" ? "list" : "grid";
  p.latchWalls = listOf(p.latchWalls, WALLS);
  p.flangeWalls = listOf(p.flangeWalls, WALLS);
  p.ventWalls = listOf(p.ventWalls, WALLS);
  // PrintCasing keeps the lid's vents in ventSurfaces with the walls'.
  if (Array.isArray(raw.ventSurfaces) && raw.ventSurfaces.length) {
    p.hasVentilation = raw.ventSurfaces.includes("lid");
    p.ventWalls = listOf(raw.ventSurfaces, WALLS);
  }
  p.grooveWall = ["auto", ...WALLS].includes(p.grooveWall) ? p.grooveWall : "auto";
  p.textString = p.textString.slice(0, 40);
  p.pcbStandoffs = (Array.isArray(p.pcbStandoffs) ? p.pcbStandoffs : []).slice(0, 24).map((s, i) => ({
    id: String(s?.id ?? `s${i + 1}`),
    x: clampTo(numberOr(s?.x, 0), RANGES.standoffX),
    y: clampTo(numberOr(s?.y, 0), RANGES.standoffY),
    height: clampTo(numberOr(s?.height, 6), RANGES.standoffHeight),
    outerDia: clampTo(numberOr(s?.outerDia, 6), RANGES.standoffOuterDia),
    innerDia: clampTo(numberOr(s?.innerDia, 2.5), RANGES.standoffInnerDia),
  }));
  p.cutouts = (Array.isArray(p.cutouts) ? p.cutouts : []).slice(0, 40).map((c, i) => ({
    id: String(c?.id ?? `c${i + 1}`),
    wall: [...WALLS, "lid"].includes(c?.wall) ? c.wall : "front",
    shape: ["rect", "circle", "type-c", "dsub", "hdmi", "xt60"].includes(c?.shape) ? c.shape : "rect",
    width: clampTo(numberOr(c?.width, 10), RANGES.cutoutWidth),
    height: clampTo(numberOr(c?.height, 6), RANGES.cutoutHeight),
    diameter: clampTo(numberOr(c?.diameter, 8), RANGES.cutoutDiameter),
    rotation: numberOr(c?.rotation, 0),
    x: numberOr(c?.x, 0),
    z: numberOr(c?.z, 0),
    portTemplate: c?.portTemplate ? String(c.portTemplate) : null,
    label: c?.label ? String(c.label).slice(0, 16) : "",
    labelPosition: ["above", "below", "left", "right"].includes(c?.labelPosition) ? c.labelPosition : "above",
    labelSize: clampTo(numberOr(c?.labelSize, 3.5), RANGES.cutoutLabelSize),
  }));

  // What depends on other settings.
  const maxRadius = Math.floor(Math.min(p.width, p.length) / 2);
  if (p.radius > maxRadius) {
    notes.push(`Corner radius held to ${maxRadius} mm, half the box's shorter side.`);
    p.radius = maxRadius;
  }
  const minInset = Number((p.thickness + p.bossRadius).toFixed(2));
  if (p.bossInset < minInset) p.bossInset = minInset;
  const innerW = p.width - p.thickness * 2;
  const innerL = p.length - p.thickness * 2;
  if (p.pcbWidth > innerW - 10) p.pcbWidth = Math.max(10, Math.floor(innerW - 10));
  if (p.pcbLength > innerL - 10) p.pcbLength = Math.max(10, Math.floor(innerL - 10));
  if (p.lidFixation !== "screws" && p.lidType === "flat") {
    notes.push("Snap fixings need the lid's lip, so the lid has one.");
    p.lidType = "lip";
  }
  return { params: p, notes };
}
