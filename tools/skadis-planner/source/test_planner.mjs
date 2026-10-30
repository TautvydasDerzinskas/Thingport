// Checks the parts of the planner worth being sure of: that a wall comes out covered by boards that exist and fit
// the bed, that the mirroring keeps the slot pitch across every seam, that the hardware is counted off the lattice
// the boards make, and that the 3MF the plan is saved as is a real one.
//   node source/test_planner.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOARD_PROFILES,
  MAX_HOLES,
  MIN_HOLES,
  MOUNT_SYSTEMS,
  PITCH_MM,
  PRINTERS,
  boardExists,
  boardSource,
  collectionModels,
  getMountSystem,
  getPrinter,
  holesFor,
  needsMirror,
  sizeMm,
} from "./catalogue.js";
import { PlanError, STRATEGIES, getStrategy, mirrorFlags, planWall, splitAxis } from "./solver.js";
import { countNodes, hardwareFor, hardwareMarkers } from "./mounting.js";
import { describePlan, partListText, printOrder, toBuy } from "./printlist.js";
import { partFiles } from "./parts3mf.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// The real English labels, so the text the tests read is the text the window shows — and a label that goes
// missing from locales/en.json fails here rather than quietly showing its key to a user.
const WORDS = JSON.parse(fs.readFileSync(path.join(here, "..", "locales", "en.json"), "utf8"));
const t = (key, vars) => {
  const text = WORDS[key] ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : text;
};

const a1 = getPrinter("a1");
const context = (over = {}) => ({
  printer: a1,
  system: getMountSystem("wall-mounts"),
  wallMm: 10,
  strategy: getStrategy("balanced"),
  t,
  ...over,
});

/* ------------------------------------------------------------ catalogue */

test("a board of h holes is h + 1 pitches long", () => {
  // Which is the rule the whole planner rests on, and the published profiles bear it out: 11 columns is 240 mm and
  // fits a 256 mm bed, while 12 would be 260 mm — which is exactly where AU3D's profiles stop and the "for H2D"
  // ones begin.
  assert.equal(sizeMm(11), 240);
  assert.equal(sizeMm(12), 260);
  assert.equal(sizeMm(1), 40);
  assert.ok(sizeMm(11) <= 256 && sizeMm(12) > 256);
  for (const profile of BOARD_PROFILES.filter((entry) => entry.cols <= 11)) {
    assert.ok(sizeMm(profile.cols) <= 256, `${profile.title} would not fit a 256 mm bed`);
  }
});

test("the bed decides the biggest board, and the figures match the published profiles", () => {
  assert.equal(holesFor(256), 11);
  assert.equal(sizeMm(11), 240); // fits a 256 mm bed
  assert.equal(holesFor(180), 8); // an A1 mini
  assert.equal(sizeMm(8), 180);
  assert.equal(holesFor(320), 15); // an H2D, which is what the 12-to-15 profiles are for
  assert.equal(sizeMm(15), 320);
});

test("a board is found in the profile that holds it, turned round if that's where it is", () => {
  const direct = boardSource(11, 11);
  assert.equal(direct.profile.cols, 11);
  assert.equal(direct.file, "11 x 11.stl");
  assert.equal(direct.turned, false);

  // Nobody publishes a 5-column board 14 rows tall, but the 14-column profile has it on its side.
  const turned = boardSource(5, 14);
  assert.equal(turned.profile.cols, 14);
  assert.equal(turned.file, "14 x 5.stl");
  assert.equal(turned.turned, true);

  // A 2 × 2 is published by nobody either way round.
  assert.equal(boardSource(2, 2), null);
  assert.equal(boardExists(2, 2), false);
});

test("every size a standard bed can print exists, either way round", () => {
  for (let cols = 3; cols <= 11; cols++) {
    for (let rows = 3; rows <= 11; rows++) {
      assert.ok(boardExists(cols, rows), `${cols} × ${rows} should be published`);
    }
  }
});

