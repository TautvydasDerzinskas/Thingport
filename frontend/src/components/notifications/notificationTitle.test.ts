import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";
import type { Notification } from "../../api/notifications";
import { notificationTitle } from "./notificationTitle";

const base: Notification = {
  id: "1", type: "import", title: "", body: null, external_url: null,
  internal_path: null, read: false, read_at: null, created_at: "2026-01-01T00:00:00Z",
};

describe("notificationTitle", () => {
  it("translates known import titles without changing names or other notifications", async () => {
    const i18n = createInstance();
    await i18n.init({ lng: "ru", interpolation: { escapeValue: false }, resources: { ru: { translation: {
      notifications: { importedNamed: "Импортировано: {{name}}" },
      activity: { timeline: { import_one: "Импортирована {{count}} модель", import_few: "Импортировано {{count}} модели", import_many: "Импортировано {{count}} моделей" } },
    } } } });
    expect(notificationTitle({ ...base, title: 'Imported "A "B""' }, i18n.t)).toBe('Импортировано: A "B"');
    expect(notificationTitle({ ...base, title: "Imported 3 models" }, i18n.t)).toBe("Импортировано 3 модели");
    expect(notificationTitle({ ...base, title: "Imported 25 models" }, i18n.t)).toBe("Импортировано 25 моделей");
    expect(notificationTitle({ ...base, type: "system", title: "Imported 3 models" }, i18n.t)).toBe("Imported 3 models");
    expect(notificationTitle({ ...base, title: "Imported 3 models from a site" }, i18n.t)).toBe("Imported 3 models from a site");
  });
});
