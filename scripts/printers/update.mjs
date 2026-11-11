// Builds backend/assets/printers, the printer catalogue "Open adapted" uses, from the printer profiles of the slicers
// in sources.json. Network only here: the checkouts go in a cache outside the repo, the catalogue is committed and the
// server reads it offline.
//
//   npm run printers:update                  fetch what's missing, then rebuild
//   PRINTER_SOURCES=<dir> npm run printers:update   keep the checkouts somewhere else (default: the OS temp folder)

import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeCovers } from "./lib/covers.mjs";
import { readCuraDefinitions } from "./lib/cura.mjs";
import { checkout } from "./lib/fetch.mjs";
import { mergeCatalogue } from "./lib/merge.mjs";
import { readOrcaProfiles } from "./lib/orca.mjs";
import { readPrusaProfiles } from "./lib/prusa.mjs";
import { writeCatalogue } from "./lib/write.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "backend", "assets", "printers");
const cacheDir = process.env.PRINTER_SOURCES || path.join(os.tmpdir(), "thingport-printer-sources");

const { sources } = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "sources.json"), "utf8"),
);
const READERS = { orca: readOrcaProfiles, prusa: readPrusaProfiles, cura: readCuraDefinitions };

const reads = {};
const pinned = [];
for (const source of sources) {
  const { dir, commit } = checkout(source, cacheDir);
  reads[source.id] = READERS[source.format](dir, source);
  pinned.push({ ...source, commit });
  const models = reads[source.id].vendors.reduce((n, v) => n + v.models.length, 0);
  console.log(
    `${source.name} ${source.ref}: ${models} printers${reads[source.id].problems.length ? `, ${reads[source.id].problems.length} problems` : ""}`,
  );
}

const { printers, report, records } = mergeCatalogue(sources, reads);
const covers = await writeCovers(printers, path.join(OUT, "covers"), path.join(ROOT, "backend"));
const filaments = Object.fromEntries(sources.map((s) => [s.id, reads[s.id].filaments ?? null]));
const written = writeCatalogue(OUT, { printers, sources: pinned, covers, filaments });

const reportFile = path.join(cacheDir, "report.json");
writeFileSync(
  reportFile,
  JSON.stringify(
    {
      ...report,
      problems: Object.fromEntries(sources.map((s) => [s.id, reads[s.id].problems])),
      coverFailures: covers.failed,
    },
    null,
    1,
  ),
);
console.log(
  `${printers.length} printers of ${written.brands} brands from ${records} records; ${covers.count} pictures ` +
    `(${(covers.bytes / 1048576).toFixed(1)} MB); ${written.names} names (${written.sharedNames} shared by two printers); ` +
    `${report.bedDisagreements.length} bed and ${report.heightDisagreements.length} height disagreements (${reportFile})`,
);
