// The print order, and the text that carries it.
//
// The same text goes three places: the part list you download, the description of the model the plan is saved as,
// and the list the window shows. Writing it once means the file in your downloads and the model in your library
// always say the same thing.

import { BOARD_DESIGN, MOUNT_DESIGNS, boardKey, boardSource, keyForItem, needsMirror } from "./catalogue.js";
import { hardwareFor } from "./mounting.js";

const plural = (count, one, many) => `${count} ${count === 1 ? one : (many ?? `${one}s`)}`;
const mm = (value) => `${Math.round(value)} mm`;
/** "820 × 860 mm": the unit once, at the end, as a size is written. */
const size = (a, b) => `${Math.round(a)} × ${Math.round(b)} mm`;

/** How a board is described in one line: "9 × 11 holes, 200 × 240 mm". */
export const boardLabel = (group) => `${group.cols} × ${group.rows} holes, ${size(group.widthMm, group.heightMm)}`;

/** Which way a board has to be flipped before slicing, or null when it goes on the plate as it comes. */
export function mirrorNote(group) {
  const axes = [group.mirrorX && "X", group.mirrorY && "Y"].filter(Boolean);
  return axes.length ? `mirror in ${axes.join(" and ")}` : null;
}

/**
 * What to print, in the order to print it.
 *
 * Boards first, biggest first: they are the long prints, and the biggest one is the one most likely to show that
 * the bed, the wall or the plan is wrong, so it is the one to find out about first. Then the mounts, which are
 * quick and can be printed while the boards go up.
 */
export function printOrder(plan, system, wallMm) {
  const steps = [];
  for (const group of plan.groups) {
    const source = boardSource(group.cols, group.rows);
    steps.push({
      kind: "board",
      name: `Board ${group.cols} × ${group.rows}`,
      detail: boardLabel(group),
      count: group.count,
      widthMm: group.widthMm,
      heightMm: group.heightMm,
      mirror: mirrorNote(group),
      file: source?.file ?? null,
      turned: source?.turned ?? false,
      from: source ? `${BOARD_DESIGN.name} — ${source.profile.title}` : null,
      modelKey: source ? boardKey(source.profile.cols) : null,
      missing: !source,
    });
  }
  for (const item of hardwareFor(plan, system).filter((entry) => entry.print)) {
    const design = item.from === "single" ? MOUNT_DESIGNS.single : system.design;
    steps.push({
      kind: "mount",
      name: item.name,
      detail: `${wallMm} mm off the wall`,
      count: item.count,
      widthMm: null,
      heightMm: null,
      mirror: null,
      file: null,
      turned: false,
      from: design.name,
      modelKey: keyForItem(item, wallMm),
      missing: false,
    });
  }
  return steps.map((step, index) => ({ ...step, step: index + 1 }));
}

/** What to buy rather than print. */
export const toBuy = (plan, system) => hardwareFor(plan, system).filter((item) => !item.print);

/** A line that fits in a title: "Skadis wall 820 × 860 mm". */
export const planTitle = (plan) => `Skadis wall ${size(plan.widthMm, plan.heightMm)}`;

/**
 * The whole plan as plain text. `context` carries what the plan itself doesn't know: the printer, the mount system
 * and the distance from the wall.
 */
