import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Runs the checker against the given locale files, in a copy of its folder layout. */
function check(locales, args) {
  const root = mkdtempSync(join(tmpdir(), "thingport-i18n-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src/i18n/locales"), { recursive: true });
    for (const file of ["i18n-check.mjs", "plural-forms.mjs"]) {
      copyFileSync(new URL(file, import.meta.url), join(root, "scripts", file));
    }
    for (const [code, content] of Object.entries(locales)) {
      writeFileSync(join(root, "src/i18n/locales", `${code}.json`), JSON.stringify(content));
    }
    const run = spawnSync(process.execPath, [join(root, "scripts/i18n-check.mjs"), ...args], { encoding: "utf8" });
    return { status: run.status, output: run.stdout + run.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("i18n checker", () => {
  it("requires plain keys for lookups without count even when plural keys exist", () => {
    const { output } = check(
      {
        en: { models: { customizer: { pick: { title: "Title", body: "{{count}} scripts" } } } },
        ru: {
          models: {
            customizer: {
              pick: { title_one: "Заголовок", body_one: "один", body_few: "несколько", body_many: "много" },
            },
          },
        },
      },
      ["ru"],
    );
    expect(output).toContain("missing  models.customizer.pick.title");
    expect(output).not.toContain("missing  models.customizer.pick.body");
    // English's title isn't counted, so a translator's title_one is a leftover to remove.
    expect(output).toContain("unused   models.customizer.pick.title_one");
    expect(output).not.toContain("unused   models.customizer.pick.body_");
  });

  it("fails with --strict on a key missing from a locale or left in one, and only lists them without it", () => {
    const locales = { en: { a: "A", b: "B" }, de: { a: "A", old: "Alt" } };
    const strict = check(locales, ["--strict"]);
    expect(strict.status).toBe(1);
    expect(strict.output).toContain("missing  b");
    expect(strict.output).toContain("unused   old");
    expect(check(locales, []).status).toBe(0);
    // Either alone fails it as well.
    expect(check({ en: { a: "A", b: "B" }, de: { a: "A" } }, ["--strict"]).status).toBe(1);
    expect(check({ en: { a: "A" }, de: { a: "A", old: "Alt" } }, ["--strict"]).status).toBe(1);
  });

  it("passes with --strict when every locale has every key", () => {
    expect(check({ en: { a: "A", b: "B" }, de: { a: "A", b: "B" } }, ["--strict"]).status).toBe(0);
    // A locale code beside the flag still checks that locale alone.
    expect(check({ en: { a: "A" }, de: { a: "A" }, fr: {} }, ["de", "--strict"]).status).toBe(0);
  });
});
