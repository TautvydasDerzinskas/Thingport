// Lists each locale's keys missing from, or no longer in, en.json: `npm run i18n:check [code]`.
// A plural key (key_one, key_other, ...) needs every form the locale uses for whole-number counts.
import { readdirSync, readFileSync } from "node:fs";
import { pluralForms } from "./plural-forms.mjs";

const dir = new URL("../src/i18n/locales/", import.meta.url);
const PLURAL = /_(zero|one|two|few|many|other)$/;

function keys(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === "object" ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

const read = (code) => keys(JSON.parse(readFileSync(new URL(`${code}.json`, dir), "utf8")));

const plurals = new Set();
const plain = [];
for (const key of read("en")) {
  if (PLURAL.test(key)) plurals.add(key.replace(PLURAL, ""));
  else plain.push(key);
}
// English has a single string for these lookups, but every caller supplies count.
const pluralOnly = new Set([
  "app.studio.prompt.limit",
  "models.aiCategorization.acceptDone",
  "models.aiCategorization.rejectDone",
  "models.customizer.pick.body",
  "models.selection.count",
]);

const only = process.argv[2];
const codes = readdirSync(dir)
  .filter((file) => file.endsWith(".json") && file !== "en.json")
  .map((file) => file.slice(0, -".json".length))
  .filter((code) => !only || code === only);

if (only && codes.length === 0) {
  console.error(`No src/i18n/locales/${only}.json`);
  process.exit(1);
}

for (const code of codes) {
  const forms = [...pluralForms(code)];
  const localeLeaves = read(code);
  const localizedPlurals = new Set(
    localeLeaves.filter((key) => PLURAL.test(key)).map((key) => key.replace(PLURAL, "")),
  );
  const en = new Set([
    ...plain.flatMap((key) =>
      pluralOnly.has(key) && localizedPlurals.has(key) ? forms.map((form) => `${key}_${form}`) : [key],
    ),
    ...[...plurals].flatMap((base) => forms.map((form) => `${base}_${form}`)),
  ]);
  // Extra plural forms a translator added (Lithuanian `_many`) aren't stale, just unused by this locale's whole numbers.
  // Only a word English counts has them: `title_one` beside English's plain `title` is a leftover.
  const locale = new Set(
    localeLeaves.filter((key) => {
      const base = key.replace(PLURAL, "");
      return en.has(key) || !(PLURAL.test(key) && (plurals.has(base) || pluralOnly.has(base)));
    }),
  );
  const missing = [...en].filter((key) => !locale.has(key));
  const stale = [...locale].filter((key) => !en.has(key));
  const done = Math.floor(((en.size - missing.length) / en.size) * 100);
  console.log(`${code}: ${done}% translated, ${missing.length} missing, ${stale.length} no longer used`);
  for (const key of missing) console.log(`  missing  ${key}`);
  for (const key of stale) console.log(`  unused   ${key}`);
}
