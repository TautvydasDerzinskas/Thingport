// Checks that a branch only moves code: every line it adds is a line it removes, and the other way round, imports,
// exports and new files' leading comments aside. For refactors whose pull request body shows the output, so a reader
// (and CodeRabbit, told to skip such a pull request) can trust that no behaviour changed.
//
//   node scripts/check-pure-move.mjs [base]      base defaults to origin/develop; exits 1 when anything else changed
import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "origin/develop";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const mergeBase = git("merge-base", base, "HEAD").trim();
const CODE = /\.(ts|tsx|mjs|js)$/;

/** Line numbers (1-based) of a file's import and re-export statements, and, for a new file, of the comment it starts
 *  with: that says what the new module is. */
function wiringLines(text, newFile) {
  const lines = text.split("\n");
  const wiring = new Set();
  let open = false;
  let leading = newFile;
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (leading && (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*"))) {
      wiring.add(index + 1);
      return;
    }
    if (line) leading = false;
    if (open || /^(import\s|export\s*(type\s*)?\{|export\s+\*\s+from\s)/.test(line)) {
      wiring.add(index + 1);
      open = !/;\s*$/.test(line);
    }
  });
  return wiring;
}

const show = (rev, file) => {
  try {
    // A file the revision doesn't have (a new one) reads as null.
    return execFileSync("git", ["show", `${rev}:${file}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
};

const removed = new Map();
const added = new Map();
const count = (map, line) => map.set(line, (map.get(line) ?? 0) + 1);
// A declaration that's now used from another module only gains `export`.
const bare = (line) => line.replace(/^export\s+(?=(async\s+)?(function|const|let|type|class|interface)\b)/, "");

const files = git("diff", "--name-only", "--no-renames", `${mergeBase}`, "HEAD").split("\n").filter(Boolean);
for (const file of files) {
  if (!CODE.test(file) || file === "scripts/check-pure-move.mjs") continue;
  const before = show(mergeBase, file);
  const after = show("HEAD", file);
  const oldWiring = before === null ? new Set() : wiringLines(before, false);
  const newWiring = after === null ? new Set() : wiringLines(after, before === null);
  const diff = git("diff", "--unified=0", "--no-color", "--no-renames", mergeBase, "HEAD", "--", file);
  let oldLine = 0;
  let newLine = 0;
  for (const raw of diff.split("\n")) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("-")) {
      const line = raw.slice(1).trim();
      if (line && !oldWiring.has(oldLine)) count(removed, bare(line));
      oldLine++;
    } else if (raw.startsWith("+")) {
      const line = raw.slice(1).trim();
      if (line && !newWiring.has(newLine)) count(added, bare(line));
      newLine++;
    }
  }
}

const unmatched = (from, to) =>
  [...from].flatMap(([line, n]) => Array.from({ length: Math.max(0, n - (to.get(line) ?? 0)) }, () => line));
const extraAdded = unmatched(added, removed);
const extraRemoved = unmatched(removed, added);
const moved = [...added.values()].reduce((sum, n) => sum + n, 0) - extraAdded.length;

console.log(`Compared with ${base}: ${moved} lines moved.`);
console.log(`Added lines that weren't removed: ${extraAdded.length}`);
for (const line of extraAdded.slice(0, 20)) console.log(`  + ${line}`);
console.log(`Removed lines that weren't added: ${extraRemoved.length}`);
for (const line of extraRemoved.slice(0, 20)) console.log(`  - ${line}`);
if (extraAdded.length || extraRemoved.length) process.exit(1);
console.log("Only moves: every added line is a removed one, imports and exports aside.");
