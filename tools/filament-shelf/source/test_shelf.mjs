// Tests for colour.js and shelf.js. Run from the tool's folder: node source/test_shelf.mjs

import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketOf, colourDistance, deltaE2000, hexToLab, nameOf, normaliseHex } from "./colour.js";
import {
  CLOSE,
  SAME,
  amountPercent,
  bestSpool,
  currentEdit,
  forgetReads,
  family,
  grade,
  isNeedsValue,
  needsKey,
  profileKey,
  isSpool,
  listNames,
  loadForModel,
  matchAll,
  missingOnShelf,
  needsFor,
  newId,
  people,
  pickFile,
  prefillFor,
  readAll,
  spoolValue,
  spoolsOf,
  writesInTurn,
} from "./shelf.js";

const me = { id: "me", name: "Ann", avatarUrl: null };
const dad = { id: "dad", name: "Dad", avatarUrl: null };
const mum = { id: "mum", name: "Mum", avatarUrl: null };

const spool = (material, color, more = {}) =>
  spoolValue({ brand: "Bambu Lab", line: "", material, colorName: "", color, left: "full", ...more });
let entries = 0;
function entry(key, user, value, mine = false, updatedAt = "2026-11-01T12:00:00.000Z") {
  entries += 1;
  return { key, user, mine, value, modelId: null, updatedAt, cursor: `c${entries}` };
}

test("hexes come out as #RRGGBB, whatever shape they went in", () => {
  assert.equal(normaliseHex("#f3f2ee"), "#F3F2EE");
  assert.equal(normaliseHex("abc"), "#AABBCC");
  assert.equal(normaliseHex("#FFFFFFFF"), "#FFFFFF");
  assert.equal(normaliseHex(" #1b1b1d "), "#1B1B1D");
  assert.equal(normaliseHex("#12345"), null);
  assert.equal(normaliseHex("red"), null);
  assert.equal(normaliseHex(null), null);
});

test("sRGB to L*a*b* puts white at 100 and black at 0", () => {
  const [L, a, b] = hexToLab("#FFFFFF");
  assert.ok(Math.abs(L - 100) < 0.01 && Math.abs(a) < 0.01 && Math.abs(b) < 0.01);
  assert.deepEqual(hexToLab("#000000"), [0, 0, 0]);
  // A known red, as colour references give it.
  const red = hexToLab("#FF0000");
  assert.ok(Math.abs(red[0] - 53.24) < 0.05 && Math.abs(red[1] - 80.09) < 0.05 && Math.abs(red[2] - 67.2) < 0.05);
});

test("CIEDE2000 gives the published values for the reference pairs", () => {
  // From Sharma, Wu and Dalal's test data for CIEDE2000, which covers the hue wrap-around and the neutral cases.
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, expected] of pairs) {
    assert.ok(Math.abs(deltaE2000(a, b) - expected) < 1e-4, `${a} / ${b}: ${deltaE2000(a, b)}, not ${expected}`);
    assert.ok(Math.abs(deltaE2000(b, a) - expected) < 1e-4, "the same either way round");
  }
  assert.equal(colourDistance("#1B1B1D", "#1b1b1d"), 0);
  assert.ok(Math.abs(colourDistance("#FFFFFF", "#000000") - 100) < 0.01);
});

test("a colour gets the plain name it's nearest", () => {
  assert.equal(nameOf("#F3F2EE"), "white");
  assert.equal(nameOf("#1B1B1D"), "black");
  assert.equal(nameOf("#C62828"), "red");
  assert.equal(nameOf("#1F5FBF"), "blue");
  assert.equal(nameOf("#34363A"), "darkGrey");
  assert.equal(bucketOf("#34363A"), "black");
  assert.equal(bucketOf("#9AA0A6"), "grey");
});

test("materials fall into families, whatever the brand calls them", () => {
  for (const name of ["PLA", "PLA Basic", "pla matte", "PLA+", "PLA Silk", "Silk PLA", "PLA-CF"])
    assert.equal(family(name), "PLA");
  for (const name of ["PETG", "PETG HF", "PETG-CF", "PET-G", "petg translucent"]) assert.equal(family(name), "PETG");
  for (const name of ["TPU", "TPU 95A", "TPU95A", "TPU for AMS"]) assert.equal(family(name), "TPU");
  for (const name of ["PA", "PA-CF", "PA6-GF", "PA12", "PAHT-CF", "Nylon"]) assert.equal(family(name), "PA");
  assert.equal(family("ABS-GF"), "ABS");
  assert.equal(family("ASA Aero"), "ASA");
  assert.equal(family("PC FR"), "PC");
  assert.equal(family("PVA"), "PVA");
  assert.equal(family("HIPS"), "HIPS");
  // Unknown ones are their own, and close cousins aren't swept in.
  assert.equal(family("pctg"), "PCTG");
  assert.equal(family("PPA-CF"), "PPA-CF");
  assert.equal(family("  wood  fill "), "WOOD FILL");
  assert.equal(family(""), null);
  assert.equal(family(null), null);
});

