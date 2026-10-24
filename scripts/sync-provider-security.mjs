import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, "providers/credentialHosts.ts");
const destinations = [
  path.join(root, "backend/src/providers/credentialHosts.generated.ts"),
  path.join(root, "extension/src/shared/credentialHosts.generated.ts"),
];
const output = `// Generated from providers/credentialHosts.ts. Run npm run providers:security:sync.\n${readFileSync(source, "utf8")}`;
const check = process.argv.includes("--check");

for (const destination of destinations) {
  if (check) {
    let actual = "";
    try {
      actual = readFileSync(destination, "utf8");
    } catch {
      // A missing generated copy is drift too.
    }
    if (actual !== output) {
      console.error(`Provider credential hosts are out of date: ${path.relative(root, destination)}`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(destination, output);
  }
}