export function partListText(plan, context) {
  const { printer, system, wallMm, strategy } = context;
  const steps = printOrder(plan, system, wallMm);
  const buy = toBuy(plan, system);
  const out = [];
  const line = (text = "") => out.push(text);
  const rule = (text) => {
    line();
    line(text.toUpperCase());
    line("-".repeat(text.length));
  };

  line(planTitle(plan));
  line("Planned with the Skadis planner in Thingport.");

  rule("The wall");
  line(`  Space            ${mm(plan.widthMm)} wide × ${mm(plan.heightMm)} high`);
  line(
    `  Covered          ${size(plan.coveredWidthMm, plan.coveredHeightMm)}` +
      (plan.leftoverWidthMm || plan.leftoverHeightMm
        ? `, leaving ${mm(plan.leftoverWidthMm)} across and ${mm(plan.leftoverHeightMm)} down`
        : ", the whole of it"),
  );
  line(
    `  Boards           ${plural(plan.boards.length, "board")}, ${plan.columns.length} across × ${plan.rows.length} down`,
  );
  line(`  Printer          ${printer.name}, ${printer.x} × ${printer.y} mm bed`);
  line(`  Layout           ${strategy.name}`);
  line(`  Held by          ${system.name}, ${wallMm} mm off the wall`);

  rule("Print in this order");
  for (const step of steps) {
    const flip = step.mirror ? `, ${step.mirror}` : "";
    line(`  ${String(step.step).padStart(2)}. ${step.count} × ${step.name}${flip}`);
    line(`      ${step.detail}`);
    if (step.file) {
      line(`      file "${step.file}"${step.turned ? ", printed a quarter turn round" : ""}`);
    }
    if (step.from) line(`      from ${step.from}`);
    if (step.missing) line("      NOT PUBLISHED IN THIS SIZE — change the wall or the layout");
  }
  line();
  line(
    `  ${plural(
      steps.reduce((total, step) => total + step.count, 0),
      "part",
    )} to print in all.`,
  );
  line("  Print one board first and offer it up to the wall before committing to the rest.");

  if (steps.some((step) => step.mirror)) {
    rule("Mirroring");
    line("  A board with an even number of holes has to be flipped for its pattern to carry on into its neighbour,");
    line("  so every other one of them is mirrored. In Bambu Studio or Orca: right-click the object, Mirror, then");
    line("  the axis named above. The counts above say how many to print each way round.");
  }

  if (buy.length) {
    rule("Buy");
    for (const item of buy) line(`  ${String(item.count).padStart(4)} × ${item.name}`);
  }

  rule("Where the files come from");
  line(`  Boards   ${BOARD_DESIGN.name} by ${BOARD_DESIGN.author.name}`);
  line(`           ${BOARD_DESIGN.url}`);
  line(`  Mounts   ${system.design.name}`);
  line(`           ${system.design.url}`);
  if (steps.some((step) => step.modelKey?.startsWith("single"))) {
    line(`           ${MOUNT_DESIGNS.single.name}`);
    line(`           ${MOUNT_DESIGNS.single.url}`);
  }
  line();
  line(`  Everything printed here is ${BOARD_DESIGN.author.name}'s design. This plan says which of their files to`);
  line("  print and how many; the files themselves come from MakerWorld under their licence.");
  return out.join("\n");
}

/** The same thing, shortened for a model's description, which sits above a page rather than in a file. */
export function describePlan(plan, context) {
  const { printer, system, wallMm, strategy } = context;
  const steps = printOrder(plan, system, wallMm);
  const out = [];
  out.push(
    `${plural(plan.boards.length, "board")} filling ${size(plan.widthMm, plan.heightMm)} of wall, ` +
      `${plan.columns.length} across × ${plan.rows.length} down, for a ${printer.name}. ` +
      `${strategy.name} layout, held by ${system.name.toLowerCase()} ${wallMm} mm off the wall.`,
  );
  out.push("");
  out.push("Print in this order:");
  for (const step of steps) {
    const flip = step.mirror ? ` (${step.mirror})` : "";
    const file = step.file ? ` — file "${step.file}"${step.turned ? ", turned a quarter turn" : ""}` : "";
    out.push(`${step.step}. ${step.count} × ${step.name}${flip} — ${step.detail}${file}`);
  }
  const buy = toBuy(plan, system);
  if (buy.length) {
    out.push("");
    out.push(`Buy: ${buy.map((item) => `${item.count} × ${item.name}`).join(", ")}.`);
  }
  out.push("");
  out.push(
    `The boards and mounts are ${BOARD_DESIGN.author.name}'s designs on MakerWorld (${BOARD_DESIGN.url}); ` +
      "this model is the plan, not their files.",
  );
  return out.join("\n");
}
