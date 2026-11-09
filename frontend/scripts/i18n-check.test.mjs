import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("i18n checker", () => {
  it("requires plain keys for lookups without count even when plural keys exist", () => {
    const root = mkdtempSync(join(tmpdir(), "thingport-i18n-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, "src/i18n/locales"), { recursive: true });
      for (const file of ["i18n-check.mjs", "plural-forms.mjs"]) {
        copyFileSync(new URL(file, import.meta.url), join(root, "scripts", file));
      }
      const locales = join(root, "src/i18n/locales");
      writeFileSync(
        join(locales, "en.json"),
        JSON.stringify({ models: { customizer: { pick: { title: "Title", body: "{{count}} scripts" } } } }),
      );
      writeFileSync(
        join(locales, "ru.json"),
        JSON.stringify({
          models: {
            customizer: {
              pick: { title_one: "Заголовок", body_one: "один", body_few: "несколько", body_many: "много" },
            },
          },
        }),
      );
      const output = execFileSync(process.execPath, [join(root, "scripts/i18n-check.mjs"), "ru"], { encoding: "utf8" });
      expect(output).toContain("missing  models.customizer.pick.title");
      expect(output).not.toContain("missing  models.customizer.pick.body");
      // English's title isn't counted, so a translator's title_one is a leftover to remove.
      expect(output).toContain("unused   models.customizer.pick.title_one");
      expect(output).not.toContain("unused   models.customizer.pick.body_");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