test("only a whole spool counts: anyone can write anything under a spool's key", () => {
  const good = spool("PLA", "#f3f2ee", { colorName: " Jade White ", grams: 600 });
  assert.equal(good.color, "#F3F2EE");
  assert.equal(good.colorName, "Jade White");
  // Weighed, so the rough amount goes.
  assert.equal(good.left, null);
  assert.ok(isSpool(good));
  assert.ok(isSpool(spool("PETG", "#000000", { left: null })));
  assert.ok(!isSpool(null));
  assert.ok(!isSpool("spool"));
  assert.ok(!isSpool([good]));
  assert.ok(!isSpool({ ...good, color: "blue" }));
  assert.ok(!isSpool({ ...good, color: "#fff" }));
  assert.ok(!isSpool({ ...good, material: "  " }));
  assert.ok(!isSpool({ ...good, left: "most" }));
  assert.ok(!isSpool({ ...good, grams: -1 }));
  assert.ok(!isSpool({ ...good, grams: "600" }));
  assert.ok(!isSpool({ ...good, brand: 5 }));
  assert.ok(!isSpool({ ...good, note: undefined }));
  assert.ok(!isSpool({ ...good, brand: "x".repeat(201) }));

  const list = [
    entry("spool:a", me, good, true),
    entry("spool:b", dad, { ...good, color: null }),
    entry("spool:c", null, good),
    entry("other:d", dad, good),
  ];
  assert.deepEqual(
    spoolsOf(list).map((e) => e.key),
    ["spool:a"],
  );
});

test("a spool's bar shows its weight against a kilo, or roughly", () => {
  assert.equal(amountPercent(spool("PLA", "#fff000", { grams: 600 })), 60);
  assert.equal(amountPercent(spool("PLA", "#fff000", { grams: 2500 })), 100);
  assert.equal(amountPercent(spool("PLA", "#fff000", { left: "half" })), 50);
  assert.equal(amountPercent(spool("PLA", "#fff000", { left: "low" })), 12);
  assert.equal(amountPercent(spool("PLA", "#fff000", { left: null })), null);
});

test("people are the reader first, then whoever has a spool, by name", () => {
  const list = [
    entry("spool:1", mum, spool("PLA", "#000000")),
    entry("spool:2", dad, spool("PLA", "#000000")),
    entry("spool:3", dad, spool("PLA", "#FFFFFF")),
    entry("needs:m", mum, { filaments: null }),
    entry("spool:4", { id: "zed", name: "Zed" }, { broken: true }),
  ];
  const everyone = people(list);
  assert.deepEqual(
    everyone.map((p) => p.key),
    ["me", "u:dad", "u:mum"],
  );
  // The reader has nothing here, so only "mine" says who they are.
  assert.equal(everyone[0].id, null);
  assert.equal(people([...list, entry("needs:x", me, { filaments: null }, true)])[0].name, "Ann");
  // Thingport says who's signed in, so the reader has their name before they share anything.
  assert.deepEqual(people(list, me)[0], { ...me, key: "me", mine: true });
});

const profileModel = {
  id: "m1",
  name: "Dragon box",
  files: [
    { id: "f0", name: "dragon.stl", profile: null },
    {
      id: "f1",
      name: "dragon.3mf",
      profile: {
        name: "0.2mm layer, 3 colours",
        printer: "Bambu Lab P1S",
        filaments: [
          { type: "PLA", color: "#F3F2EE", grams: 12, brand: "Bambu Lab" },
          { type: "PLA", color: "#1B1B1D", grams: 40, brand: null },
          { type: "PLA", color: "#C62828", grams: 8, brand: null },
        ],
        plates: [
          {
            index: 1,
            name: null,
            filaments: [
              { type: "PLA", color: "#F3F2EE", grams: 12, brand: null },
              { type: "PLA", color: "#1B1B1D", grams: 20, brand: null },
            ],
          },
          {
            index: 2,
            name: null,
            filaments: [
              { type: "PLA", color: "#1B1B1D", grams: 20, brand: null },
              { type: "PLA", color: "#C62828", grams: 8, brand: null },
            ],
          },
        ],
      },
    },
    {
      id: "f2",
      name: "dragon-mono.3mf",
      profile: {
        name: "Mono",
        printer: null,
        filaments: [{ type: "PETG", color: null, grams: null, brand: null }],
        plates: [],
      },
    },
  ],
};