test("the models the tool brings are well formed and unique", () => {
  const models = collectionModels();
  const key = /^[a-z0-9][a-z0-9-]{0,59}$/;
  const keys = new Set();
  for (const model of models) {
    assert.match(model.key, key, `${model.key} isn't a usable key`);
    assert.ok(!keys.has(model.key), `${model.key} is used twice`);
    keys.add(model.key);
    assert.ok(model.name.length > 0 && model.name.length <= 120);
    assert.match(model.source, /^https:\/\/makerworld\.com\/en\/models\/\d+#profileId-\d+$/);
  }
  // One per board profile, plus the mounts in each distance they come in.
  assert.equal(models.filter((model) => model.key.startsWith("board-")).length, BOARD_PROFILES.length);
  assert.ok(models.length < 30, "the collection should stay small enough to fetch in one go");
});

/* --------------------------------------------------------------- solver */

test("an axis is covered exactly, with every board inside the bed", () => {
  for (const length of [400, 820, 1000, 1240, 2000]) {
    const split = splitAxis(length, 256);
    const covered = split.holes.reduce((total, holes) => total + sizeMm(holes), 0);
    assert.equal(covered + split.leftoverMm, length);
    assert.ok(split.leftoverMm >= 0 && split.leftoverMm < PITCH_MM, `${length} left ${split.leftoverMm} over`);
    for (const holes of split.holes) {
      assert.ok(holes >= MIN_HOLES && holes <= MAX_HOLES);
      assert.ok(sizeMm(holes) <= 256, `${sizeMm(holes)} mm doesn't fit a 256 mm bed`);
    }
  }
});

test("it uses the fewest boards it can", () => {
  // 820 mm on a 256 mm bed: the biggest board is 240 mm, so four is the fewest that can reach it.
  const split = splitAxis(820, 256);
  assert.equal(split.holes.length, 4);
  assert.equal(splitAxis(240, 256).holes.length, 1);
});

test("a bed or a wall too small says so rather than planning nonsense", () => {
  assert.throws(() => splitAxis(800, 50), PlanError);
  assert.throws(() => splitAxis(30, 256), PlanError);
  try {
    splitAxis(800, 50);
  } catch (error) {
    assert.equal(error.code, "bed-too-small");
    assert.match(error.message, /smallest board/);
  }
});

test("every other even board is mirrored, and odd boards never are", () => {
  // An even-hole board isn't symmetric: left alone, a row of them would drift off the pitch.
  assert.equal(needsMirror(10), true);
  assert.equal(needsMirror(11), false);
  assert.deepEqual(mirrorFlags([10, 10, 10, 10]), [false, true, false, true]);
  assert.deepEqual(mirrorFlags([11, 9, 7]), [false, false, false]);
  // An odd board between two even ones doesn't reset the alternation.
  assert.deepEqual(mirrorFlags([10, 11, 10]), [false, false, true]);
});

test("the wall comes out as a grid of boards that covers it", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  assert.equal(plan.boards.length, plan.columns.length * plan.rows.length);
  assert.equal(plan.boards.length, 16);
  assert.equal(plan.leftoverWidthMm, 0);
  assert.equal(plan.leftoverHeightMm, 0);
  assert.deepEqual(plan.missing, []);

  // Boards sit edge to edge, with no overlap and no gap.
  const first = plan.boards[0];
  assert.equal(first.xMm, 0);
  assert.equal(first.yMm, 0);
  const row0 = plan.boards.filter((board) => board.row === 0).sort((a, b) => a.xMm - b.xMm);
  for (let i = 1; i < row0.length; i++) {
    assert.equal(row0[i].xMm, row0[i - 1].xMm + row0[i - 1].widthMm);
  }
  const right = row0[row0.length - 1];
  assert.equal(right.xMm + right.widthMm, plan.coveredWidthMm);
});

test("the groups are what you print, and they add up to the boards", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const counted = plan.groups.reduce((total, group) => total + group.count, 0);
  assert.equal(counted, plan.boards.length);
  // Biggest first.
  for (let i = 1; i < plan.groups.length; i++) {
    const before = plan.groups[i - 1];
    const now = plan.groups[i];
    assert.ok(before.widthMm * before.heightMm >= now.widthMm * now.heightMm);
  }
});

test("every strategy returns a plan whose boards exist and fit", () => {
  for (const strategy of STRATEGIES) {
    const plan = planWall({ widthMm: 1000, heightMm: 700, printer: a1, strategyId: strategy.id, maxGapMm: 60 });
    assert.ok(plan.boards.length > 0, `${strategy.id} planned nothing`);
    assert.deepEqual(plan.missing, [], `${strategy.id} planned a board nobody publishes`);
    for (const board of plan.boards) {
      assert.ok(board.widthMm <= a1.x && board.heightMm <= a1.y, `${strategy.id} planned a board off the bed`);
    }
  }
});

