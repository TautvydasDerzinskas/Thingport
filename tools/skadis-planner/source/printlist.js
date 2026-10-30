// The print order, and the text that carries it.
//
// The same text goes three places: the part list you download, the description of the model the plan is saved as,
// and the list the window shows. Writing it once means the file in your downloads and the model in your library
// always say the same thing.

import { BOARD_DESIGN, MOUNT_DESIGNS, boardKey, boardSource, keyForItem, needsMirror } from "./catalogue.js";
import { hardwareFor } from "./mounting.js";

/** "1 board" / "4 boards": the word is a pair of labels, so a language with other plurals can say it its way. */
const plural = (t, count, one, many) => `${count} ${t(count === 1 ? one : many)}`;
const mm = (value) => `${Math.round(value)} mm`;
/** "820 × 860 mm": the unit once, at the end, as a size is written. */
const size = (a, b) => `${Math.round(a)} × ${Math.round(b)} mm`;

/** How a board is described in one line: "9 × 11 holes, 200 × 240 mm". */
export const boardLabel = (group, t) =>
  t("list.boardLabel", { cols: group.cols, rows: group.rows, size: size(group.widthMm, group.heightMm) });

/** Which way a board has to be flipped before slicing, or null when it goes on the plate as it comes. */
export function mirrorNote(group, t) {
  const axes = [group.mirrorX && "X", group.mirrorY && "Y"].filter(Boolean);
  return axes.length ? t("list.mirrorIn", { axes: axes.join(t("list.and")) }) : null;
}

/**
 * What to print, in the order to print it.
 *
 * Boards first, biggest first: they are the long prints, and the biggest one is the one most likely to show that
 * the bed, the wall or the plan is wrong, so it is the one to find out about first. Then the mounts, which are
 * quick and can be printed while the boards go up.
 */
export function printOrder(plan, system, wallMm, t) {
  const steps = [];
  for (const group of plan.groups) {
    const source = boardSource(group.cols, group.rows);
    steps.push({
      kind: "board",
      name: t("list.board", { cols: group.cols, rows: group.rows }),
      detail: boardLabel(group, t),
      count: group.count,
      widthMm: group.widthMm,
      heightMm: group.heightMm,
      mirror: mirrorNote(group, t),
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
      name: t(item.name),
      detail: t("list.offTheWall", { mm: wallMm }),
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
export const planTitle = (plan, t) => t("list.planTitle", { size: size(plan.widthMm, plan.heightMm) });

/**
 * The whole plan as plain text. `context` carries what the plan itself doesn't know: the printer, the mount system
 * and the distance from the wall.
 */
export function partListText(plan, context) {
  const { printer, system, wallMm, strategy, t } = context;
  const steps = printOrder(plan, system, wallMm, t);
  const buy = toBuy(plan, system);
  const out = [];
  const line = (text = "") => out.push(text);
  const rule = (text) => {
    line();
    line(text.toUpperCase());
    line("-".repeat(text.length));
  };

  line(planTitle(plan, t));
  line(t("list.plannedWith"));

  rule(t("list.theWall"));
  const field = (label, value) => line(`  ${t(label).padEnd(17)}${value}`);
  field("list.space", t("list.spaceValue", { width: mm(plan.widthMm), height: mm(plan.heightMm) }));
  field(
    "list.covered",
    size(plan.coveredWidthMm, plan.coveredHeightMm) +
      (plan.leftoverWidthMm || plan.leftoverHeightMm
        ? t("list.leaving", { across: mm(plan.leftoverWidthMm), down: mm(plan.leftoverHeightMm) })
        : t("list.wholeOfIt")),
  );
  field(
    "list.boards",
    `${plural(t, plan.boards.length, "list.board.one", "list.board.many")}, ` +
      t("list.acrossDown", { across: plan.columns.length, down: plan.rows.length }),
  );
  field("list.printer", t("list.printerValue", { printer: t(printer.name), x: printer.x, y: printer.y }));
  field("list.layout", t(strategy.name));
  field("list.heldBy", t("list.heldByValue", { system: t(system.name), mm: wallMm }));

  rule(t("list.printInThisOrder"));
  for (const step of steps) {
    const flip = step.mirror ? `, ${step.mirror}` : "";
    line(`  ${String(step.step).padStart(2)}. ${step.count} × ${step.name}${flip}`);
    line(`      ${step.detail}`);
    if (step.file) {
      line(`      ${t("list.file", { file: step.file })}${step.turned ? t("list.turned") : ""}`);
    }
    if (step.from) line(`      ${t("list.from", { from: step.from })}`);
    if (step.missing) line(`      ${t("list.notPublished")}`);
  }
  line();
  line(
    `  ${t("list.toPrintInAll", {
      parts: plural(
        t,
        steps.reduce((total, step) => total + step.count, 0),
        "list.part.one",
        "list.part.many",
      ),
    })}`,
  );
  line(`  ${t("list.printOneFirst")}`);

  if (steps.some((step) => step.mirror)) {
    rule(t("list.mirroring"));
    for (const part of ["list.mirroring.1", "list.mirroring.2", "list.mirroring.3"]) line(`  ${t(part)}`);
  }

  if (buy.length) {
    rule(t("list.buy"));
    for (const item of buy) line(`  ${String(item.count).padStart(4)} × ${t(item.name)}`);
  }

  rule(t("list.whereFilesComeFrom"));
  line(`  ${t("list.boardsFrom")} ${BOARD_DESIGN.name} — ${BOARD_DESIGN.author.name}`);
  line(`           ${BOARD_DESIGN.url}`);
  line(`  ${t("list.mountsFrom")} ${system.design.name}`);
  line(`           ${system.design.url}`);
  if (steps.some((step) => step.modelKey?.startsWith("single"))) {
    line(`           ${MOUNT_DESIGNS.single.name}`);
    line(`           ${MOUNT_DESIGNS.single.url}`);
  }
  line();
  line(`  ${t("list.credit", { author: BOARD_DESIGN.author.name })}`);
  return out.join("\n");
}

/** The same thing, shortened for a model's description, which sits above a page rather than in a file. */
export function describePlan(plan, context) {
  const { printer, system, wallMm, strategy, t } = context;
  const steps = printOrder(plan, system, wallMm, t);
  const out = [];
  out.push(
    t("describe.summary", {
      boards: plural(t, plan.boards.length, "list.board.one", "list.board.many"),
      size: size(plan.widthMm, plan.heightMm),
      across: plan.columns.length,
      down: plan.rows.length,
      printer: t(printer.name),
      layout: t(strategy.name),
      system: t(system.name).toLowerCase(),
      mm: wallMm,
    }),
  );
  out.push("");
  out.push(t("describe.printInThisOrder"));
  for (const step of steps) {
    const flip = step.mirror ? ` (${step.mirror})` : "";
    const file = step.file ? t("describe.file", { file: step.file }) + (step.turned ? t("list.turned") : "") : "";
    out.push(`${step.step}. ${step.count} × ${step.name}${flip} — ${step.detail}${file}`);
  }
  const buy = toBuy(plan, system);
  if (buy.length) {
    out.push("");
    out.push(t("describe.buy", { items: buy.map((item) => `${item.count} × ${t(item.name)}`).join(", ") }));
  }
  out.push("");
  out.push(t("describe.credit", { author: BOARD_DESIGN.author.name, url: BOARD_DESIGN.url }));
  return out.join("\n");
}