test("the file shown is the one picked, else the first print profile", () => {
  assert.equal(pickFile(profileModel, "f2").id, "f2");
  assert.equal(pickFile(profileModel, "f0").id, "f0");
  assert.equal(pickFile(profileModel, undefined).id, "f1");
  assert.equal(pickFile(profileModel, "gone").id, "f1");
  assert.equal(pickFile({ files: [] }, "x"), null);
});

test("a model needs its profile's filaments, with the plates each is on", () => {
  const needs = needsFor(profileModel, "f1", null);
  assert.deepEqual(
    needs.map((n) => [n.type, n.color, n.grams, n.plates]),
    [
      ["PLA", "#F3F2EE", 12, [1]],
      ["PLA", "#1B1B1D", 40, [1, 2]],
      ["PLA", "#C62828", 8, [2]],
    ],
  );
  assert.equal(needs[0].brand, "Bambu Lab");
  // One plate, so no plate is named.
  assert.deepEqual(needsFor(profileModel, "f2", null)[0].plates, []);
  assert.deepEqual(needsFor(profileModel, "f0", null), []);
  // An edit takes the profile's place, keeping the plates where a filament is still the profile's.
  const edited = needsFor(profileModel, "f1", { filaments: [{ type: "PLA Matte", color: "#1B1B1D", grams: null }] });
  assert.deepEqual(edited[0].plates, [1, 2]);
  assert.equal(edited[0].brand, null);
  // A weight no edit could keep isn't one: the profile's filaments, edited as they are, still make an edit.
  const heavy = {
    id: "m2",
    files: [
      {
        id: "h1",
        name: "heavy.3mf",
        folder: null,
        profile: { id: null, filaments: [{ type: "PLA", color: "#FFFFFF", grams: 250000, brand: null }], plates: [] },
      },
    ],
  };
  const read = needsFor(heavy, "h1", null);
  assert.equal(read[0].grams, null);
  const filaments = read.map(({ type, color, grams }) => ({ type, color, grams }));
  assert.ok(isNeedsValue({ profile: "file:heavy.3mf", filaments }));
});

test("the newest edit of the picked profile wins, and a newer reset puts the profile back", () => {
  const profile = "profile:p1";
  const edit = (user, mine, at, filaments, of = profile) =>
    entry(needsKey(user.id, of), user, { profile: of, filaments }, mine, at);
  const red = [{ type: "PLA", color: "#C62828", grams: 8 }];
  const blue = [{ type: "PETG", color: "#1F5FBF", grams: null }];
  assert.equal(currentEdit([], profile), null);
  const won = currentEdit(
    [
      edit(me, true, "2026-11-02T00:00:00.000Z", red),
      edit(dad, false, "2026-11-03T00:00:00.000Z", blue),
      // Another profile's, however new, isn't this one's.
      edit(dad, false, "2026-11-09T00:00:00.000Z", red, "file:dragon.3mf"),
    ],
    profile,
  );
  assert.deepEqual(won.filaments, blue);
  assert.equal(won.user, dad);
  assert.equal(
    currentEdit(
      [edit(dad, false, "2026-11-03T00:00:00.000Z", blue), edit(me, true, "2026-11-04T00:00:00.000Z", null)],
      profile,
    ),
    null,
  );
  // A malformed one, however new, is skipped.
  const bad = entry("needs:x", mum, { profile, filaments: [{ type: 5 }] }, false, "2026-12-01T00:00:00.000Z");
  assert.deepEqual(currentEdit([bad, edit(me, true, "2026-11-02T00:00:00.000Z", red)], profile).filaments, red);
  assert.ok(isNeedsValue({ profile, filaments: [] }));
  assert.ok(!isNeedsValue({ filaments: [] }));
  assert.ok(!isNeedsValue({ profile, filaments: [{ type: "PLA", color: "#c62828", grams: "8" }] }));
  assert.ok(!isNeedsValue({}));
  // A profile is known by the provider's id in every copy, else by the file's folder and name; its key is a valid one.
  assert.equal(profileKey({ name: "a.3mf", folder: "Left", profile: { id: "p1" } }), "profile:p1");
  assert.equal(profileKey({ name: "a b.3mf", folder: null, profile: null }), "file:a b.3mf");
  // One name in two folders is two profiles.
  assert.equal(profileKey({ name: "part.3mf", folder: "USB C/Handles", profile: null }), "file:USB C/Handles/part.3mf");
  assert.notEqual(
    needsKey("m1", profileKey({ name: "part.3mf", folder: "A", profile: null })),
    needsKey("m1", profileKey({ name: "part.3mf", folder: "B", profile: null })),
  );
  // The longest folder and name a file can have still make an edit that's read.
  const deep = profileKey({ name: `${"n".repeat(251)}.3mf`, folder: "f".repeat(500), profile: null });
  assert.ok(isNeedsValue({ profile: deep, filaments: [] }));
  assert.match(needsKey("m1", "file:a b (2).3mf"), /^needs:m1:[0-9a-z]+$/);
  // These two shared a key when it was one 32-bit hash.
  assert.notEqual(needsKey("m1", "file:aZCB.3mf"), needsKey("m1", "file:aZBc.3mf"));
});