test("“one size” uses one size, and “nothing mirrored” mirrors nothing", () => {
  const uniform = planWall({ widthMm: 1000, heightMm: 700, printer: a1, strategyId: "uniform" });
  assert.equal(new Set(uniform.columns).size, 1);
  assert.equal(new Set(uniform.rows).size, 1);

  const plain = planWall({ widthMm: 1000, heightMm: 700, printer: a1, strategyId: "no-mirror" });
  assert.ok(plain.boards.every((board) => !board.mirrorX && !board.mirrorY));
});

test("a smaller bed means more, smaller boards", () => {
  const big = planWall({ widthMm: 1000, heightMm: 1000, printer: getPrinter("a1") });
  const small = planWall({ widthMm: 1000, heightMm: 1000, printer: getPrinter("a1-mini") });
  assert.ok(small.boards.length > big.boards.length);
  for (const board of small.boards) assert.ok(board.widthMm <= 180 && board.heightMm <= 180);
});

test("every printer in the list can print the smallest board", () => {
  for (const printer of PRINTERS) {
    assert.ok(holesFor(Math.min(printer.x, printer.y)) >= MIN_HOLES, `${printer.name} is too small for any board`);
  }
});

/* ------------------------------------------------------------- mounting */

test("the lattice is counted by position, not by board corner", () => {
  // 4 × 4 boards make a 5 × 5 lattice: 9 inside, 12 along the edges, 4 at the corners.
  assert.deepEqual(countNodes(4, 4), { board: 16, junction: 9, edgeNode: 12, outerCorner: 4 });
  assert.deepEqual(countNodes(1, 1), { board: 1, junction: 0, edgeNode: 0, outerCorner: 4 });
  assert.deepEqual(countNodes(0, 5), { board: 0, junction: 0, edgeNode: 0, outerCorner: 0 });
});

test("wall mounts are counted off the lattice, and there is one marker for each", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const system = getMountSystem("wall-mounts");
  const hardware = hardwareFor(plan, system);
  // The catalogue holds label keys now, so look the parts up by what they are called.
  const named = (name) => hardware.find((item) => t(item.name).startsWith(name));
  assert.equal(named("Quad").count, 9);
  assert.equal(named("Double").count, 12);
  assert.equal(named("Single").count, 4);
  // One screw and plug per mount, four board screws per board.
  assert.equal(named("M4 × 40").count, 25);
  assert.equal(named("M4 × 20").count, 64);
  assert.equal(hardwareMarkers(plan, system).length, 25);
});

test("screw spacers are four to a board", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const system = getMountSystem("spacers");
  const hardware = hardwareFor(plan, system);
  assert.equal(hardware.find((item) => t(item.name) === "Screw spacer").count, 64);
  assert.equal(hardwareMarkers(plan, system).length, 64);
});

test("mount markers land on the lattice inside, and set in at the edges", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const system = getMountSystem("wall-mounts");
  const markers = hardwareMarkers(plan, system);
  const inset = system.insetMm;
  // The top-left corner has no board beyond it either way, so it comes in on both axes.
  const corner = markers.find((marker) => marker.role === "outerCorner");
  assert.equal(corner.x, inset);
  assert.equal(corner.y, inset);
  // A junction sits exactly where four boards meet.
  const junction = markers.find((marker) => marker.role === "junction");
  assert.equal(junction.x, sizeMm(plan.columns[0]));
  // Nothing escapes the wall.
  for (const marker of markers) {
    assert.ok(marker.x >= 0 && marker.x <= plan.coveredWidthMm);
    assert.ok(marker.y >= 0 && marker.y <= plan.coveredHeightMm);
  }
});

test("every mount system offers only distances all of its printed parts come in", () => {
  for (const system of MOUNT_SYSTEMS) {
    for (const mm of system.distances) {
      assert.ok(system.profiles[mm], `${system.name} has no file for ${mm} mm`);
      const models = collectionModels().map((model) => model.key);
      for (const item of system.items.filter((entry) => entry.print)) {
        const prefix = item.from === "single" ? "single" : item.from === "spacers" ? "spacer" : "mount";
        assert.ok(models.includes(`${prefix}-${mm}`), `nothing brings ${item.name} at ${mm} mm`);
      }
    }
  }
});

/* ----------------------------------------------------------- print list */

