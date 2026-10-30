// Points every copy of a tool's models at the tool's own files, and takes the copies back.
//
// A tool that brings models used to give each user a copy of every file: a planner with two hundred parts cost its
// own size again for each user who could open it. They now read the tool's files where they lie (a plate's
// sourcePath), so this reclaims what the copies took. Run from backend/:
//
//   npx tsx scripts/shareToolModelFiles.ts            # says what it would free, changes nothing
//   npx tsx scripts/shareToolModelFiles.ts --apply    # points them at the tool's files and removes the copies
//
// A copy is only taken back when the tool's own file is there and is the same size, so anything it can't account
// for is listed and left alone. Models the user made with a tool are not touched: this is only what a tool brought.

import fs from "node:fs/promises";
import path from "node:path";
import { STORAGE } from "../src/config";
import { prisma } from "../src/db";

const apply = process.argv.includes("--apply");
const MODEL_INFO = "model.json";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function sizeOf(file: string): Promise<number | null> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

async function main() {
  const tools = await prisma.tool.findMany({
    where: { source: "repo", modelsSha: { not: null } },
    select: { id: true, slug: true, modelsSha: true },
  });
  if (!tools.length) {
    console.log("No installed tool brings models.");
    return;
  }

  let freed = 0;
  let pointed = 0;
  const unaccounted: string[] = [];

  for (const tool of tools) {
    const dir = path.join(STORAGE, "tools", tool.slug, (tool.modelsSha ?? "none").slice(0, 16));
    const prints = await prisma.print.findMany({
      where: { toolId: tool.id },
      select: { id: true, name: true, toolKey: true, userId: true, plates: { orderBy: { position: "asc" } } },
    });
    if (!prints.length) continue;
    console.log(`\n${tool.slug}: ${prints.length} models across every user`);

    for (const print of prints) {
      if (!print.toolKey) continue;
      // The tool's own list of the files it fetched, in the order the plates were made from them.
      let files: string[] = [];
      try {
        const info = JSON.parse(await fs.readFile(path.join(dir, print.toolKey, MODEL_INFO), "utf8"));
        files = Array.isArray(info.files) ? info.files : [];
      } catch {
        unaccounted.push(`${tool.slug}/${print.toolKey}: the tool has no record of its files`);
        continue;
      }

      for (const plate of print.plates) {
        if (plate.sourcePath) continue; // already reading the tool's file
        const source = path.join(dir, print.toolKey, "files", files[plate.position] ?? plate.filename);
        const theirs = path.join(STORAGE, plate.storagePath);
        const [sourceSize, copySize] = await Promise.all([sizeOf(source), sizeOf(theirs)]);
        if (sourceSize === null) {
          unaccounted.push(`${print.name}: the tool's own ${path.basename(source)} isn't there`);
          continue;
        }
        if (copySize !== null && copySize !== sourceSize) {
          unaccounted.push(`${print.name}: the copy and the tool's file differ in size, so it was left alone`);
          continue;
        }
        pointed++;
        if (copySize !== null) freed += copySize;
        if (!apply) continue;
        await prisma.plate.update({ where: { id: plate.id }, data: { sourcePath: source } });
        // Only now, so a failure leaves a copy that still works rather than a model with no file at all.
        if (copySize !== null) await fs.rm(theirs, { force: true });
      }
    }
  }

  console.log(
    `\n${pointed} file${pointed === 1 ? "" : "s"} ${apply ? "now read" : "would read"} the tool's own copy, ` +
      `${apply ? "freeing" : "which would free"} ${mb(freed)}.`,
  );
  if (unaccounted.length) {
    console.log(`\nLeft alone (${unaccounted.length}):`);
    for (const line of unaccounted.slice(0, 20)) console.log(`  ${line}`);
    if (unaccounted.length > 20) console.log(`  … and ${unaccounted.length - 20} more`);
  }
  if (!apply && pointed) console.log("\nRun it again with --apply to make the change.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