test("a spool matches on its material family and how close its colour looks", () => {
  const white = { type: "PLA", color: "#F3F2EE", grams: 12, plates: [] };
  assert.equal(grade(white, spool("PLA Matte", "#FFFFFF")).grade, "same");
  assert.equal(grade(white, spool("PETG", "#F3F2EE")), null);
  assert.equal(grade(white, spool("PLA", "#C62828")), null);
  const black = { type: "PLA", color: "#1B1B1D" };
  const charcoal = grade(black, spool("PLA", "#34363A"));
  assert.equal(charcoal.grade, "close");
  assert.ok(charcoal.delta > SAME && charcoal.delta <= CLOSE);
  // No colour asked for: any colour of the material is the same; no material: any material.
  assert.deepEqual(grade({ type: "PETG", color: null }, spool("PETG HF", "#1F5FBF")), { grade: "same", delta: 0 });
  assert.equal(grade({ type: null, color: "#C62828" }, spool("ABS", "#C62828")).grade, "same");
  // A spool weighed at 0 g has none left; one never weighed still counts.
  assert.equal(grade(white, spool("PLA", "#F3F2EE", { left: null, grams: 0 })), null);
  assert.equal(grade(white, spool("PLA", "#F3F2EE", { left: null, grams: null })).grade, "same");
});

test("each person's best spool: the same beats close, then the nearer colour", () => {
  const black = { type: "PLA", color: "#1B1B1D" };
  const near = entry("spool:near", dad, spool("PLA", "#2A2A2C"));
  const nearer = entry("spool:nearer", dad, spool("PLA", "#1C1C1E"));
  const close = entry("spool:close", dad, spool("PLA", "#34363A"));
  assert.equal(bestSpool(black, [close, near, nearer]).entry.key, "spool:nearer");
  assert.equal(bestSpool(black, [close]).grade, "close");
  assert.equal(bestSpool(black, []), null);
});

test("the household has a model's filaments together, each person some of them", () => {
  const list = [
    entry("spool:w", me, spool("PLA", "#F3F2EE"), true),
    entry("spool:c", me, spool("PLA", "#34363A"), true),
    entry("spool:b", me, spool("PETG HF", "#1F5FBF"), true),
    entry("spool:k", dad, spool("PLA", "#1B1B1D")),
    entry("spool:r", dad, spool("PLA+", "#C62828")),
    entry("spool:g", dad, spool("PETG", "#232A33")),
  ];
  const spools = spoolsOf(list);
  const everyone = people(list);
  const needs = needsFor(profileModel, "f1", null);
  const match = matchAll(needs, spools, everyone);
  assert.deepEqual(match.counts, [2, 2]);
  assert.equal(match.have, 3);
  assert.equal(match.count, 3);
  assert.deepEqual(match.missing, []);
  assert.deepEqual(
    match.rows.map((row) => row.cells.map((cell) => cell && `${cell.grade}:${cell.entry.key}`)),
    [
      ["same:spool:w", null],
      ["close:spool:c", "same:spool:k"],
      [null, "same:spool:r"],
    ],
  );
  // Without Dad's, red is missing, and the reader's own shelf lacks it either way.
  const alone = matchAll(
    needs,
    spools.filter((e) => e.mine),
    people(list.filter((e) => e.mine)),
  );
  assert.equal(alone.have, 2);
  assert.deepEqual(
    alone.missing.map((n) => n.color),
    ["#C62828"],
  );
  assert.deepEqual(
    missingOnShelf(needs, spools).map((n) => n.color),
    ["#C62828"],
  );
});