test("the print order is the boards biggest first, then the mounts, and counts every part", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const steps = printOrder(plan, getMountSystem("wall-mounts"), 10, t);
  assert.deepEqual(
    steps.map((step) => step.step),
    steps.map((_, index) => index + 1),
  );
  const boards = steps.filter((step) => step.kind === "board");
  const mounts = steps.filter((step) => step.kind === "mount");
  assert.equal(boards.length, plan.groups.length);
  assert.equal(mounts.length, 3);
  // Boards all come before mounts.
  assert.ok(steps.findIndex((step) => step.kind === "mount") === boards.length);
  assert.equal(
    boards.reduce((total, step) => total + step.count, 0),
    plan.boards.length,
  );
  // Every board step says which file, and which of the tool's models it is in.
  for (const step of boards) {
    assert.match(step.file, /^\d+ x \d+\.stl$/);
    assert.match(step.modelKey, /^board-\d+$/);
  }
  for (const step of mounts) assert.match(step.modelKey, /^(mount|single|spacer)-\d+$/);
});

test("the part list says what to print, how many and where it comes from", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const text = partListText(plan, context());
  assert.match(text, /Skadis wall 820 × 860 mm/);
  assert.match(text, /PRINT IN THIS ORDER/);
  assert.match(text, /16 boards, 4 across × 4 down/);
  assert.match(text, /Bambu Lab A1, 256 × 256 mm bed/);
  assert.match(text, /41 parts to print in all/); // 16 boards + 9 + 12 + 4 mounts
  assert.match(text, /BUY/);
  assert.match(text, /64 × M4 × 20 board screw/);
  // The credit, and the fact that the files aren't ours, have to survive any edit to this file.
  assert.match(text, /AU3D/);
  assert.match(text, /makerworld\.com/);
  assert.match(text, /come from MakerWorld under their licence/);
});

test("the description carries the same order, for the model it's saved on", () => {
  const plan = planWall({ widthMm: 600, heightMm: 600, printer: a1 });
  const description = describePlan(plan, context());
  const steps = printOrder(plan, getMountSystem("wall-mounts"), 10, t);
  assert.match(description, /Print in this order:/);
  for (const step of steps) assert.ok(description.includes(`${step.step}. ${step.count} × ${step.name}`));
  assert.match(description, /this model is the plan, not their files/);
});

test("mirroring is spelled out wherever a board is flipped", () => {
  // An even number of columns across forces alternate boards to be mirrored.
  const plan = planWall({ widthMm: 1000, heightMm: 700, printer: a1, strategyId: "uniform" });
  const flipped = plan.groups.filter((group) => group.mirrorX || group.mirrorY);
  const text = partListText(plan, context());
  if (flipped.length) {
    assert.match(text, /MIRRORING/);
    assert.match(text, /mirror in [XY]/);
  } else {
    assert.doesNotMatch(text, /MIRRORING/);
  }
});

test("what to buy is separate from what to print", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const buy = toBuy(plan, getMountSystem("wall-mounts"));
  assert.ok(buy.every((item) => !item.print));
  assert.ok(buy.some((item) => item.name.includes("screw")));
});

/* ----------------------------------------------------------------- 3MF */

