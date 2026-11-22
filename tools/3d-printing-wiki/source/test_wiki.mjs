import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { articles, byId, searchWiki } from "./articles.js";
import { history } from "./history.js";
import { printers } from "./printers.js";
import { gradeQuiz, makeAttempt, passingPoints, questionBank, questionCount, totalPoints } from "./quiz.js";
import { issueGroups, issues } from "./troubleshooting.js";

test("all cross-references resolve and pictured defects have a bundled WebP", () => {
  assert.equal(byId.size, articles.length);
  for (const article of articles) {
    for (const id of article.related) assert.ok(byId.has(id), `${article.id} links to ${id}`);
  }
  const packaged = ["../tool.js", "../tool.html"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
  const pictured = issues.filter(({ imageAlt }) => imageAlt);
  assert.equal(pictured.length, 18);
  for (const { id } of pictured) {
    const image = readFileSync(new URL(`images/${id}.webp`, import.meta.url));
    assert.equal(image.toString("ascii", 8, 12), "WEBP");
    const src = `data:image/webp;base64,${image.toString("base64")}`;
    assert.equal(packaged.filter((file) => file.includes(src)).length, 1, id);
  }
});

test("each symptom has a diagnostic check, ordered fixes and a way to verify the outcome", () => {
  assert.equal(issues.length, 32);
  assert.equal(issueGroups.length, 5);
  for (const issue of issues) {
    assert.ok(issue.check && issue.causes && issue.verify && issue.source, issue.id);
    assert.ok(issue.fixes.length >= 2, issue.id);
  }
});

test("search includes article sections and ranks title matches first", () => {
  assert.equal(searchWiki("PETG")[0].id, "petg");
  assert.equal(searchWiki("LAYER-SHIFT")[0].id, "layer-shift");
  assert.equal(searchWiki("underextrusion")[0].id, "under-extrusion");
  assert.ok(searchWiki("bed adhesion").some(({ id }) => id === "first-layer"));
  assert.ok(searchWiki("keyed joins").some(({ id }) => id === "cut-prints"));
  assert.equal(searchWiki("grinding gear")[0].id, "extruder-clicking");
  assert.equal(searchWiki("thermal runaway")[0].id, "temperature-error");
  assert.ok(searchWiki("scarf seam").some(({ id }) => id === "seam-blobs"));
  assert.ok(searchWiki("Plus4").some((entry) => entry === printers.find(({ id }) => id === "qidi")));
  assert.ok(searchWiki("Cupcake CNC").some((entry) => entry === history.find(({ id }) => id === "makerbot-history")));
  assert.equal(searchWiki("filament drying")[0].id, "filament-drying");
  assert.equal(searchWiki("layer height")[0].id, "layer-height");
  assert.ok(searchWiki("PolyLite ASA 70°C").some(({ id }) => id === "filament-drying"));
  assert.ok(searchWiki("17m 55s").some(({ id }) => id === "shell-settings"));
  assert.ok(searchWiki("shine at corners").length === 0);
  assert.deepEqual(searchWiki(""), []);
});

test("every question has valid answers and references an article", () => {
  assert.equal(questionBank.length, 108);
  assert.equal(new Set(questionBank.map(({ prompt }) => prompt)).size, questionBank.length);
  for (const { article, options, correct, points, picture } of questionBank) {
    assert.ok(byId.has(article), article);
    if (picture) assert.ok(byId.get(picture)?.imageAlt, picture);
    assert.equal(new Set(options).size, 4);
    assert.equal(correct.length, points === 3 ? 2 : 1);
    assert.equal(new Set(correct).size, correct.length);
    assert.ok(correct.every((choice) => Number.isInteger(choice) && choice >= 0 && choice < options.length));
  }
});

test("consecutive attempts have equal scoring mixes and different questions", () => {
  const first = makeAttempt([], () => 0);
  const second = makeAttempt(first, () => 0);
  const previousQuestions = new Set(first.map(({ prompt }) => prompt));
  for (const attempt of [first, second]) {
    assert.equal(attempt.length, questionCount);
    assert.equal(new Set(attempt.map(({ prompt }) => prompt)).size, questionCount);
    assert.deepEqual(
      [1, 2, 3].map((weight) => attempt.filter(({ points }) => points === weight).length),
      [20, 5, 5],
    );
    assert.deepEqual(
      [1, 2, 3].map((weight) => attempt.filter(({ points, picture }) => points === weight && picture).length),
      [2, 1, 1],
    );
  }
  assert.ok(second.every(({ prompt }) => !previousQuestions.has(prompt)));
  const original = new Map(questionBank.map((item) => [item.prompt, item]));
  for (const { prompt, options, correct } of first) {
    const expected = original.get(prompt);
    assert.deepEqual(
      correct.map((index) => options[index]),
      expected.correct.map((index) => expected.options[index]),
    );
  }
});

test("grades a multi-select only when the selected set matches and passes at 36/45", () => {
  const attempt = makeAttempt([], () => 0.25);
  const answers = attempt.map(({ correct }) => new Set(correct));
  assert.equal(questionCount, 30);
  assert.equal(totalPoints, 45);
  assert.equal(passingPoints, 36);
  assert.equal(gradeQuiz(attempt, answers).score, 45);

  const weighted = attempt.flatMap((item, index) => (item.points === 3 ? [index] : []));
  const [partial, extra, none, wrong] = weighted;
  const correct = answers[wrong];
  const distractor = attempt[wrong].options.findIndex((_, index) => !correct.has(index));
  answers[wrong] = new Set([...correct].slice(1).concat(distractor));
  assert.equal(answers[wrong].size, correct.size);
  assert.equal(gradeQuiz(attempt, answers).items[wrong].earned, 0);
  answers[wrong] = correct;

  answers[partial].delete(attempt[partial].correct[0]);
  answers[extra].add(attempt[extra].options.findIndex((_, index) => !answers[extra].has(index)));
  answers[none] = new Set();
  assert.equal(gradeQuiz(attempt, answers).score, 36);
  assert.equal(gradeQuiz(attempt, answers).passed, true);
  answers[0] = new Set();
  assert.equal(gradeQuiz(attempt, answers).score, 35);
  assert.equal(gradeQuiz(attempt, answers).passed, false);
});