test("a spool for a needed filament starts from its material and colour", () => {
  assert.deepEqual(prefillFor({ type: "PLA Matte", color: "#1B1B1D", brand: "Bambu Lab" }), {
    brand: "Bambu Lab",
    line: "PLA Matte",
    material: "PLA",
    colorName: "",
    color: "#1B1B1D",
    left: "full",
    grams: null,
    note: "",
  });
  assert.equal(prefillFor({ type: "PA-CF", color: null, brand: null }).material, "PA");
  assert.equal(prefillFor({ type: "PCTG", color: null, brand: null }).line, "");
  assert.equal(prefillFor({ type: null, color: null, brand: null }).material, "PLA");
});

test("every page of entries is read, however many there are", async () => {
  const all = Array.from({ length: 12 }, (_, i) => ({ key: `spool:${i}`, cursor: String(i) }));
  const asked = [];
  const shared = {
    async list(options) {
      asked.push(options);
      const from = options.before === undefined ? 0 : Number(options.before) + 1;
      return all.slice(from, from + 5);
    },
  };
  const read = await readAll(shared, { prefix: "spool:" }, 5);
  assert.equal(read.length, 12);
  assert.deepEqual(asked, [{ prefix: "spool:" }, { prefix: "spool:", before: "4" }, { prefix: "spool:", before: "9" }]);
  // A page short of full is the last.
  asked.length = 0;
  assert.equal((await readAll(shared, { prefix: "spool:" }, 6)).length, 5);
  assert.equal(asked.length, 1);
});

test("a model's page reads the model, everyone's spools and the edits about it, once for all its parts", async () => {
  forgetReads();
  await Promise.resolve();
  const asked = [];
  let gets = 0;
  const shared = {
    async list(options) {
      asked.push(options);
      if (options.prefix === "spool:") return [entry("spool:r", dad, spool("PLA", "#C62828"))];
      return [
        entry("needs:m1:x", dad, {
          profile: "file:dragon.3mf",
          filaments: [{ type: "PLA", color: "#C62828", grams: 8 }],
        }),
      ];
    },
  };
  const models = {
    get: async (id) => {
      gets += 1;
      return { ...profileModel, id };
    },
  };
  const [data] = await Promise.all([
    loadForModel({ models, shared, user: me }, "m1", "f1"),
    loadForModel({ models, shared, user: me }, "m1", "f1"),
  ]);
  assert.deepEqual(asked, [{ prefix: "spool:" }, { prefix: "needs:", model: "m1" }]);
  assert.equal(gets, 1);
  assert.equal(data.everyone[0].name, "Ann");
  // A change on the page reads them again, once for every part that hears it.
  forgetReads();
  await Promise.all([
    loadForModel({ models, shared, user: me }, "m1", "f1"),
    (forgetReads(), loadForModel({ models, shared, user: me }, "m1", "f1")),
  ]);
  assert.equal(gets, 2);
  // The next change, however soon, is forgotten for too.
  await Promise.resolve();
  forgetReads();
  await loadForModel({ models, shared, user: me }, "m1", "f1");
  assert.equal(gets, 3);
  // Another account reading at once reads for itself.
  await loadForModel({ models, shared, user: dad }, "m1", "f1");
  assert.equal(gets, 4);
  assert.equal(data.file.id, "f1");
  assert.equal(data.edit.user, dad);
  assert.equal(data.needs.length, 1);
  assert.deepEqual(data.match.counts, [0, 1]);
});

test("ids are short and differ", () => {
  assert.equal(
    newId(0, () => 0.5),
    "0i",
  );
  assert.notEqual(newId(), newId());
});

test("names are listed the way a sentence would", () => {
  assert.equal(listNames([], "and"), "");
  assert.equal(listNames(["PLA Red"], "and"), "PLA Red");
  assert.equal(listNames(["A", "B", "C"], "and"), "A, B and C");
});

test("writes to one key go in the order they were made", async () => {
  const inTurn = writesInTurn();
  const order = [];
  const slow = inTurn("k", () => new Promise((done) => setTimeout(() => done(order.push("first")), 20)));
  const fast = inTurn("k", async () => order.push("second"));
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["first", "second"]);
  await assert.rejects(inTurn("k", async () => Promise.reject(new Error("no"))));
  await inTurn("k", async () => order.push("after a failure"));
  assert.deepEqual(order, ["first", "second", "after a failure"]);
});