/** The entries of a ZIP of stored files, which is what layout3mf writes. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new TextDecoder();
  const files = new Map();
  let end = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  assert.ok(end >= 0, "no end-of-directory record: not a ZIP");
  let offset = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let n = 0; n < count; n++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, "the central directory is damaged");
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = text.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, `${name} has no local header`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, text.decode(bytes.subarray(start, start + size)));
    offset = offset + 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

test("every part of the plan saves as its own 3MF a reader can open", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const steps = printOrder(plan, getMountSystem("wall-mounts"), 10, t);
  const files = partFiles(steps, { wallMm: 10 });

  // One file per part, in print order, and nothing combined into one.
  assert.equal(files.length, steps.length);
  assert.deepEqual(
    files.map((file) => file.step),
    steps.map((step) => step.step),
  );
  const names = new Set(files.map((file) => file.name));
  assert.equal(names.size, files.length, "two plates would land on the same name");

  for (const [index, file] of files.entries()) {
    assert.match(file.name, /^\d{2} .+\.3mf$/, `${file.name} isn't ordered and named as a plate`);
    assert.ok(!/[/\\]/.test(file.name), `${file.name} has a path separator in it`);
    const entries = unzip(file.data);
    assert.ok(entries.has("[Content_Types].xml"));
    assert.ok(entries.has("_rels/.rels"));
    const model = entries.get("3D/3dmodel.model");
    assert.match(model, /<model unit="millimeter"/);
    // One part a file: one object, one build item, one closed box.
    assert.equal([...model.matchAll(/<object /g)].length, 1);
    assert.equal([...model.matchAll(/<item /g)].length, 1);
    assert.equal([...model.matchAll(/<vertex /g)].length, 8);
    assert.equal([...model.matchAll(/<triangle /g)].length, 12);
    // And it says what it stands for, so a plate opened on its own explains itself.
    assert.match(model, /<metadata name="Description">[^<]+<\/metadata>/);
    assert.match(model, /not that file/);
    assert.ok(model.includes(`<metadata name="Title">`));
    assert.equal(files[index].name.startsWith(String(steps[index].step).padStart(2, "0")), true);
  }
});

test("a board plate is the board's true size, and says which file it stands for", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const steps = printOrder(plan, getMountSystem("wall-mounts"), 10, t);
  const files = partFiles(steps, { wallMm: 10 });
  const board = steps.find((step) => step.kind === "board");
  const file = files.find((entry) => entry.step === board.step);
  const model = unzip(file.data).get("3D/3dmodel.model");
  const xs = [...model.matchAll(/<vertex x="([-\d.]+)" y="([-\d.]+)" z="([-\d.]+)"/g)].map((m) =>
    m.slice(1).map(Number),
  );
  const width = Math.max(...xs.map((v) => v[0]));
  const height = Math.max(...xs.map((v) => v[1]));
  const thickness = Math.max(...xs.map((v) => v[2]));
  assert.equal(width, board.widthMm);
  assert.equal(height, board.heightMm);
  // Lying flat on the plate, in Skadis's own 5 mm stock.
  assert.equal(thickness, 5);
  assert.ok(model.includes(board.file), "the plate should name the file it stands for");
});

test("a mount plate is as deep as the standoff the plan uses", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  for (const wallMm of [10, 20]) {
    const steps = printOrder(plan, getMountSystem("wall-mounts"), wallMm, t);
    const files = partFiles(steps, { wallMm });
    const mount = steps.find((step) => step.kind === "mount");
    const model = unzip(files.find((entry) => entry.step === mount.step).data).get("3D/3dmodel.model");
    const zs = [...model.matchAll(/z="([-\d.]+)"/g)].map((m) => Number(m[1]));
    assert.equal(Math.max(...zs), wallMm);
  }
});

test("the count rides on the plate's name, so the plate list reads as the print order", () => {
  const plan = planWall({ widthMm: 820, heightMm: 860, printer: a1 });
  const steps = printOrder(plan, getMountSystem("wall-mounts"), 10, t);
  const files = partFiles(steps, { wallMm: 10 });
  for (const [index, step] of steps.entries()) {
    if (step.count > 1) assert.ok(files[index].name.includes(`x${step.count}`), files[index].name);
    if (step.mirror) assert.ok(files[index].name.includes("mirror"), files[index].name);
  }
});

/* -------------------------------------------------------------- bundle */

test("the built tool.js is there, matches the source and mounts", () => {
  const built = fs.readFileSync(path.join(here, "..", "tool.js"), "utf8");
  assert.match(built, /^\/\/ GENERATED by source\/build\.mjs/);
  assert.match(built, /export default async function mount/);
  assert.doesNotMatch(built, /\bimport\s*\(/, "nothing may be loaded at run time");
  assert.doesNotMatch(built, /^import\s/m);
  for (const file of [
    "catalogue.js",
    "solver.js",
    "mounting.js",
    "printlist.js",
    "parts3mf.js",
    "plan2d.js",
    "ui.js",
  ]) {
    assert.ok(built.includes(`// ---- ${file} ----`), `${file} isn't in the bundle`);
  }
});

test("the built tool.json brings the models the catalogue says", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, "..", "tool.json"), "utf8"));
  assert.equal(manifest.collection.models.length, collectionModels().length);
  assert.deepEqual(
    manifest.collection.models.map((model) => model.key),
    collectionModels().map((model) => model.key),
  );
  // It carries no model files of its own: AU3D's licence doesn't allow this repository to hold them.
  assert.ok(manifest.collection.models.every((model) => model.source && !model.files));
  assert.deepEqual(manifest.hosts, []);
});
