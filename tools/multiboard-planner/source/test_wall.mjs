// Drawing a wall: that the pieces come back in the order they are printed however the renders finish, that
// several really are drawn at once, that the count counts each piece once, and that cancelling stops it.
//
//   node source/test_wall.mjs
import { buildWall } from "../tool.js";

const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

/** A stand-in for the engine: every plate takes a different moment, so a slow one finishes after a fast one. */
function fakeScad(concurrency, { delays = {} } = {}) {
  let inFlight = 0;
  let most = 0;
  return {
    concurrency,
    peak: () => most,
    async render(_script, { parameters, signal }) {
      inFlight++;
      most = Math.max(most, inFlight);
      const cells = parameters.cells;
      await new Promise((done, fail) => {
        const timer = setTimeout(done, delays[cells] ?? 1);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          fail(new Error("cancelled"));
        });
      });
      inFlight--;
      // One triangle is enough: this is about the order, not the geometry.
      return {
        mesh: { vertices: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), triangles: new Uint32Array([0, 1, 2]) },
        log: [],
      };
    },
  };
}

const plan = {
  plates: [2, 3, 4, 5, 6, 7].map((cells) => ({
    type: "SpecialRounded",
    size: `${cells}x${cells}`,
    name: `P${cells}`,
    quantity: cells,
  })),
  joints: [],
};
// The first plate is made the slowest, so anything that returns in completion order gets it wrong.
const delays = { 2: 60, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5 };

const scad = fakeScad(3, { delays });
const seen = [];
const files = await buildWall(scad, "ignored", plan, {
  onProgress: ({ done, total }) => seen.push(`${done}/${total}`),
});

check(files.length === 6, `six plates in, six files out (got ${files.length})`);
const order = files.map((f) => f.name);
check(
  order.every((name, i) => name.startsWith(`0${i + 1} - `)),
  `numbered in plan order, not completion order: ${order.join(", ")}`,
);
check(order[0].includes("P2"), `the slowest plate is still first: ${order[0]}`);
check(
  order.every((name) => name.endsWith(".stl")),
  "written as STL",
);
check(
  files.every((f, i) => f.name.includes(`x${i + 2}`)),
  `each name says how many to print: ${order.join(", ")}`,
);
check(scad.peak() > 1, `more than one at a time (peak was ${scad.peak()})`);
check(scad.peak() <= 3, `never more than it was allowed (peak was ${scad.peak()})`);
check(seen.at(-1) === "6/6", `the count ends full: ${seen.at(-1)}`);
check(new Set(seen).size === seen.length, `no piece counted twice: ${seen.join(" ")}`);

// Cancelling stops it rather than running on quietly.
const stop = new AbortController();
const slow = fakeScad(3, { delays: { 2: 1000, 3: 1000, 4: 1000, 5: 1000, 6: 1000, 7: 1000 } });
const started = Date.now();
setTimeout(() => stop.abort(), 20);
let stopped = "it kept going";
try {
  await buildWall(slow, "ignored", plan, { signal: stop.signal });
} catch (err) {
  stopped = err.message;
}
check(stopped === "cancelled", `cancelling says so (said "${stopped}")`);
check(Date.now() - started < 500, `cancelling doesn't wait for the renders (took ${Date.now() - started} ms)`);

console.log(`wall build: ${8 - failures.length}/8 checks passed`);
failures.forEach((f) => console.log("  FAIL " + f));
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exitCode = failures.length ? 1 : 0;
